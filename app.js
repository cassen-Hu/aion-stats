(() => {
  'use strict';
  const CLASS = {1:'剑星',2:'守护星',4:'杀星',5:'弓星',7:'魔道星',8:'精灵星',10:'治愈星',11:'护法星'};
  const RACE = {0:'天族',1:'魔族'};
  const RCOL = {0:'#4ade80',1:'#60a5fa'}, UCOL = '#9ca3af';
  const $ = s => document.querySelector(s);
  const fmt = n => Number(n || 0).toLocaleString('zh-CN');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cls = id => CLASS[id] || (id ? '职业' + id : '-');
  const race = r => r === 0 || r === 1 ? `<span class="r${r}">${RACE[r]}</span>` : '<span class="unk">?</span>';
  const tz = { timeZone: 'Asia/Shanghai', hour12: false };
  const hm = iso => new Date(iso).toLocaleTimeString('zh-CN', { ...tz, hour: '2-digit', minute: '2-digit' });
  const mmss = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const SRV = window.AION_SRV || 's1', DP = `data/${SRV}/`;
  const D = window.AION_DATA || { index: [], maps: {} };
  const MAPS = D.maps || {};
  let data = null, battles = [], byId = {}, limit = 100, curBattle = -1;
  const sortState = { tp: ['pvp', -1], tl: ['pvp', -1], tc: ['pvp', -1], ts: ['records', -1], tb: ['pvp', -1] };

  // —— 用 <script> 加载数据：file:// 双击和网站托管都能用 ——
  const loaded = {};
  function loadScript(src) {
    return loaded[src] ||= new Promise((ok, no) => { const s = document.createElement('script'); s.src = src;
      s.onload = ok; s.onerror = () => { delete loaded[src]; no(new Error('加载失败 ' + src)); }; document.head.appendChild(s); });
  }
  async function getDay(d) {
    if (!(window.AION_DAYS && window.AION_DAYS[d])) await loadScript(`${DP}day/${d}.js`);
    return window.AION_DAYS[d];
  }
  async function getTracks(key) {
    if (!(window.AION_TRACKS && window.AION_TRACKS[key])) await loadScript(`${DP}tracks/${key}.js`);
    return window.AION_TRACKS[key];
  }

  Object.entries(CLASS).forEach(([k, v]) => $('#cls').insertAdjacentHTML('beforeend', `<option value="${k}">${v}</option>`));
  const enrich = r => { r.pvp = r.pvpSkill + r.pvpAuto; r.pve = r.pveSkill + r.pveAuto; return r; };
  function filt(rows, nameKeys) {
    const q = $('#q').value.trim().toLowerCase(), rc = $('#race').value, c = $('#cls').value;
    return rows.filter(r => (rc === '' || String(r.race) === rc) && (c === '' || r.classId === undefined || String(r.classId) === c)
      && (!q || nameKeys.some(k => String(r[k] || '').toLowerCase().includes(q))));
  }
  function table(id, cols, rows, max) {
    const [sk, sd] = sortState[id];
    rows = rows.slice().sort((a, b) => { const x = a[sk], y = b[sk]; return (typeof x === 'string' ? String(x).localeCompare(y, 'zh') : (x ?? -1) - (y ?? -1)) * sd; });
    const top = Math.max(1, ...rows.map(r => r[sk]).filter(v => typeof v === 'number'));
    const head = '<tr><th class="t">#</th>' + cols.map(c => `<th data-k="${c.k}" class="${c.t ? 't' : ''} ${c.h ? 'hm' : ''} ${c.k === sk ? 's' + (sd > 0 ? ' asc' : '') : ''}">${c.n}</th>`).join('') + '</tr>';
    const body = rows.slice(0, max || rows.length).map((r, i) => '<tr><td class="t rk">' + (i + 1) + '</td>' + cols.map(c => {
      let v = c.f ? c.f(r) : (typeof r[c.k] === 'number' ? fmt(r[c.k]) : esc(r[c.k]));
      if (c.bar && c.k === sk) v = `<span class="bar" style="width:${Math.round(40 * r[c.k] / top)}px"></span>` + v;
      return `<td class="${c.t ? 't' : ''} ${c.h ? 'hm' : ''}">${v}</td>`; }).join('') + '</tr>').join('');
    const el = $('#' + id);
    el.innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
    el.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
      const k = th.dataset.k; sortState[id] = [k, sortState[id][0] === k ? -sortState[id][1] : -1]; render(); });
    return rows.length;
  }
  const num = (k, n, h) => ({ k, n, bar: true, h });
  const dmgCols = () => [num('pvp', 'PvP合计'), num('taken', 'PvP承伤'), num('pvpSkill', 'PvP技能', 1), num('pvpAuto', 'PvP普攻', 1), num('pve', 'PvE合计'), num('pveSkill', 'PvE技能', 1), num('pveAuto', 'PvE普攻', 1)];

  function render() {
    if (!data) return;
    raceByName = {}; (battles || []).forEach(b => (b.kills || []).forEach(k => { if (k.vr === 0 || k.vr === 1) raceByName[k.victim] = k.vr; if (k.kr === 0 || k.kr === 1) raceByName[k.killer] = k.kr; })); data.players.forEach(p => { if (p.race === 0 || p.race === 1) raceByName[p.name] = p.race; });
    const P = filt(data.players, ['name', 'legion']);
    const n = table('tp', [{ k: 'name', n: '角色', t: 1, f: r => `<b class="pn" data-id="${r.id}">${esc(r.name)}</b>` }, { k: 'legion', n: '军团', t: 1, f: r => r.legion ? `<span class="ln" data-lg="${esc(r.legion)}" data-r="${r.race}">${esc(r.legion)}</span>` : '' },
      { k: 'race', n: '阵营', f: r => race(r.race) }, { k: 'classId', n: '职业', f: r => cls(r.classId) }, ...dmgCols()], P, limit);
    $('#pm').innerHTML = n > limit ? `<button id="mb">显示更多（共 ${n} 人，当前 ${limit}）</button>` : `共 ${n} 人`;
    if (n > limit) $('#mb').onclick = () => { limit += 200; render(); };
    table('tl', [{ k: 'legion', n: '军团', t: 1, f: r => `<b class="ln" data-lg="${esc(r.legion)}" data-r="${r.race}">${esc(r.legion)}</b>` }, { k: 'race', n: '阵营', f: r => race(r.race) },
      num('members', '人数'), ...dmgCols()], filt(data.legions, ['legion']));
    const by = {};
    P.forEach(p => { const g = by[p.race + '-' + p.classId] ||= { race: p.race, classId: p.classId, name: cls(p.classId), count: 0, pvp: 0, pve: 0 };
      g.count++; g.pvp += p.pvp; g.pve += p.pve; });
    table('tc', [{ k: 'name', n: '职业', t: 1 }, { k: 'race', n: '阵营', f: r => race(r.race) }, num('count', '人数'),
      num('pvp', 'PvP合计'), num('avgPvp', '人均PvP'), num('pve', 'PvE合计', 1), num('avgPve', '人均PvE', 1)],
      Object.values(by).map(g => ({ ...g, avgPvp: Math.round(g.pvp / g.count), avgPve: Math.round(g.pve / g.count) })));
    table('ts', [{ k: 'factClass', n: '记录类型', t: 1 }, { k: 'marker', n: '标记', t: 1 }, num('records', '记录数'), num('positiveSum', '正值合计')], data.skillPatterns);
    renderBattleList();
    if ($('#transform') && $('#transform').classList.contains('on')) renderTransform();
    if (curBattle >= 0) renderBattleDetail(curBattle);
    const sum = (a, k) => a.reduce((s, r) => s + r[k], 0), all = data.players;
    const ep = sum(all.filter(p => p.race === 0), 'pvp'), ap = sum(all.filter(p => p.race === 1), 'pvp'), tp = sum(all, 'pvp'), sh = ep + ap ? Math.round(100 * ep / (ep + ap)) : 50;
    $('#summary').innerHTML = [['PvP 总伤害（技能+普攻）', sp(ep, ap, tp, '<br>')], ['玩家', sp(...rc(all), all.length, '<br>')], ['军团', sp(...rc(data.legions), data.legions.length, '<br>')], ['战斗场次（>50人）', battles.length], ['阵亡（各场合计）', dhtml(dsplit(battles.flatMap(b => b.kills)), '<br>')]]
      .map(([a, b]) => `<div class="card"><span>${a}</span><b>${b}</b></div>`).join('') +
      `<div class="card wide"><span>阵营 PvP 伤害（技能+普攻）· ${data.date}</span><div class="rbar"><i class="e" style="width:${sh}%">天族 ${fmt(ep)}</i><i class="a">魔族 ${fmt(ap)}</i></div></div>`;
  }

  // 阵亡按阵营拆分（按阵亡者名字查当天名单；阵营未知只计入总数）
  let raceByName = {};
  function dsplit(kills) { let e = 0, m = 0; kills.forEach(k => { const r = (k.vr === 0 || k.vr === 1) ? k.vr : raceByName[k.victim]; if (r === 0) e++; else if (r === 1) m++; }); return { t: kills.length, e, m }; }
  const sp = (e, m, t, sep) => `${fmt(t)}${sep || ' '}<span class="ds"><span class="r0">天 ${fmt(e)}</span> <span class="r1">魔 ${fmt(m)}</span></span>`;
  const rc = a => [a.filter(r => r.race === 0).length, a.filter(r => r.race === 1).length];
  const dhtml = (d, sep) => `${fmt(d.t)}${sep || ' '}<span class="ds"><span class="r0">天 ${fmt(d.e)}</span> <span class="r1">魔 ${fmt(d.m)}</span></span>`;
  // —— 战斗场次 ——
  const mapName = m => m ? ((MAPS[m] && MAPS[m].name) || m) : '未识别地图';
  function battleRows(b) {
    return b.damage.map(d => { const p = byId[d.id] || {}; return enrich({ ...d, name: p.name || ('#' + d.id), legion: p.legion || '', race: p.race, classId: p.classId }); });
  }
  function renderBattleList() {
    $('#blist').innerHTML = battles.length ? battles.map((b, i) => {
      const rows = battleRows(b), pvp = rows.reduce((s, r) => s + r.pvp, 0);
      return `<div class="bcard ${i === curBattle ? 'on' : ''}" data-i="${i}"><h3>第 ${b.no} 场 · ${esc(mapName(b.map))}</h3>
        <div class="m">${hm(b.start)} – ${hm(b.end)}（${b.minutes} 分钟）${b.rule === 'activity' ? ' · 按交战活动分段' : ''}</div>
        <div class="s"><span>⚔ ${rows.filter(r => r.pvp > 0).length} 人</span><span class="dead">✕ ${dhtml(dsplit(b.kills))}</span><span>PvP ${fmt(pvp)}</span></div></div>`;
    }).join('') : '<p class="note">这一天没有切分出战斗。</p>';
    $('#blist').querySelectorAll('.bcard').forEach(c => c.onclick = () => { curBattle = +c.dataset.i; renderBattleList(); renderBattleDetail(curBattle); });
    if (curBattle < 0) $('#bdetail').innerHTML = '';
  }
  function renderBattleDetail(i) {
    const b = battles[i]; if (!b) return;
    const rows = filt(battleRows(b), ['name', 'legion']);
    const lg = {};
    rows.forEach(r => { const g = lg[r.legion + '|' + r.race] ||= { legion: r.legion || '（无军团）', race: r.race, members: 0, pvp: 0, pve: 0 }; g.members++; g.pvp += r.pvp; g.pve += r.pve; });
    const kc = {}, dc = {}; b.kills.forEach(k => { kc[k.killer] = (kc[k.killer] || 0) + 1; dc[k.victim] = (dc[k.victim] || 0) + 1; });
    rows.forEach(r => { r.kills = kc[r.name] || 0; r.deaths = dc[r.name] || 0; });
    $('#bdetail').innerHTML = `<div class="bd"><h2>第 ${b.no} 场 · ${esc(mapName(b.map))} · ${hm(b.start)}–${hm(b.end)}</h2>
      <button class="btn" id="toSb">▶ 沙盘回放这一场</button>
      <h4>参战玩家</h4><div class="tw"><table id="tb"></table></div>
      <div class="grid2"><div><h4>军团</h4><div class="tw"><table id="tbl"></table></div></div>
      <div><h4>击杀记录（阵亡 ${dhtml(dsplit(b.kills))}）</h4><div class="kills">${b.kills.map(k => `<div><span class="tm">${mmss(k.t)}</span>${esc(k.killer)} <span class="dead">✕</span> ${esc(k.victim)}</div>`).join('') || '无'}</div></div></div></div>`;
    table('tb', [{ k: 'name', n: '角色', t: 1, f: r => `<b class="pn" data-id="${r.id}">${esc(r.name)}</b>` }, { k: 'legion', n: '军团', t: 1, f: r => r.legion ? `<span class="ln" data-lg="${esc(r.legion)}" data-r="${r.race}">${esc(r.legion)}</span>` : '' }, { k: 'race', n: '阵营', f: r => race(r.race) },
      { k: 'classId', n: '职业', f: r => cls(r.classId) }, num('kills', '击杀'), num('deaths', '阵亡'), ...dmgCols()], rows);
    sortState.tbl ||= ['pvp', -1];
    table('tbl', [{ k: 'legion', n: '军团', t: 1, f: r => r.legion ? `<span class="ln" data-lg="${esc(r.legion)}" data-r="${r.race}">${esc(r.legion)}</span>` : '' }, { k: 'race', n: '阵营', f: r => race(r.race) }, num('members', '人数'), num('pvp', 'PvP'), num('pve', 'PvE')], Object.values(lg));
    $('#toSb').onclick = () => { showTab('sandbox'); $('#sbBattle').value = i; openSandbox(i); };
  }

  // —— 沙盘 ——
  const cv = $('#sbCanvas'), ctx = cv.getContext('2d');
  const SB = { tr: null, t: 0, playing: false, img: null, zoom: 1, panX: 0, panY: 0, pts: [], last: 0, deaths: [] };
  function fillSandboxSelect() {
    $('#sbBattle').innerHTML = battles.map((b, i) => `<option value="${i}">第 ${b.no} 场 ${hm(b.start)} ${esc(mapName(b.map))}</option>`).join('') || '<option>无</option>';
  }
  async function openSandbox(i) {
    const b = battles[i]; if (!b) { SB.tr = null; draw(); return; }
    SB.playing = false; $('#sbPlay').textContent = '▶ 播放'; $('#sbInfo').textContent = '加载轨迹…';
    let tr; try { tr = await getTracks(b.key); } catch (e) { $('#sbInfo').textContent = e.message; return; }
    SB.tr = tr; SB.b = b; SB.t = 0; SB.zoom = 1; SB.panX = SB.panY = 0;
    // 预处理：每人 [t,x,y,...] → 数组
    SB.people = Object.entries(tr.tracks).map(([id, a]) => { const p = byId[id] || {};
      const T = [], X = [], Y = []; for (let k = 0; k < a.length; k += 3) { T.push(a[k]); X.push(a[k + 1]); Y.push(a[k + 2]); }
      return { id, name: p.name || tr.names[id] || ('#' + id), race: p.race, legion: p.legion || '', T, X, Y }; });
    const byName = {}; SB.people.forEach(p => byName[p.name] = p);
    SB.deaths = b.kills.map(k => ({ t: k.t, p: byName[k.victim], k })).filter(d => d.p);
    // 世界→画面映射
    SB.map = SB.forceMap !== null && SB.forceMap !== undefined ? SB.forceMap : tr.map; SB.forceMap = null;
    $('#sbMap').innerHTML = (b.maps || []).map(x => `<option value="${x.map}">${esc(mapName(x.map))}（${x.players}人）</option>`).join('') + '<option value="">全部坐标（无底图）</option>';
    $('#sbMap').value = SB.map;
    const m = MAPS[SB.map];
    SB.bounds = (m && m.bounds) || null; SB.onMap = () => true;
    if (!SB.bounds) { // 未识别地图：用全部坐标包围盒，纯坐标平面，不旋转
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      SB.people.forEach(p => SB.onMap(p.id) && p.X.forEach((x, k) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, p.Y[k]); y1 = Math.max(y1, p.Y[k]); }));
      const pad = Math.max(50, (x1 - x0) * .1, (y1 - y0) * .1); SB.bounds = [x0 - pad, x1 + pad, y0 - pad, y1 + pad]; SB.rot = 0;
    } else SB.rot = -90;
    const layers = (m && m.layers) || [];
    $('#sbLayer').innerHTML = layers.map(l => `<option>${l}</option>`).join('') + '<option value="">（无底图）</option>';
    setLayer(layers[0] || '');
    $('#sbSlider').max = tr.duration; $('#sbSlider').value = 0;
    $('#sbInfo').textContent = `${mapName(tr.map)} · 轨迹 ${SB.people.length} 人 · 时长 ${mmss(tr.duration)}`;
    // 初始视野：缩放到有人活动的区域
    SB.t = Math.min(tr.duration, ...SB.people.filter(p => SB.onMap(p.id) && p.T.length).map(p => p.T[0]));
    if (!isFinite(SB.t)) SB.t = 0;
    fitToPlayers(); draw();
  }
  function setLayer(l) { SB.img = null; if (!l) { draw(); return; } const im = new Image(); im.onload = () => { SB.img = im; draw(); }; im.src = `maps/${l}.jpg`; }
  function size() { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [r.width, r.height]; }
  // 与水表一致：底图铺满地图真实坐标范围；玩家坐标绕地图中心旋转 -90°
  function base(x, y) {
    const [x0, x1, y0, y1] = SB.bounds, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (SB.rot) { const r = SB.rot * Math.PI / 180, dx = x - cx, dy = y - cy; x = cx + dx * Math.cos(r) - dy * Math.sin(r); y = cy + dx * Math.sin(r) + dy * Math.cos(r); }
    return [(x - x0) / (x1 - x0), (y1 - y) / (y1 - y0)]; // 0..1
  }
  function view() { const [W, H] = [cv.clientWidth, cv.clientHeight], s = Math.min(W, H) * SB.zoom; return { s, ox: (W - s) / 2 + SB.panX, oy: (H - s) / 2 + SB.panY }; }
  const scr = (u, v, V) => [V.ox + u * V.s, V.oy + v * V.s];
  function fitToPlayers() {
    const us = [], vs = [];
    SB.people.forEach(p => { if (!SB.onMap(p.id)) return; p.X.forEach((x, k) => { const [u, v] = base(x, p.Y[k]); us.push(u); vs.push(v); }); });
    if (!us.length) return;
    us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
    const u0 = q(us, .05), u1 = q(us, .95), v0 = q(vs, .05), v1 = q(vs, .95);
    const span = Math.max(u1 - u0, v1 - v0, 0.03) * 1.5; SB.zoom = Math.max(1, Math.min(20, 1 / span));
    const W = cv.clientWidth, H = cv.clientHeight, s = Math.min(W, H) * SB.zoom;
    SB.panX = -(((u0 + u1) / 2) * s - s / 2); SB.panY = -(((v0 + v1) / 2) * s - s / 2);
  }
  function posAt(p, t) { // 最近一个不晚于 t 的采样；超过 20 秒没更新就不画
    const T = p.T; if (!T.length || T[0] > t) return null;
    let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; }
    if (t - T[lo] > 20) return null; return lo;
  }
  function draw() {
    const [W, H] = size(); ctx.fillStyle = '#060b14'; ctx.fillRect(0, 0, W, H);
    if (!SB.tr) { ctx.fillStyle = '#8c9db4'; ctx.font = '14px sans-serif'; ctx.fillText(battles.length ? '选择场次后开始回放' : '这一天没有战斗', 20, 30); return; }
    const V = view();
    if (SB.img) { ctx.globalAlpha = .93; ctx.drawImage(SB.img, V.ox, V.oy, V.s, V.s); ctx.globalAlpha = 1; }
    else { ctx.strokeStyle = '#16223a'; for (let g = 0; g <= 10; g++) { const a = scr(g / 10, 0, V), b = scr(g / 10, 1, V), c = scr(0, g / 10, V), d = scr(1, g / 10, V);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.moveTo(...c); ctx.lineTo(...d); ctx.stroke(); } }
    const show = { 0: $('#sbE').checked, 1: $('#sbA').checked, u: $('#sbU').checked }, t = SB.t;
    SB.pts = []; let ce = 0, ca = 0;
    for (const p of SB.people) {
      if (!SB.onMap(p.id)) continue; const ok = p.race === 0 ? show[0] : p.race === 1 ? show[1] : show.u; if (!ok) continue;
      const k = posAt(p, t); if (k === null) continue;
      const col = RCOL[p.race] || UCOL;
      const [x, y] = scr(...base(p.X[k], p.Y[k]), V);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      if ($('#sbNames').checked) { // 名字颜色：天族 白/阵亡灰白，魔族 红/阵亡暗红；阵亡＝最近一次阵亡后还没移动过；阵营未知保持原样
        let lc = '#e6eef8'; if (p.race === 0 || p.race === 1) { let dead = false; for (const d of SB.deaths) { if (d.p !== p || d.t > t) continue; const kd = posAt(p, d.t); if (kd !== null && p.X[kd] === p.X[k] && p.Y[kd] === p.Y[k]) dead = true; }
          lc = p.race === 0 ? (dead ? '#9a9a9a' : '#ffffff') : (dead ? '#7a1010' : '#ff3b3b'); ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 3; }
        ctx.fillStyle = lc; ctx.font = '11px sans-serif'; ctx.fillText(p.name, x + 6, y - 4); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
      SB.pts.push({ x, y, p }); if (p.race === 0) ce++; else if (p.race === 1) ca++;
    }
    if ($('#sbDeath').checked) { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
      for (const d of SB.deaths) { if (d.t > t || t - d.t > 15) continue; const k = posAt(d.p, d.t) ?? posAt(d.p, d.t + 20); if (k === null) continue;
        const [x, y] = scr(...base(d.p.X[k], d.p.Y[k]), V); ctx.globalAlpha = 1 - (t - d.t) / 15;
        ctx.strokeStyle = RCOL[d.k.vr] || '#ef4444'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); ctx.globalAlpha = 1; } }
    const dk = dsplit(SB.b.kills.filter(k => k.t <= t));
    $('#sbTime').innerHTML = `${mmss(t)} / ${mmss(SB.tr.duration)} · <span class="ely">天族 ${ce}</span> · <span class="asm">魔族 ${ca}</span> · <span class="dead">阵亡 ${dk.t}</span>（<span class="ely">天 ${dk.e}</span> / <span class="asm">魔 ${dk.m}</span>）`;
    $('#sbSlider').value = Math.floor(t);
  }
  function tick(ts) {
    if (SB.playing && SB.tr) { const dt = SB.last ? (ts - SB.last) / 1000 : 0; SB.t = Math.min(SB.tr.duration, SB.t + dt * +$('#sbSpeed').value);
      if (SB.t >= SB.tr.duration) { SB.playing = false; $('#sbPlay').textContent = '▶ 播放'; } draw(); }
    SB.last = ts; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  $('#sbPlay').onclick = () => { if (!SB.tr) return; if (SB.t >= SB.tr.duration) SB.t = 0; SB.playing = !SB.playing; $('#sbPlay').textContent = SB.playing ? '⏸ 暂停' : '▶ 播放'; };
  $('#sbSlider').oninput = e => { SB.t = +e.target.value; draw(); };
  $('#sbBattle').onchange = e => openSandbox(+e.target.value);
  $('#sbLayer').onchange = e => setLayer(e.target.value);
  $('#sbMap').onchange = e => { SB.forceMap = e.target.value; if (!SB.forceMap) SB.forceMap = ''; openSandbox(+$('#sbBattle').value); };
  ['#sbE', '#sbA', '#sbU', '#sbNames', '#sbDeath'].forEach(s => $(s).onchange = draw);
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, V = view();
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2, nz = Math.max(.5, Math.min(40, SB.zoom * f)), k = nz / SB.zoom;
    SB.zoom = nz; const W = cv.clientWidth, H = cv.clientHeight, s = Math.min(W, H) * nz;
    const ox = mx - (mx - V.ox) * k, oy = my - (my - V.oy) * k; SB.panX = ox - (W - s) / 2; SB.panY = oy - (H - s) / 2; draw(); }, { passive: false });
  let drag = null, pinch = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, px: SB.panX, py: SB.panY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!drag || pinch) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; SB.panX = drag.px + dx; SB.panY = drag.py + dy; draw(); });
  cv.addEventListener('pointerup', e => { if (drag && !drag.moved) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 144; SB.pts.forEach(q => { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = q; } });
      const tip = $('#sbTip'); if (best) { tip.hidden = false; tip.style.left = (best.x + 10) + 'px'; tip.style.top = (best.y + 10) + 'px';
        tip.innerHTML = `<b>${esc(best.p.name)}</b><br>${esc(best.p.legion)} ${race(best.p.race)}`; } else tip.hidden = true; }
    drag = null; });
  cv.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: SB.zoom }; } }, { passive: true });
  cv.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { const [a, b] = e.touches; SB.zoom = Math.max(.5, Math.min(40, pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d)); draw(); } }, { passive: true });
  cv.addEventListener('touchend', () => { pinch = null; });
  window.addEventListener('resize', draw);

  // —— 军阶 / 军团详情 / 变身（参照 Batch25 LegionDetailWindow 与变身板块）——
  const RANKS = ['无军阶', '九等兵', '八等兵', '七等兵', '六等兵', '五等兵', '四等兵', '三等兵', '二等兵', '一等兵', '1星将校', '2星将校', '3星将校', '4星将校', '5星将校', '将军', '大将军', '司令官', '总司令官'];
  const rankName = (r, race) => r == null || r < 0 || r > 18 ? '' : r === 0 ? RANKS[0] : (race === 0 ? '天军' : race === 1 ? '魔军' : '') + RANKS[r];
  function modal(id) {
    let box = $('#' + id); if (!box) { document.body.insertAdjacentHTML('beforeend', `<div id="${id}" class="pmask"><div class="pbox"></div></div>`); box = $('#' + id); box.onclick = e => { if (e.target === box || e.target.classList.contains('px')) box.style.display = 'none'; }; }
    box.style.display = 'flex'; return box.querySelector('.pbox');
  }
  const stat = (l, v, c) => `<div class="pf-stat"><span>${l}</span><b class="${c || ''}">${v}</b></div>`;
  async function openLegion(name, race) {
    const inner = modal('legion'); inner.innerHTML = '<p class="note">加载中…</p>';
    let pr = {}; try { pr = await getProf(data.date) || {}; } catch {}
    const kd = pr.kd || {}, st = pr.st || {}, rk = pr.rk || {};
    const mem = data.players.filter(p => p.legion === name && p.race === race).map(p => {
      const k = kd[p.name] || [0, 0], s = st[p.id] || [0, 0, 0], r = rk[p.id];
      return { p, kills: k[0], deaths: k[1], pvp: p.pvpSkill + p.pvpAuto, taken: s[0] || 0, heal: s[1], aoe: s[2], rev: s[3] || 0, lv: r ? r[1] : 0 };
    }).filter(m => m.pvp + m.p.pveSkill + m.p.pveAuto + m.kills + m.deaths + m.heal > 0).sort((a, b) => b.pvp - a.pvp);
    const sum = k => mem.reduce((s, m) => s + m[k], 0);
    const cc = {}; mem.forEach(m => { if (m.p.classId) cc[m.p.classId] = (cc[m.p.classId] || 0) + 1; });
    const bt = battles.map((b, i) => { const ids = new Set(mem.map(m => m.p.id)); const d = b.damage.filter(x => ids.has(x.id)); const names = new Set(mem.map(m => m.p.name));
      return { i, b, n: d.filter(x => x.pvpSkill + x.pvpAuto > 0).length, pvp: d.reduce((s, x) => s + x.pvpSkill + x.pvpAuto, 0), k: b.kills.filter(x => names.has(x.killer)).length, v: b.kills.filter(x => names.has(x.victim)).length }; }).filter(x => x.n + x.k + x.v > 0);
    const rc = race === 0 ? 'r0' : 'r1';
    inner.innerHTML = `<button class="px">✕</button><h2 class="${rc}">${esc(name)}</h2><div class="pf-sub">${race === 0 ? '天族' : '魔族'} · 参战 ${fmt(mem.length)} 人 · ${data.date}</div>
      <div class="pf-stats">${stat('参战人数', fmt(mem.length), rc)}${stat('击杀总数', fmt(sum('kills')), 'gold')}${stat('阵亡次数', fmt(sum('deaths')), rc)}${stat('PvP伤害总数', fmt(sum('pvp')))}${stat('PvP承伤总量', fmt(sum('taken')))}${stat('复活', fmt(sum('rev')))}${stat('治疗总数', fmt(sum('heal')))}${stat('AOE技能伤害总和', fmt(sum('aoe')))}</div>
      <h4>参战人数 · 各职业</h4><div class="pf-chips">${Object.keys(cc).sort((a, b) => cc[b] - cc[a]).map(c => `<span>${cls(+c)} <b>${cc[c]}</b></span>`).join('') || '-'}</div>
      <h4>各场战斗（${bt.length}）</h4>${bt.length ? `<div class="pf-scroll"><table class="kv"><tr><th class="t">场次</th><th>参战</th><th>PvP</th><th>击杀</th><th>阵亡</th></tr>${bt.map(x => `<tr><td class="t">第 ${x.b.no} 场 ${hm(x.b.start)} ${esc(mapName(x.b.map))}</td><td>${x.n}</td><td>${fmt(x.pvp)}</td><td>${x.k}</td><td class="${rc}">${x.v}</td></tr>`).join('')}</table></div>` : '<p class="note">无</p>'}
      <h4>成员明细（${mem.length}）</h4><div class="pf-scroll pf-rel" style="max-height:420px"><table class="kv"><tr><th class="t">玩家 ／ 等级 · 职业</th><th>击杀</th><th>阵亡</th><th>PvP伤害</th><th>PvP承伤</th><th>治疗</th><th>复活</th></tr>${mem.map(m => `<tr><td class="t"><b class="pn r${m.p.race}" data-id="${m.p.id}">${esc(m.p.name)}</b><div class="pf-sl">${m.lv ? 'Lv' + m.lv + ' · ' : ''}${cls(m.p.classId)}</div></td><td>${m.kills}</td><td>${m.deaths}</td><td>${fmt(m.pvp)}</td><td>${fmt(m.taken)}</td><td>${fmt(m.heal)}</td><td>${fmt(m.rev)}</td></tr>`).join('')}</table></div>`;
  }
  document.addEventListener('click', e => { const t = e.target.closest('.ln'); if (t) openLegion(t.dataset.lg, +t.dataset.r); });
  async function renderTransform() {
    const el = $('#tf'); if (!el || !data) return; el.innerHTML = '<p class="note">加载中…</p>';
    let pr = {}; try { pr = await getProf(data.date) || {}; } catch {}
    const kd = pr.kd || {}, st = pr.st || {}, rk = pr.rk || {};
    const P = filt(data.players, ['name', 'legion']).filter(p => rk[p.id] && rk[p.id][0] >= 14).map(p => { const k = kd[p.name] || [0, 0], s = st[p.id] || [0, 0, 0];
      return { ...p, rank: rk[p.id][0], lv: rk[p.id][1], kills: k[0], deaths: k[1], pvp: p.pvpSkill + p.pvpAuto, taken: s[0], heal: s[1] }; });
    el.innerHTML = [0, 1].map(r => { const L = P.filter(p => p.race === r).sort((a, b) => b.pvp - a.pvp);
      return `<div class="tf-col"><h2 class="sec r${r}">${r === 0 ? '天族' : '魔族'}变身玩家（${L.length}）</h2><div class="tw"><table><thead><tr><th class="t">#</th><th class="t">玩家 ／ 等级 · 职业 · 军团</th><th class="t">军阶称谓</th><th>击杀</th><th>阵亡</th><th>PvP伤害</th><th>PvP受到</th><th>治疗</th></tr></thead><tbody>${L.map((p, i) => `<tr><td class="t rk">${i + 1}</td><td class="t"><b class="pn r${r}" data-id="${p.id}">${esc(p.name)}</b><div class="pf-sl">${p.lv ? 'Lv' + p.lv + ' · ' : ''}${cls(p.classId)}${p.legion ? ' · <span class="ln" data-lg="' + esc(p.legion) + '" data-r="' + r + '">' + esc(p.legion) + '</span>' : ''}</div></td><td class="t">${RANKS[p.rank]}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${fmt(p.pvp)}</td><td>${fmt(p.taken)}</td><td>${fmt(p.heal)}</td></tr>`).join('') || '<tr><td colspan="8" class="t note">无</td></tr>'}</tbody></table></div></div>`; }).join('');
  }
  // —— 玩家资料卡（点名字打开；技能/击杀和跨日索引按需加载）——
  async function getProf(d) { if (!(window.AION_PROF && window.AION_PROF[d])) await loadScript(`${DP}prof/${d}.js`); return window.AION_PROF[d]; }
  async function getSk(d, id) { if (!window.AION_SKILLNAMES) { try { await loadScript(DP + 'skillnames.js'); } catch {} } const n = id % 16; if (!(window.AION_SK && window.AION_SK[d] && window.AION_SK[d][n])) await loadScript(`${DP}sk/${d}/${n}.js`); return window.AION_SK[d][n][id] || []; }
  // 技能表（单独函数，方便以后换皮）：[技能, PvP, PvE, PvP命中, PvE命中, 可判暴击, 暴击, 最大]
  function skillTable(sk) {
    if (!sk.length) return '<p class="note">无</p>';
    const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
    return `<div class="pf-scroll"><table class="kv pf-skills"><tr><th class="t">技能</th><th>总伤害</th><th>PvP</th><th>PvE</th><th>命中</th><th>暴击率</th><th>平均</th><th>最大</th></tr>${sk.map(s => { const tot = s[1] + s[2], n = s[3] + s[4];
      return `<tr><td class="t" title="技能ID ${s[0]}">${sic(s[0])}${s[0] === 0 ? '普攻' : esc((window.AION_SKILLNAMES || {})[s[0]] || '#' + s[0])}</td><td>${fmt(tot)}</td><td>${fmt(s[1])}</td><td>${fmt(s[2])}</td><td>${fmt(n)}</td><td>${s[0] === 0 ? '-' : pct(s[6], s[5])}</td><td>${fmt(n ? Math.round(tot / n) : 0)}</td><td>${fmt(s[7])}</td></tr>`; }).join('')}</table></div>`;
  }
  async function getRel(d, id) { const n = id % 16; if (!(window.AION_REL && window.AION_REL[d] && window.AION_REL[d][n])) await loadScript(`${DP}rel/${d}/${n}.js`); return window.AION_REL[d][n][id] || {}; }
  // 关系列表（组件）：rows=[[id,值,次数]] 或击杀 [[名字,id,[时间...]]]
  const pnm = (id, nm) => { const q = byId[id]; return q ? `<b class="pn r${q.race}" data-id="${id}">${esc(q.name)}</b>` : esc(nm || ('#' + id)); };
  function relTable(title, rows, cols) {
    if (!rows || !rows.length) return `<h4>${title}</h4><p class="note">无</p>`;
    return `<h4>${title}（${rows.length}）</h4><div class="pf-scroll pf-rel"><table class="kv"><tr><th class="t">玩家</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr><td class="t">${pnm(r[0], r[3])}</td><td>${fmt(r[1])}</td><td>${fmt(r[2])}</td></tr>`).join('')}</table></div>`;
  }
  function killTable(title, rows) {
    if (!rows || !rows.length) return `<h4>${title}</h4><p class="note">无</p>`;
    return `<h4>${title}（${rows.reduce((s, r) => s + r[2].length, 0)}）</h4><div class="pf-scroll pf-rel"><table class="kv"><tr><th class="t">玩家</th><th>次数</th><th class="t">时间</th></tr>${rows.map(r => `<tr><td class="t">${r[1] ? pnm(r[1], r[0]) : esc(r[0])}</td><td>${r[2].length}</td><td class="t tm">${r[2].map(s => hms(s)).join(' ')}</td></tr>`).join('')}</table></div>`;
  }
  // —— 资料卡扩展（施法/攻击结果/增益减益/外观/阵亡/NPC），按需加载 ——
  async function getPx(d, id) { const n = id % 16; try { await loadScript('img/sk/ids.js'); } catch {}
    try { if (!(window.AION_PXN && window.AION_PXN[d])) await loadScript(`${DP}px/${d}/names.js`); if (!(window.AION_PX && window.AION_PX[d] && window.AION_PX[d][n])) await loadScript(`${DP}px/${d}/${n}.js`); } catch { return {}; }
    return window.AION_PX[d][n][id] || {}; }
  const sic = id => window.AION_SKICON && window.AION_SKICON.has(+id) ? `<img class="si" src="img/sk/${id}.png" width="20" height="20" loading="lazy" alt="">` : '';
  const skn = (id, d) => esc((window.AION_SKILLNAMES || {})[id] || ((window.AION_PXN || {})[d] || {})[id] || '#' + id);
  const npcn = (id, d) => { const nm = ((((window.AION_PXN || {})[d] || {})._n) || {})[id]; return nm ? esc(nm) : 'NPC ' + esc(id); };
  // 阵亡（合并）：PvP 击杀者来自击杀消息 rl.kb；自杀/环境/NPC 来自 0x0025（不计入 PvP 击杀）
  function deathTable(kb, xd, d) {
    const rows = (kb || []).map(r => [r[1] ? pnm(r[1], r[0]) : esc(r[0]), r[2]]);
    (xd || []).filter(k => k[2] !== 'p').forEach(k => rows.push([k[2] === 'n' ? npcn(k[0].slice(1), d) + ' <span class="note">NPC</span>' : `<span class="dead">${esc(k[0])}</span>`, k[3] || []]));
    if (!rows.length) return '<h4>阵亡</h4><p class="note">无</p>';
    return `<h4>阵亡（${rows.reduce((s, r) => s + r[1].length, 0)}）</h4><div class="pf-scroll pf-rel"><table class="kv"><tr><th class="t">击杀者</th><th>次数</th><th class="t">时间</th></tr>${rows.map(r => `<tr><td class="t">${r[0]}</td><td>${r[1].length}</td><td class="t tm">${r[1].map(s => hms(s)).join(' ')}</td></tr>`).join('')}</table></div>`;
  }
  function pxHtml(x, d) {
    const sec = (t, body, open) => `<details class="pxs"${open ? ' open' : ''}><summary>${t}</summary>${body}</details>`;
    let h = '';
    if (x.c) h += sec(`施法 ${fmt(x.c[0])} 次 · 被打断 ${fmt(x.c[1])} 次`, `<div class="pf-scroll"><table class="kv"><tr><th class="t">技能</th><th>施放</th><th>被打断</th></tr>${x.c[2].map(s => `<tr><td class="t">${sic(s[0])}${skn(s[0], d)}</td><td>${fmt(s[1])}</td><td>${fmt(s[2])}</td></tr>`).join('')}</table></div>`);
    if (x.ra || x.rr || x.cc) { const L = ['普通', '暴击', '格挡', '闪避', '抵抗'], I = [0, 1, 3, 4, 5], r = v => I.map(i => `<td>${fmt((v || [])[i] || 0)}</td>`).join('');
      h += sec('攻击结果与被控制', `<table class="kv"><tr><th class="t">PvP 技能</th>${L.map(l => `<th>${l}</th>`).join('')}</tr><tr><td class="t">打出</td>${r(x.ra)}</tr><tr><td class="t">受到</td>${r(x.rr)}</tr></table>
        <table class="kv"><tr><th class="t">被控制</th><th>击倒</th><th>麻痹</th><th>沉默</th><th>失明</th><th>晕厥</th></tr><tr><td class="t">次数</td>${[0, 1, 2, 3, 4].map(i => (x.cc || [])[i] || 0).map(n => `<td>${fmt(n)}</td>`).join('')}</tr></table>`, true); }
    if (x.bf) h += sec(`受到的增益/减益（${x.bf.length}）`, `<div class="pf-scroll"><table class="kv"><tr><th class="t">效果</th><th>类型</th><th>槽位</th><th>次数</th><th class="t">主要来源</th></tr>${x.bf.map(b => `<tr><td class="t">${sic(b[0])}${skn(b[0], d)}</td><td class="${b[2] === 2 ? 'dead' : ''}">${['-', '增益', '减益'][b[2]]}</td><td>${b[1]}</td><td>${fmt(b[3])}</td><td class="t">${esc(b[4])}</td></tr>`).join('')}</table></div>`);
    if (x.e) h += sec(`外观装备（${x.e.length}）`, `<div class="pf-chips">${x.e.map(i => { const nm = ((((window.AION_PXN || {})[d] || {})._i) || {})[i]; return `<span title="物品ID ${i}">${esc(nm || String(i))}</span>`; }).join('')}</div>`);
    if (x.n) h += sec(`被 NPC 盯住（${x.n.length}）`, `<table class="kv"><tr><th class="t">NPC</th><th>次数</th></tr>${x.n.map(k => `<tr><td class="t" title="模板 ${esc(k[0])}">${npcn(k[0], d)}</td><td>${fmt(k[1])}</td></tr>`).join('')}</table>`);
    return h;
  }
  let byName = {};
  function revTable(title, rows) {
    if (!rows || !rows.length) return `<h4>${title}</h4><p class="note">无</p>`;
    return `<h4>${title}（${rows.reduce((s, r) => s + r[2], 0)}次）</h4><div class="pf-scroll pf-rel"><table class="kv"><tr><th class="t">玩家</th><th>复活</th></tr>${rows.map(r => `<tr><td class="t">${r[1] ? pnm(r[1], r[0]) : esc(r[0])}</td><td>${r[2]}</td></tr>`).join('')}</table></div>`;
  }
  const hms = s => new Date(s * 1000).toLocaleTimeString('zh-CN', { ...tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  async function getPlayers() { if (!window.AION_PLAYERS) await loadScript(DP + 'players.js'); return window.AION_PLAYERS; }
  async function openProfile(id) {
    const p = byId[id]; if (!p) return;
    let box = $('#prof'); if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="prof" class="pmask"><div class="pbox"></div></div>'); box = $('#prof'); box.onclick = e => { if (e.target === box || e.target.classList.contains('px')) box.style.display = 'none'; }; }
    const inner = box.querySelector('.pbox'); box.style.display = 'flex'; inner.innerHTML = '<p class="note">加载中…</p>';
    let pr = null, pl = null; try { pr = await getProf(data.date); } catch {} try { pl = await getPlayers(); } catch {}
    const kd = (pr && pr.kd && pr.kd[p.name]) || [0, 0];
    const bt = battles.map((b, i) => { const d = b.damage.find(x => x.id === id); const k = b.kills.filter(x => x.killer === p.name).length, v = b.kills.filter(x => x.victim === p.name).length;
      return (d || k || v) ? { i, b, pvp: d ? d.pvpSkill + d.pvpAuto : 0, tk: d ? d.taken || 0 : 0, pve: d ? d.pveSkill + d.pveAuto : 0, k, v } : null; }).filter(Boolean);
    let sk = []; try { sk = await getSk(data.date, id); } catch {}
    let rl = {}; try { rl = await getRel(data.date, id); } catch {}
    const px = await getPx(data.date, id); byName = {}; data.players.forEach(q => { if (!(q.name in byName)) byName[q.name] = q.id; });
    const days = (pl && pl[p.name + '|' + p.race]) || [];
    const row = (a, b) => `<tr><td class="t">${a}</td><td>${b}</td></tr>`;
    inner.innerHTML = `<button class="px">✕</button><h2>${esc(p.name)} ${race(p.race)}</h2>
      <table class="kv">${row('军团', p.legion ? `<span class="ln" data-lg="${esc(p.legion)}" data-r="${p.race}">${esc(p.legion)}</span>` : '（无）')}${(pr && pr.rk && pr.rk[id]) ? row('等级', pr.rk[id][1] || '-') + row('深渊军阶', rankName(pr.rk[id][0], p.race)) : ''}${p.classId ? row('职业', cls(p.classId)) : ''}${row('日期', data.date)}</table>
      <h4>当天伤害</h4><table class="kv">${row('PvP 技能', fmt(p.pvpSkill))}${row('PvP 普攻', fmt(p.pvpAuto))}${row('PvP 承伤', fmt(p.taken))}${row('PvE 技能', fmt(p.pveSkill))}${row('PvE 普攻', fmt(p.pveAuto))}${row('击杀 / 阵亡', `${kd[0]} / <span class="dead">${kd[1]}</span>`)}</table>
      <h4>参与的战斗（${bt.length}）</h4>${bt.length ? `<div class="pf-scroll"><table class="kv"><tr><th class="t">场次</th><th>PvP</th><th>PvP承伤</th><th>PvE</th><th>击杀</th><th>阵亡</th></tr>${bt.map(x => `<tr><td class="t"><a href="#" data-b="${x.i}">第 ${x.b.no} 场 ${hm(x.b.start)} ${esc(mapName(x.b.map))}</a></td><td>${fmt(x.pvp)}</td><td>${fmt(x.tk)}</td><td>${fmt(x.pve)}</td><td>${x.k}</td><td>${x.v}</td></tr>`).join('')}</table></div>` : '<p class="note">无</p>'}
      <h4>使用的技能</h4>${skillTable(sk)}
      ${pxHtml(px, data.date)}
      ${relTable('攻击了谁（PvP）', rl.a, ['伤害', '命中'])}${relTable('被谁攻击（PvP）', rl.b, ['伤害', '命中'])}
      ${killTable('击杀了谁', rl.k)}${deathTable(rl.kb, px.d, data.date)}${relTable('被谁治疗', rl.h, ['治疗量', '次数'])}${revTable('复活了谁', rl.rv)}${revTable('被谁复活', rl.rb)}
      <h4>出现过的日期（${days.length}）</h4>${days.length ? `<table class="kv"><tr><th class="t">日期</th><th>PvP</th><th>PvE</th></tr>${days.map(x => `<tr><td class="t"><a href="#" data-d="${x[0]}" data-id="${x[1]}">${x[0]}</a></td><td>${fmt(x[2])}</td><td>${fmt(x[3])}</td></tr>`).join('')}</table>` : '<p class="note">-</p>'}`;
    inner.querySelectorAll('a[data-b]').forEach(a => a.onclick = e => { e.preventDefault(); box.style.display = 'none'; showTab('battles'); curBattle = +a.dataset.b; renderBattleList(); renderBattleDetail(curBattle); });
    inner.querySelectorAll('a[data-d]').forEach(a => a.onclick = async e => { e.preventDefault(); const d = a.dataset.d, pid = +a.dataset.id;
      if (d !== data.date) { $('#date').value = d; await load(d); } openProfile(pid); });
  }
  document.addEventListener('click', e => { const t = e.target.closest('.pn'); if (t) openProfile(+t.dataset.id); });

  // —— 通用 ——
  function showTab(name) {
    document.querySelectorAll('#tabs button, .tab').forEach(x => x.classList.remove('on'));
    document.querySelector(`#tabs button[data-tab="${name}"]`).classList.add('on'); $('#' + name).classList.add('on');
    if (name === 'transform') renderTransform();
    if (name === 'sandbox') { if (!SB.tr && battles.length) openSandbox(+$('#sbBattle').value || 0); else draw(); }
  }
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  async function load(d) {
    $('#summary').innerHTML = '<div class="card">加载中…</div>';
    const day = await getDay(d);
    data = JSON.parse(JSON.stringify(day.daily)); battles = day.battles || [];
    data.players.forEach(enrich); data.legions.forEach(enrich); data.skillPatterns ||= [];
    { let st = {}; try { st = ((await getProf(d)) || {}).st || {}; } catch {} const lt = {};
      data.players.forEach(p => { const s = st[p.id]; p.taken = s ? s[0] : 0; p.rev = s ? (s[3] || 0) : 0; const k = p.legion + '|' + p.race; lt[k] = (lt[k] || 0) + p.taken; });
      data.legions.forEach(l => l.taken = lt[l.legion + '|' + l.race] || 0); }
    byId = {}; data.players.forEach(p => byId[p.id] = p);
    limit = 100; curBattle = -1; SB.tr = null; fillSandboxSelect(); render();
    if ($('#sandbox').classList.contains('on') && battles.length) openSandbox(0); else draw();
    
    history.replaceState(null, '', '#' + SRV + '/' + d);
  }
  ['#q', '#race', '#cls'].forEach(s => $(s).addEventListener('input', () => { limit = 100; render(); }));
  const fail = err => $('#summary').innerHTML = `<div class="card">${esc(err.message)}</div>`;
  $('#date').onchange = e => load(e.target.value).catch(fail);
  const dates = D.index || [];
  $('#date').innerHTML = dates.map(d => `<option>${d}</option>`).join('');
  const hp = location.hash.slice(1).split('/'); if (/^s\d$/.test(hp[0])) hp.shift();
  const want = hp[0], wantTab = hp[1], wantIdx = hp[2];
  if (dates.includes(want)) $('#date').value = want;
  if (dates.length) load($('#date').value).then(() => { if (wantIdx !== undefined && battles[+wantIdx]) { curBattle = +wantIdx; $('#sbBattle').value = wantIdx; renderBattleList(); renderBattleDetail(curBattle); if (wantTab === 'sandbox') openSandbox(curBattle); }
    if (wantTab) showTab(wantTab); }).catch(fail);
  else $('#summary').innerHTML = '<div class="card">暂无数据</div>';
})();
