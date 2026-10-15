// 红药使用次数：当天解码帧里 S->C 0x0012 的 HP 药水效果（tools/potion-skills.txt），只算 >50 人战斗时段
// 去重：同一观察会话里同一目标同一效果，剩余时间回升(>1s)或断档超过剩余时间才算新一次；多观察端 3 秒内同一人同一效果算一次
// 用法：node tools/build-potions.js <frames.ndjson> <battles.json> <potion-skills.txt> <out.json>
const fs = require('fs'), rl = require('readline');
const [frames, battlesJson, idsFile, out] = process.argv.slice(2);
const POT = new Set(fs.readFileSync(idsFile, 'utf8').split(/\r?\n/).filter(Boolean).map(Number));
const B = JSON.parse(fs.readFileSync(battlesJson, 'utf8').replace(/^\uFEFF/, '')).map(b => [Date.parse(b.start), Date.parse(b.end)]);
const name = {}, st = {}, starts = {};
(async () => {
  if (frames && fs.existsSync(frames)) for await (const l of rl.createInterface({ input: fs.createReadStream(frames), crlfDelay: Infinity })) {
    const i = l.indexOf('"op":"0x00'); if (i < 0) continue; const op = l.slice(i + 6, i + 12); if (op !== '0x0020' && op !== '0x0012') continue; if (l.indexOf('S-\\u003EC') < 0) continue;
    const o = JSON.parse(l), b = Buffer.from(o.hex, 'hex');
    if (op === '0x0020') { if (b.length < 64) continue; let e = 51; while (e + 1 < b.length && e < 179 && (b[e] | b[e + 1])) e += 2; const nm = b.toString('utf16le', 51, e); if (nm) name[b.readUInt32LE(12)] = nm; continue; }
    if (b.length < 19) continue; const tg = b.readUInt32LE(0), lay = b[4], n = b.readUInt16LE(17), rs = lay === 2 ? 12 : 8, off = lay === 2 ? 4 : 0; const t = Date.parse(o.t);
    for (let k = 0, p = 19; k < n && p + rs <= b.length; k++, p += rs) { const sk = b.readUInt16LE(p + off); if (!POT.has(sk)) continue; const rem = b.readUInt32LE(p + off + 4);
      const key = o.sess + '|' + tg + '|' + sk, s = st[key]; const isNew = !s || rem > s.rem + 1000 || t > s.t + s.rem + 2000; st[key] = { t, rem };
      if (isNew) (starts[tg + '|' + sk] ||= []).push(t); } }
  const cnt = {}; let tot = 0, all = 0, unk = 0;
  for (const [k, ts] of Object.entries(starts)) { const [tg, sk] = k.split('|'); ts.sort((a, b) => a - b); let last = -1e15;
    for (const t of ts) { if (t - last <= 3000) continue; last = t; all++; if (!B.some(b => t >= b[0] && t < b[1])) continue; const nm = name[tg]; if (!nm) { unk++; continue; } cnt[nm] = (cnt[nm] || 0) + 1; tot++; } }
  fs.writeFileSync(out, JSON.stringify(cnt));
  console.log(`POTIONS 红药 战斗时段 ${tot} 次 / ${Object.keys(cnt).length} 人（全天 ${all} 次，战斗时段无名字 ${unk}）`);
})();
