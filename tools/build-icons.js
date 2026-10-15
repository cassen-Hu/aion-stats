// 技能图标：客户端 skills.pak 解出的 DDS（未压缩 BGRA 64x64）→ img/sk/<技能ID>.png（32x32），只转网站数据里出现过的技能
// 用法：node tools/build-icons.js <siteRoot> <skillsJson> <ddsDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [root, skillsJson, ddsDir] = process.argv.slice(2);
const SK = {}; JSON.parse(fs.readFileSync(skillsJson, 'utf8').replace(/^\uFEFF/, '')).forEach(s => { if (s.Icon) { let n = s.Icon.toLowerCase(); if (!n.endsWith('.dds')) n += '.dds'; SK[s.SkillId] = n; } });
const dds = {}; for (const f of fs.readdirSync(ddsDir)) if (/\.dds$/i.test(f)) dds[f.toLowerCase()] = path.join(ddsDir, f);
const ids = new Set();
const walk = d => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (/[\\/]sk[\\/][^\\/]+[\\/]\d+\.js$/.test(p)) { for (const m of fs.readFileSync(p, 'utf8').matchAll(/\[(\d+),/g)) ids.add(+m[1]); }
  else if (e.name === 'used.txt') fs.readFileSync(p, 'utf8').split(/\s+/).filter(Boolean).forEach(x => ids.add(+x)); } };
walk(path.join(root, 'data'));
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); }
const outDir = path.join(root, 'img', 'sk'); fs.mkdirSync(outDir, { recursive: true });
let made = 0, have = 0, miss = [];
for (const id of ids) { if (!id) continue; const o = path.join(outDir, id + '.png'); const src = SK[id] && dds[SK[id]];
  if (!src) { miss.push(id); continue; } if (fs.existsSync(o)) { have++; continue; }
  const b = fs.readFileSync(src); const h = b.readInt32LE(12), w = b.readInt32LE(16), bpp = b.readInt32LE(88), fl = b.readInt32LE(80);
  if (b.toString('ascii', 0, 4) !== 'DDS ' || bpp !== 32 || !(fl & 0x40)) { miss.push(id); continue; }
  // 图标画在 64x64 纹理左上角（通常 40x40）：按 alpha 取包围盒，裁成正方形后面积平均缩到 32x32
  let x0 = w, y0 = h, x1 = -1, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (b[128 + (y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 < 0) { miss.push(id); continue; } x0 = 0; y0 = 0; const S = Math.max(x1 + 1, y1 + 1), W = 32, H = 32, px = Buffer.alloc(W * H * 4), f = S / W;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = [0, 0, 0, 0]; let n = 0;
    for (let sy = Math.floor(y * f); sy < Math.max(Math.floor(y * f) + 1, Math.ceil((y + 1) * f)); sy++) for (let sx = Math.floor(x * f); sx < Math.max(Math.floor(x * f) + 1, Math.ceil((x + 1) * f)); sx++) { if (sx >= w || sy >= h) continue; const i = 128 + (sy * w + sx) * 4; a[0] += b[i + 2]; a[1] += b[i + 1]; a[2] += b[i]; a[3] += b[i + 3]; n++; }
    const j = (y * W + x) * 4; for (let k = 0; k < 4; k++) px[j + k] = Math.round(a[k] / Math.max(1, n)); }
  fs.writeFileSync(o, png(W, H, px)); made++; }
const all = fs.readdirSync(outDir).filter(f => /^\d+\.png$/.test(f)).map(f => +f.slice(0, -4)).sort((a, b) => a - b);
fs.writeFileSync(path.join(root, 'img', 'sk', 'ids.js'), 'window.AION_SKICON=new Set(' + JSON.stringify(all) + ');');
console.log(`技能图标：新转 ${made}，已有 ${have}，无图标 ${miss.length}（共 ${all.length} 个）`);
