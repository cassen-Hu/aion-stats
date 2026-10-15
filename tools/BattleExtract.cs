#nullable enable
// 从本地 facts.csv + 解码帧 ndjson 推导“每场战斗”与沙盘轨迹。
// 只输出白名单聚合：时间、时长、人员(PersonIndex/名字)、伤害、击杀名字、坐标。
// Observer / Session / ObjectId / PayloadSHA256 只在本地内存中用于关联，绝不写出。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

public static class AionBattleExtract
{
    sealed class Kill { public DateTime T; public string K = "", V = ""; }
    sealed class Hit { public DateTime T; public int A, Tg, Sk, Mk = -1; public long Amt; public bool Auto; }
    sealed class Battle
    {
        public DateTime S, E; public List<Kill> Kills = new(); public Dictionary<int, long[]> Dmg = new();
        public Dictionary<int, List<float>> Trk = new(); public Dictionary<int, double> LastT = new();
        public Dictionary<string, HashSet<uint>> MapVotes = new();
        public Dictionary<string, Dictionary<string, HashSet<uint>>> SessVotes = new(); public Dictionary<int, Dictionary<string, int>> PSess = new();
    }

    static List<string> SplitCsv(string line)
    {
        var r = new List<string>(); var sb = new StringBuilder(); bool q = false;
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (q) { if (c == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; } else q = false; } else sb.Append(c); }
            else if (c == '"') q = true; else if (c == ',') { r.Add(sb.ToString()); sb.Clear(); } else sb.Append(c);
        }
        r.Add(sb.ToString()); return r;
    }
    static uint Hex(string s) { s = s.Trim(); if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s.Substring(2); uint.TryParse(s, NumberStyles.HexNumber, null, out var v); return v; }
    static int Int(string s) { int.TryParse(s, out var v); return v; }

    public static string Run(string factsPath, string[] framePaths, string anchorsPath, string boundsPath, string outDir, string date, double sampleSec)
        => Run(factsPath, framePaths, anchorsPath, boundsPath, outDir, date, sampleSec, null);

    // hitsPath = AionCaptureReview 统一账本导出的 x-ledger-hits.csv（已去重、已按新口径筛选）。
    // 给了就用它算伤害与活动分段，保证与日排行同一口径；facts 仍用于人员映射、名字和击杀。
    public static string Run(string factsPath, string[] framePaths, string anchorsPath, string boundsPath, string outDir, string date, double sampleSec, string? hitsPath)
    {
        var log = new StringBuilder();
        // ── 1. facts：对象→人员映射、伤害、击杀 ──
        var oidToPerson = new Dictionary<(string, uint), int>(); var pname = new Dictionary<int, string>();
        var hits = new List<Hit>(); var kills = new List<Kill>();
        var seen = new HashSet<(int, int, long, long, long)>();
        var heals = new List<Hit>(); var hseen = new HashSet<(int, int, long, long, long)>();
        var mpSkills = new HashSet<int>(); var mpf = Path.Combine(Path.GetDirectoryName(outDir)!, "tools", "mp-skills.txt");
        if (File.Exists(mpf)) foreach (var l in File.ReadLines(mpf)) if (int.TryParse(l.Trim(), out var mi)) mpSkills.Add(mi);
        DateTime first = DateTime.MaxValue, last = DateTime.MinValue;
        using (var sr = new StreamReader(factsPath, Encoding.UTF8))
        {
            var head = SplitCsv(sr.ReadLine()!); int Col(string n) => head.IndexOf(n);
            int cAn = Col("ActorName"), cTn = Col("TargetName"); int cU = Col("Utc"), cF = Col("FactClass"), cAo = Col("ActorObjectId"), cTo = Col("TargetObjectId"), cAp = Col("ActorPersonIndex"),
                cTp = Col("TargetPersonIndex"), cSk = Col("SkillId"), cAm = Col("CandidateAmount"), cK = Col("KillerName"), cV = Col("VictimName"), cS = Col("FullSessionId"), cMk = Col("MarkerHex");
            string? line;
            while ((line = sr.ReadLine()) != null)
            {
                var f = SplitCsv(line); if (f.Count <= cS) continue;
                if (!DateTime.TryParse(f[cU], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)) continue;
                if (t < first) first = t; if (t > last) last = t;
                string sess = f[cS]; int ap = Int(f[cAp]), tp = Int(f[cTp]);
                uint ao = Hex(f[cAo]), to = Hex(f[cTo]);
                if (ap > 0 && ao != 0) oidToPerson[(sess, ao)] = ap; if (ap > 0 && f[cAn].Length > 0) pname[ap] = f[cAn]; if (tp > 0 && f[cTn].Length > 0) pname[tp] = f[cTn];
                if (tp > 0 && to != 0) oidToPerson[(sess, to)] = tp;
                int fc = Int(f[cF]);
                if (f[cK].Length > 0 && f[cV].Length > 0) { kills.Add(new Kill { T = t, K = f[cK], V = f[cV] }); continue; }
                // 治疗：class 4 + marker 0x0AFF 的负值记录（技能均为治疗类，见报告）；去掉自疗与回蓝类技能
                if (fc == 4 && ap > 0 && tp > 0 && ap != tp && cMk >= 0 && Hex(f[cMk]) == 0x0AFF)
                {
                    long ha; long.TryParse(f[cAm], out ha); int hs = Int(f[cSk]);
                    if (ha < 0 && ha > -1000000 && !mpSkills.Contains(hs))
                    {
                        long hsec = t.Ticks / TimeSpan.TicksPerSecond; var hk = (ap, tp, (long)hs, ha, hsec);
                        if (!hseen.Contains(hk) && !hseen.Contains((ap, tp, (long)hs, ha, hsec - 1)) && !hseen.Contains((ap, tp, (long)hs, ha, hsec + 1)))
                        { hseen.Add(hk); heals.Add(new Hit { T = t, A = ap, Tg = tp, Sk = hs, Amt = -ha }); }
                    }
                    continue;
                }
                if ((fc == 0 || fc == 1) && ap > 0)
                {
                    long amt; long.TryParse(f[cAm], out amt); if (amt <= 0) continue;
                    long sec = t.Ticks / TimeSpan.TicksPerSecond; int skv = Int(f[cSk]);
                    // 多个观察端会收到同一击：同攻击者/目标/技能/数值 在 ±1 秒内只算一次
                    var k0 = (ap, tp, (long)skv, amt, sec);
                    if (seen.Contains(k0) || seen.Contains((ap, tp, (long)skv, amt, sec - 1)) || seen.Contains((ap, tp, (long)skv, amt, sec + 1))) continue;
                    seen.Add(k0);
                    hits.Add(new Hit { T = t, A = ap, Tg = tp, Sk = skv, Amt = amt, Auto = fc == 1 });
                }
            }
        }
        if (!string.IsNullOrEmpty(hitsPath))
        {
            hits.Clear();
            foreach (var l in File.ReadLines(hitsPath).Skip(1))
            {
                var p = l.Split(',');
                hits.Add(new Hit { T = DateTime.Parse(p[0], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
                    A = Int(p[1]), Tg = p[6] == "1" ? Int(p[2]) : 0, Sk = Int(p[3]), Amt = long.Parse(p[4]), Auto = p[5] == "1", Mk = p.Length > 7 ? Convert.ToInt32(p[7], 16) : -1 });
            }
            log.AppendLine($"伤害口径：统一账本 {Path.GetFileName(hitsPath)}，{hits.Count} 击");
        }
        // 击杀去重：同一击杀者+阵亡者 4 秒内只算一次（与程序 KillDedupWindow 一致）
        kills.Sort((a, b) => a.T.CompareTo(b.T));
        var dk = new List<Kill>(); var lastKill = new Dictionary<(string, string), DateTime>();
        foreach (var k in kills) { if (lastKill.TryGetValue((k.K, k.V), out var lt) && (k.T - lt).TotalSeconds <= 4) continue; lastKill[(k.K, k.V)] = k.T; dk.Add(k); }
        log.AppendLine($"facts: {hits.Count} 击(去重后) {dk.Count} 击杀 时间 {first:o} → {last:o}");

        // ── 2. 分场：与 BattleAnalyzer 相同规则 ──
        var battles = new List<Battle>();
        if (dk.Count > 0 && last > first)
        {
            int buckets = (int)Math.Ceiling((last - first).TotalSeconds / 60.0) + 1;
            var perMin = new int[buckets + 2];
            foreach (var k in dk) { int i = (int)((k.T - first).TotalSeconds / 60); if (i >= 0 && i < perMin.Length) perMin[i]++; }
            double avg = dk.Count / (double)Math.Max(1, buckets);
            int thresh = Math.Max(3, (int)Math.Ceiling(avg * 2.0));
            var hot = new List<int>(); for (int i = 0; i < perMin.Length; i++) if (perMin[i] >= thresh) hot.Add(i);
            log.AppendLine($"分场阈值 每分钟≥{thresh} 阵亡，大量死亡分钟 {hot.Count}");
            if (hot.Count > 0)
            {
                int gap = 5, st = hot[0], pv = hot[0];
                for (int k = 1; k <= hot.Count; k++)
                {
                    if (k == hot.Count || hot[k] - pv > gap)
                    { battles.Add(new Battle { S = first.AddMinutes(Math.Max(0, st - 1)), E = first.AddMinutes(pv + 2) }); if (k < hot.Count) st = hot[k]; }
                    if (k < hot.Count) pv = hot[k];
                }
            }
        }
        string rule = "deaths";
        if (battles.Count == 0)
        {
            // 后备：没有“大量死亡分钟”时，按交战活动切分（空闲 >3 分钟断开，至少 20 击）
            rule = "activity";
            var ts = hits.Select(h => h.T).Concat(dk.Select(k => k.T)).OrderBy(t => t).ToList();
            int i0 = 0;
            for (int i = 1; i <= ts.Count; i++)
            {
                if (i == ts.Count || (ts[i] - ts[i - 1]).TotalSeconds > 180)
                {
                    if (i - i0 >= 20) battles.Add(new Battle { S = ts[i0].AddSeconds(-30), E = ts[i - 1].AddSeconds(30) });
                    i0 = i;
                }
            }
            log.AppendLine($"按死亡规则无战斗，改用活动分段：{battles.Count} 段");
        }
        Battle? Find(DateTime t) { foreach (var b in battles) if (t >= b.S && t < b.E) return b; return null; }
        foreach (var k in dk) Find(k.T)?.Kills.Add(k);
        foreach (var h in hits)
        {
            var b = Find(h.T); if (b == null) continue;
            if (!b.Dmg.TryGetValue(h.A, out var d)) b.Dmg[h.A] = d = new long[4];
            int idx = (h.Tg > 0 ? 0 : 2) + (h.Auto ? 1 : 0); d[idx] += h.Amt;
        }

                // 只保留参战人数（本场有 PvP 伤害的 distinct PersonIndex）> 50 的战斗；不够的场次整场丢弃
        const int MinPlayers = 50;
        int before = battles.Count;
        battles = battles.Where(b => b.Dmg.Count(kv => kv.Value[0] + kv.Value[1] > 0) > MinPlayers).ToList();
        log.AppendLine($"分场门槛：参战人数 > {MinPlayers}；保留 {battles.Count}/{before} 场");
        if (battles.Count == 0)
        {
            log.AppendLine("SKIP_DAY:no_qualifying_battles");
            log.Append("MAPS:");
            return log.ToString();
        }

        // ── 3. 帧：坐标 0x0017 + NPC 生成 0x000E（认地图） ──
        var anchors = new Dictionary<uint, string>();
        if (File.Exists(anchorsPath))
            foreach (var l in File.ReadLines(anchorsPath)) { if (l.Length == 0 || l[0] == '#') continue; var p = l.Split('\t'); if (p.Length >= 2 && uint.TryParse(p[0], out var id)) anchors[id] = p[1].Trim().ToLowerInvariant(); }
        long nPos = 0, nUse = 0; var identRank = new Dictionary<string, int>(); var identLv = new Dictionary<string, int>();
        if (battles.Count > 0)
            foreach (var fp in framePaths)
            {
                if (!File.Exists(fp)) { log.AppendLine("缺少帧文件 " + fp); continue; }
                using var fr = new StreamReader(fp, Encoding.UTF8, false, 1 << 20);
                string? l;
                while ((l = fr.ReadLine()) != null)
                {
                    if (l.Contains("\"op\":\"0x0020\"") && (l.Contains("S-\\u003EC") || l.Contains("S->C")))
                    {
                        // 0x0020 身份帧（偏移同 Batch25 PlayerIdentityParser）：名字@51 UTF-16，深渊军阶=尾部-18，等级=尾部-24
                        var idoc = JsonDocument.Parse(l).RootElement; var ib = Convert.FromHexString(idoc.GetProperty("hex").GetString() ?? "");
                        if (ib.Length >= 64)
                        {
                            int e = 51; while (e + 1 < ib.Length && e < 51 + 128 && (ib[e] | ib[e + 1]) != 0) e += 2;
                            var nmI = Encoding.Unicode.GetString(ib, 51, e - 51);
                            int rk = BitConverter.ToUInt16(ib, ib.Length - 18), lv = BitConverter.ToUInt16(ib, ib.Length - 24);
                            if (nmI.Length > 0 && rk <= 18) { identRank[nmI] = Math.Max(identRank.GetValueOrDefault(nmI, -1), rk); if (lv is >= 1 and <= 100) identLv[nmI] = lv; }
                        }
                        continue;
                    }
                    bool isPos = l.Contains("\"op\":\"0x0017\""), isSpawn = !isPos && l.Contains("\"op\":\"0x000E\"");
                    if (!isPos && !isSpawn) continue;
                    if (!l.Contains("S-\\u003EC") && !l.Contains("S->C")) continue;
                    var doc = JsonDocument.Parse(l).RootElement;
                    if (!DateTime.TryParse(doc.GetProperty("t").GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)) continue;
                    var b = Find(t); if (b == null) continue;
                    var hx = doc.GetProperty("hex").GetString() ?? ""; var by = Convert.FromHexString(hx);
                    if (isSpawn)
                    {
                        if (by.Length < 20) continue; uint eid = BitConverter.ToUInt32(by, 12), tpl = BitConverter.ToUInt32(by, 16);
                        if (eid < 0x80000000u || tpl < 200000u || tpl > 810001u || !anchors.TryGetValue(tpl, out var w)) continue;
                        if (!b.MapVotes.TryGetValue(w, out var set)) b.MapVotes[w] = set = new HashSet<uint>(); set.Add(tpl);
                        string ss = doc.TryGetProperty("sess", out var se2) ? se2.GetString() ?? "" : "";
                        if (!b.SessVotes.TryGetValue(ss, out var sv)) b.SessVotes[ss] = sv = new();
                        if (!sv.TryGetValue(w, out var s2)) sv[w] = s2 = new HashSet<uint>(); s2.Add(tpl); continue;
                    }
                    if (by.Length < 16) continue; nPos++;
                    uint oid = BitConverter.ToUInt32(by, 0);
                    string sess = doc.TryGetProperty("sess", out var se) ? se.GetString() ?? "" : "";
                    if (!oidToPerson.TryGetValue((sess, oid), out var pid)) continue;
                    if (!b.PSess.TryGetValue(pid, out var psd)) b.PSess[pid] = psd = new(); psd[sess] = psd.GetValueOrDefault(sess) + 1;
                    float x = BitConverter.ToSingle(by, 4), y = BitConverter.ToSingle(by, 8);
                    if (!float.IsFinite(x) || !float.IsFinite(y)) continue;
                    double rel = (t - b.S).TotalSeconds;
                    if (b.LastT.TryGetValue(pid, out var lt) && rel - lt < sampleSec) continue;
                    b.LastT[pid] = rel;
                    if (!b.Trk.TryGetValue(pid, out var lst)) b.Trk[pid] = lst = new List<float>();
                    lst.Add((float)Math.Round(rel)); lst.Add((float)Math.Round(x, 1)); lst.Add((float)Math.Round(y, 1)); nUse++;
                }
            }
        log.AppendLine($"坐标帧 {nPos}，采样后可用 {nUse}");

        // ── 4. 输出 ──
        var bounds = new Dictionary<string, double[]>();
        if (File.Exists(boundsPath))
            foreach (var l in File.ReadLines(boundsPath)) { if (l.Length == 0 || l[0] == '#') continue; var p = l.Split('\t'); if (p.Length >= 5) bounds[p[0].ToLowerInvariant()] = p.Skip(1).Take(4).Select(v => double.Parse(v, CultureInfo.InvariantCulture)).ToArray(); }
        var summary = new List<object>(); int n = 0; var mapsUsed = new HashSet<string>();
        Directory.CreateDirectory(Path.Combine(outDir, "tracks"));
        // 每场先按会话 NPC 锚点数出各地图的“玩家票数”（会话 ≥3 个模板且占比 ≥75% 才算认出）
        var perBattle = new List<Dictionary<string, int>>();
        foreach (var b in battles)
        {
            var sessMap = new Dictionary<string, string>();
            foreach (var kv in b.SessVotes)
            {
                var r = kv.Value.Select(x => (x.Key, x.Value.Count)).OrderByDescending(x => x.Count).ToList(); int tt = r.Sum(x => x.Count);
                if (r[0].Count >= 3 && (double)r[0].Count / tt >= 0.75) sessMap[kv.Key] = r[0].Key;
            }
            var cnt = new Dictionary<string, int>();
            foreach (var kv in b.PSess)
            {
                var votes = new Dictionary<string, int>();
                foreach (var sc in kv.Value) if (sessMap.TryGetValue(sc.Key, out var wm)) votes[wm] = votes.GetValueOrDefault(wm) + sc.Value;
                if (votes.Count > 0) { var w = votes.OrderByDescending(v => v.Value).First().Key; cnt[w] = cnt.GetValueOrDefault(w) + 1; }
            }
            perBattle.Add(cnt);
        }
        // 一场战斗只在一张地图上。各观察端可能给出不同答案（例如一个观察端的锚点一直指向另一张图），
        // 所以：候选地图里取【全天各场合计玩家票数最多】的那张；本场完全没有证据时沿用全天主地图。
        var dayTot = new Dictionary<string, int>();
        foreach (var c in perBattle) foreach (var kv in c) dayTot[kv.Key] = dayTot.GetValueOrDefault(kv.Key) + kv.Value;
        string dayMap = dayTot.Count > 0 ? dayTot.OrderByDescending(v => v.Value).First().Key : "";
        int bi = -1;
        foreach (var b in battles)
        {
            n++; bi++;
            var cand = perBattle[bi];
            string map = cand.Count > 0 ? cand.Keys.OrderByDescending(k => dayTot[k]).ThenByDescending(k => cand[k]).First() : dayMap;
            string mapBasis = cand.Count == 0 ? (map.Length > 0 ? "day" : "none") : cand.Count == 1 ? "npc" : "day-dominant";
            var mapCounts = map.Length > 0 ? new[] { new { map, players = b.Trk.Count } }.ToList() : new[] { new { map = "", players = 0 } }.Take(0).ToList();
            var candidates = cand.Select(kv => new { map = kv.Key, players = kv.Value }).OrderByDescending(x => x.players).ToList();
            if (map.Length > 0) mapsUsed.Add(map);
            var dmg = b.Dmg.Select(kv => new { id = kv.Key, pvpSkill = kv.Value[0], pvpAuto = kv.Value[1], pveSkill = kv.Value[2], pveAuto = kv.Value[3] }).ToList();
            string key = $"{date}-b{n}";
            summary.Add(new
            {
                no = n, key, rule, start = b.S.ToString("o"), end = b.E.ToString("o"), minutes = Math.Round((b.E - b.S).TotalMinutes),
                map, mapBasis, mapCandidates = candidates, maps = mapCounts, kills = b.Kills.Select(k => new { t = Math.Round((k.T - b.S).TotalSeconds), killer = k.K, victim = k.V }),
                damage = dmg, tracked = b.Trk.Count
            });
            var tr = new { key, map, bounds = map.Length > 0 && bounds.TryGetValue(map, out var bb) ? bb : null, duration = Math.Round((b.E - b.S).TotalSeconds), names = b.Trk.Keys.ToDictionary(k => k.ToString(), k => pname.GetValueOrDefault(k, "")), tracks = b.Trk.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value) };
            File.WriteAllText(Path.Combine(outDir, "tracks", key + ".js"), "(window.AION_TRACKS=window.AION_TRACKS||{})[" + JsonSerializer.Serialize(key) + "]=" + JsonSerializer.Serialize(tr, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) + ";", new UTF8Encoding(false));
        }
        var opts = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        // 玩家资料卡：当天击杀/阵亡（按名字，4 秒去重后的击杀消息）→ prof/{date}.js
        // 全部技能（统一账本去重后的命中；技能0 = 普攻）→ sk/{date}/{personId % 16}.js，打开资料卡时才按分片加载
        // 每个技能：[技能, PvP伤害, PvE伤害, PvP命中, PvE命中, 可判暴击命中数, 暴击数, 单击最大]
        // 暴击只按技能 marker 判：0x0A00/0x0200 = 普通，0xCA00/0xC200 = 暴击；普攻 marker 不判
        var sk = new Dictionary<int, Dictionary<int, long[]>>();
        foreach (var h in hits)
        {
            if (!sk.TryGetValue(h.A, out var m)) sk[h.A] = m = new();
            int key = h.Auto ? 0 : h.Sk;
            if (!m.TryGetValue(key, out var v)) m[key] = v = new long[7];
            bool pvp = h.Tg > 0; v[pvp ? 0 : 1] += h.Amt; v[pvp ? 2 : 3]++;
            if (!h.Auto && h.Mk >= 0) { int hb = h.Mk >> 8; if (hb is 0x0A or 0x02 or 0xCA or 0xC2) { v[4]++; if (hb is 0xCA or 0xC2) v[5]++; } }
            if (h.Amt > v[6]) v[6] = h.Amt;
        }
        var kd = new Dictionary<string, int[]>();
        foreach (var k in dk) { (kd.TryGetValue(k.K, out var a) ? a : kd[k.K] = new int[2])[0]++; (kd.TryGetValue(k.V, out var b2) ? b2 : kd[k.V] = new int[2])[1]++; }
        Directory.CreateDirectory(Path.Combine(outDir, "prof"));
        var aoe = new HashSet<int>(); var aof = Path.Combine(Path.GetDirectoryName(outDir)!, "tools", "aoe-skills.txt");
        if (File.Exists(aof)) foreach (var l in File.ReadLines(aof)) if (int.TryParse(l.Trim(), out var ai)) aoe.Add(ai);
        var pst = new Dictionary<int, long[]>();   // [PvP受到, 治疗量, AOE PvP伤害]
        long[] S(int id) { if (!pst.TryGetValue(id, out var v)) pst[id] = v = new long[3]; return v; }
        foreach (var h in hits) { if (h.Tg <= 0) continue; S(h.Tg)[0] += h.Amt; if (!h.Auto && aoe.Contains(h.Sk)) S(h.A)[2] += h.Amt; }
        foreach (var h in heals) S(h.A)[1] += h.Amt;
        var rkOut = new Dictionary<string, int[]>();
        foreach (var kv in pname) if (identRank.TryGetValue(kv.Value, out var r0)) rkOut[kv.Key.ToString()] = new[] { r0, identLv.GetValueOrDefault(kv.Value, 0) };
        log.AppendLine($"身份帧：军阶 {identRank.Count} 人，其中 ≥14 共 {identRank.Count(x => x.Value >= 14)} 人；AOE 技能表 {aoe.Count} 个");
        File.WriteAllText(Path.Combine(outDir, "prof", date + ".js"), "(window.AION_PROF=window.AION_PROF||{})[" + JsonSerializer.Serialize(date) + "]=" + JsonSerializer.Serialize(new { kd, st = pst.ToDictionary(x => x.Key.ToString(), x => x.Value), rk = rkOut }, opts) + ";", new UTF8Encoding(false));
        var skDir = Path.Combine(outDir, "sk", date); if (Directory.Exists(skDir)) Directory.Delete(skDir, true); Directory.CreateDirectory(skDir);
        for (int sh = 0; sh < 16; sh++)
        {
            var part = sk.Where(x => x.Key % 16 == sh).ToDictionary(x => x.Key.ToString(), x => x.Value.OrderByDescending(v => v.Value[0] + v.Value[1]).Select(v => new long[] { v.Key, v.Value[0], v.Value[1], v.Value[2], v.Value[3], v.Value[4], v.Value[5], v.Value[6] }).ToList());
            File.WriteAllText(Path.Combine(skDir, sh + ".js"), "((window.AION_SK=window.AION_SK||{})[" + JsonSerializer.Serialize(date) + "]||(window.AION_SK[" + JsonSerializer.Serialize(date) + "]={}))[" + sh + "]=" + JsonSerializer.Serialize(part, opts) + ";", new UTF8Encoding(false));
        }
        // 玩家关系：攻击了谁 / 被谁攻击（统一账本 PvP 命中）、击杀与被杀（4 秒去重击杀消息）、被谁治疗（facts class4 0x0AFF）
        // → rel/{date}/{personId % 16}.js，打开资料卡时才加载。每人每类最多 30 条（按伤害/数量排序）
        {
            var att = new Dictionary<int, Dictionary<int, long[]>>(); var by = new Dictionary<int, Dictionary<int, long[]>>();
            foreach (var h in hits)
            {
                if (h.Tg <= 0 || h.A == h.Tg) continue;
                if (!att.TryGetValue(h.A, out var m1)) att[h.A] = m1 = new(); if (!m1.TryGetValue(h.Tg, out var v1)) m1[h.Tg] = v1 = new long[2]; v1[0] += h.Amt; v1[1]++;
                if (!by.TryGetValue(h.Tg, out var m2)) by[h.Tg] = m2 = new(); if (!m2.TryGetValue(h.A, out var v2)) m2[h.A] = v2 = new long[2]; v2[0] += h.Amt; v2[1]++;
            }
            var hb = new Dictionary<int, Dictionary<int, long[]>>();
            foreach (var h in heals) { if (!hb.TryGetValue(h.Tg, out var m3)) hb[h.Tg] = m3 = new(); if (!m3.TryGetValue(h.A, out var v3)) m3[h.A] = v3 = new long[2]; v3[0] += h.Amt; v3[1]++; }
            var nameToId = new Dictionary<string, int>(); foreach (var kv in pname) if (kv.Value.Length > 0) nameToId.TryAdd(kv.Value, kv.Key);
            var kl = new Dictionary<int, Dictionary<string, List<long>>>(); var kbl = new Dictionary<int, Dictionary<string, List<long>>>();
            foreach (var k in dk)
            {
                long ts = new DateTimeOffset(DateTime.SpecifyKind(k.T, DateTimeKind.Utc)).ToUnixTimeSeconds();
                if (nameToId.TryGetValue(k.K, out var ki)) { if (!kl.TryGetValue(ki, out var a1)) kl[ki] = a1 = new(); if (!a1.TryGetValue(k.V, out var l1)) a1[k.V] = l1 = new(); l1.Add(ts); }
                if (nameToId.TryGetValue(k.V, out var vi)) { if (!kbl.TryGetValue(vi, out var a2)) kbl[vi] = a2 = new(); if (!a2.TryGetValue(k.K, out var l2)) a2[k.K] = l2 = new(); l2.Add(ts); }
            }
            object Top(Dictionary<int, Dictionary<int, long[]>> d, int id) => d.TryGetValue(id, out var m) ? m.OrderByDescending(x => x.Value[0]).Take(30).Select(x => new object[] { x.Key, x.Value[0], x.Value[1], pname.GetValueOrDefault(x.Key, "") }).ToList() : null!;
            object Kl(Dictionary<int, Dictionary<string, List<long>>> d, int id) => d.TryGetValue(id, out var m) ? m.OrderByDescending(x => x.Value.Count).Take(30).Select(x => new object[] { x.Key, nameToId.TryGetValue(x.Key, out var oi) ? oi : 0, x.Value }).ToList() : null!;
            var ids = new HashSet<int>(att.Keys.Concat(by.Keys).Concat(hb.Keys).Concat(kl.Keys).Concat(kbl.Keys));
            var relDir = Path.Combine(outDir, "rel", date); if (Directory.Exists(relDir)) Directory.Delete(relDir, true); Directory.CreateDirectory(relDir);
            var ropts = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
            for (int sh = 0; sh < 16; sh++)
            {
                var part = ids.Where(i => i % 16 == sh).ToDictionary(i => i.ToString(), i => new { a = Top(att, i), b = Top(by, i), h = Top(hb, i), k = Kl(kl, i), kb = Kl(kbl, i) });
                File.WriteAllText(Path.Combine(relDir, sh + ".js"), "((window.AION_REL=window.AION_REL||{})[" + JsonSerializer.Serialize(date) + "]||(window.AION_REL[" + JsonSerializer.Serialize(date) + "]={}))[" + sh + "]=" + JsonSerializer.Serialize(part, ropts) + ";", new UTF8Encoding(false));
            }
            log.AppendLine($"关系：{ids.Count} 人；治疗记录 {heals.Count}（去重、排除自疗/回蓝）");
        }
        File.WriteAllText(Path.Combine(outDir, date + ".battles.json"), JsonSerializer.Serialize(summary, opts), new UTF8Encoding(false));
        log.AppendLine($"战斗 {battles.Count} 场；地图 {string.Join(",", mapsUsed)}");
        log.Append("MAPS:" + string.Join(",", mapsUsed));
        return log.ToString();
    }
}
