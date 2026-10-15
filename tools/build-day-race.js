// 当天抓包阵营表：只读当天解码帧里 S->C 0x0020 的 race@37（0=天族 1=魔族），名字@51 UTF-16。
// 用法：node tools/build-day-race.js <out.tsv> <frames.ndjson>...   同名出现不同值 → 记为冲突，不输出（＝未知）
const fs = require('fs'), rl = require('readline');
const [out, ...files] = process.argv.slice(2); const R = {};
(async () => {
  for (const f of files) { if (!f || !fs.existsSync(f)) continue;
    for await (const l of rl.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })) {
      if (l.indexOf('"op":"0x0020"') < 0 || l.indexOf('S-\\u003EC') < 0) continue;
      const b = Buffer.from(JSON.parse(l).hex, 'hex'); if (b.length < 64) continue;
      let e = 51; while (e + 1 < b.length && e < 179 && (b[e] | b[e + 1])) e += 2; const nm = b.toString('utf16le', 51, e); if (!nm) continue;
      const v = b[37]; if (v !== 0 && v !== 1) continue; (R[nm] ||= new Set()).add(v); } }
  const ok = Object.entries(R).filter(([, s]) => s.size === 1), bad = Object.keys(R).length - ok.length;
  fs.writeFileSync(out, ok.map(([n, s]) => n + '\t' + [...s][0]).join('\n') + (ok.length ? '\n' : ''), 'utf8');
  console.log(`当天抓包阵营：${ok.length} 人，冲突 ${bad}`);
})();
