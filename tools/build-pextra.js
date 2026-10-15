// 玩家资料卡扩展数据：data/<server>/px/<date>/<id%16>.js（打开资料卡时才加载）
// 用法：node tools/build-pextra.js <siteDataDir> <date> <evidenceBase> <factsCsv> <skillsJson>
// evidenceBase = AionCaptureReview 输出前缀（…\B25-PL-import-real-YYYYMMDD.），读 x-casts-0021 / x-buffs-0012 / x-equip-0024 / x-deaths-0025 / x-npc-target-0028
const fs = require('fs'), vm = require('vm'), path = require('path'), readline = require('readline');
const [dataDir, date, base, factsPath, skillsJson] = process.argv.slice(2);
const w = {}; vm.runInNewContext(fs.readFileSync(path.join(dataDir, 'day', date + '.js'), 'utf8'), { window: w });
const day = Object.values(w.AION_DAYS)[0].daily, byName = {}, RC = {}; day.players.forEach(p => { if (p.race === 0 || p.race === 1) RC[p.id] = p.race; }); day.players.forEach(p => { if (!(p.name in byName)) byName[p.name] = p.id; });
// 控制类状态：按 aion_skills_cn.json 每个技能 Effects[].Type 归类（大小写不敏感；Buff* 是自身防护效果，不算）
// 0=击倒 Stumble　1=麻痹 Paralyze/Stun　2=沉默 Silence　3=失明 Blind　4=晕厥 Stagger/Spin/OpenAerial
const CCT = { stumble: 0, paralyze: 1, stun: 1, silence: 2, blind: 3, stagger: 4, spin: 4, openaerial: 4 };
const SK = {}, CC = {}; try { JSON.parse(fs.readFileSync(skillsJson, 'utf8').replace(/^\uFEFF/, '')).forEach(s => { SK[s.SkillId] = [s.ChineseName || '', s.Icon || ''];
  const k = new Set(); (s.Effects || []).forEach(e => { const t = CCT[String(e.Type || '').toLowerCase()]; if (t !== undefined) k.add(t); }); if (k.size) CC[s.SkillId] = [...k]; }); } catch {}
const P = {}; const G = id => P[id] ||= {};
const rows = f => { if (!fs.existsSync(f)) return []; return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(',')); };
const used = new Set();
// 客户端名表（本机客户端 items.pak/client_items + npcs + L10N/CHS 字符串，tools/names_item.json / names_npc.json）
const rj = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { return {}; } };
const INM = rj('names_item.json'), NNM = rj('names_npc.json'), usedI = new Set(), usedN = new Set();
// 施法 0x0021 / 中断 0x002A
for (const q of rows(base + 'x-casts-0021.csv')) { const id = byName[q[2]]; if (id === undefined) continue; const o = G(id); o.c ||= [0, 0, {}]; const intr = q[11] === '是'; o.c[0]++; if (intr) o.c[1]++; const s = (o.c[2][q[4]] ||= [0, 0]); s[0]++; if (intr) s[1]++; }
// 受到的增益/减益 0x0012
for (const q of rows(base + 'x-buffs-0012.csv')) { const id = byName[q[1]]; if (id === undefined) continue; const o = G(id); o.bf ||= {}; const k = q[3] + '|' + q[8]; const kind = q[6] && q[2] ? (q[6] === q[2] ? 1 : 2) : 0; const cc = CC[+q[3]]; if (cc) { o.cc ||= [0, 0, 0, 0, 0]; cc.forEach(i => o.cc[i] += +q[11] || 1); }
  const b = (o.bf[k] ||= [+q[3], +q[8], kind, 0, {}]); b[3] += +q[11] || 1; if (q[5]) b[4][q[5]] = (b[4][q[5]] || 0) + (+q[11] || 1); }
// 外观装备 0x0024（取最后一次）
for (const q of rows(base + 'x-equip-0024.csv')) { const id = byName[q[1]]; if (id === undefined) continue; G(id).e = q[4].trim().split(/\s+/).map(Number).filter(Boolean); G(id).e.forEach(i => usedI.add(i)); }
// 阵亡 0x0025：击杀者
// 每条 [显示名, 次数, 类型, [unix秒...]]；类型 p=玩家 s=自杀 e=环境/未知 n=NPC。PvP 击杀统计不用这里（只用 facts 击杀消息）
const DS = { p: 0, s: 0, e: 0, n: 0 };
for (const q of rows(base + 'x-deaths-0025.csv')) { const id = byName[q[2]]; if (id === undefined) continue; const o = G(id); o.d ||= {};
  const kid = (q[4] || '').replace(/"/g, ''), kn = (q[5] || '').replace(/"/g, ''); let t, lab;
  if (!kid && !kn) { t = 'e'; lab = '环境/未知'; } else if (kid === (q[1] || '').replace(/"/g, '') || kn === q[2]) { t = 's'; lab = '自杀'; }
  else if (/^NPC\d+$/.test(kn)) { t = 'n'; const nid = kn.slice(3); usedN.add(nid); lab = 'N' + nid; } else { t = 'p'; lab = kn; }
  DS[t]++; const ts = Math.round(Date.parse(q[0].replace(/"/g, '').replace(' ', 'T') + '+08:00') / 1000);
  const e = (o.d[t + '|' + lab] ||= [lab, 0, t, []]); e[1]++; if (ts) e[3].push(ts); }
// NPC 盯住 0x0028
for (const q of rows(base + 'x-npc-target-0028.csv')) { const id = byName[q[3]]; if (id === undefined) continue; const o = G(id); o.n ||= {}; o.n[q[1]] = (o.n[q[1]] || 0) + (+q[5] || 1); usedN.add(q[1]); }
// 攻击结果 0x002B marker（PvP，按 SHA+记录 去重）：普通/暴击/招架/格挡/闪避/抵抗
const RK = { 0x0A: [0], 0xCA: [1], 0x02: [2], 0xC2: [2, 1], 0x04: [3], 0xC4: [3, 1], 0x00: [4], 0x06: [5] };
(async () => {
  if (factsPath && fs.existsSync(factsPath)) {
    const rl = readline.createInterface({ input: fs.createReadStream(factsPath), crlfDelay: Infinity }); let h = null, seen = new Set();
    for await (const l of rl) { const f = l.split(','); if (!h) { h = {}; f.forEach((n, i) => h[n.replace(/^\uFEFF/, '')] = i); continue; }
      if (f[h.Opcode] !== '0x002B') continue; const a = +f[h.ActorPersonIndex], t = +f[h.TargetPersonIndex]; if (!(a > 0 && t > 0) || a === t) continue; if (RC[a] !== undefined && RC[a] === RC[t]) continue;
      const key = f[h.PayloadSHA256] + '|' + f[h.RecordIndex]; if (seen.has(key)) continue; seen.add(key);
      const r = RK[(parseInt(f[h.MarkerHex], 16) >> 8) & 0xff]; if (!r) continue;
      const A = G(a), T = G(t); A.ra ||= [0, 0, 0, 0, 0, 0]; T.rr ||= [0, 0, 0, 0, 0, 0]; r.forEach(i => { A.ra[i]++; T.rr[i]++; }); }
  }
  const out = {}; const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n);
  for (const [id, o] of Object.entries(P)) { const x = {};
    if (o.c) { x.c = [o.c[0], o.c[1], Object.entries(o.c[2]).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12).map(([s, v]) => (used.add(+s), [+s, v[0], v[1]]))]; }
    if (o.ra) x.ra = o.ra; if (o.cc) x.cc = o.cc; if (o.rr) x.rr = o.rr; if (o.e) x.e = o.e;
    if (o.bf) x.bf = Object.values(o.bf).sort((a, b) => b[3] - a[3]).slice(0, 20).map(b => (used.add(b[0]), [b[0], b[1], b[2], b[3], top(b[4], 1).map(z => z[0])[0] || '']));
    if (o.d) x.d = Object.values(o.d).sort((a, b) => b[1] - a[1]).slice(0, 30); if (o.n) x.n = top(o.n, 10);
    (out[id % 16] ||= {})[id] = x; }
  const dir = path.join(dataDir, 'px', date); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const names = {}; used.forEach(s => { if (SK[s]) names[s] = SK[s][0]; });
  const ni = {}, nn = {}; let hi = 0, hn = 0; usedI.forEach(i => { if (INM[i]) { ni[i] = INM[i]; hi++; } }); usedN.forEach(i => { if (NNM[i]) { nn[i] = NNM[i]; hn++; } });
  names._i = ni; names._n = nn;
  console.log(`物品名 ${hi}/${usedI.size}，NPC名 ${hn}/${usedN.size}；0x0025 玩家阵亡：玩家击杀 ${DS.p} 自杀 ${DS.s} 环境/未知 ${DS.e} NPC ${DS.n}`);
  for (let i = 0; i < 16; i++) fs.writeFileSync(path.join(dir, i + '.js'), `((window.AION_PX=window.AION_PX||{})[${JSON.stringify(date)}]||(window.AION_PX[${JSON.stringify(date)}]={}))[${i}]=${JSON.stringify(out[i] || {})};`);
  fs.writeFileSync(path.join(dir, 'names.js'), `((window.AION_PXN=window.AION_PXN||{})[${JSON.stringify(date)}]=${JSON.stringify(names)});`);
  fs.writeFileSync(path.join(dir, 'used.txt'), [...used].join('\n'));
  console.log(`px ${date}: ${Object.keys(P).length} 人，技能/效果 ${used.size}`);
})();
