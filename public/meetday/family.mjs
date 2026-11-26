// NSEA Meet Day for families. Opened from a private link (/meetday/#k=<key>) that a coach made in Meet Day › Tools ›
// Families. Read-only: the server sends only this family's swimmers in full plus teammates' names (worker/meetday-family.mjs).
// Keeps the last copy on the phone so it opens with no signal, and checks for changes every 25 seconds.
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (cs) => { if (cs == null) return ''; const m = Math.floor(cs / 6000), s = ((cs % 6000) / 100).toFixed(2); return m ? `${m}:${s.padStart(5, '0')}` : s; };
const sgn = (d) => (d == null ? '' : `${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}`);
const clockMin = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if (!m) return null; let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
const hm = (s) => String(s || '').replace(/^0/, '');
const dayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const dayShort = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const evName = (t) => String(t || '').replace(/^(Girls|Boys|Women|Men|Mixed)\s+/i, '');
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), ms); }
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem('md-' + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('md-' + k, JSON.stringify(v)); } catch { /* full or private */ } } };

// ---------- key ----------
// The key comes in the link's #k=…; it's kept on the phone (and in the address, so Add to Home Screen keeps it).
const fromHash = (location.hash.match(/[#&]k=([A-Za-z0-9_-]{20,64})/) || [])[1];
const KEY = fromHash || store.get('key');
if (fromHash) store.set('key', fromHash);
if (KEY) {
  $('#manifest').href = `/api/meetday/family/manifest?k=${KEY}`;
  caches.open('meetday-family-key').then((c) => c.put('/meetday/__key', new Response(KEY))).catch(() => {});
}

const S = { me: store.get('me'), meetId: store.get('meet'), view: null, online: navigator.onLine, err: null, at: null, day: null, sess: null };
async function api(method, path, body) {
  const r = await fetch('/api/meetday/family' + path, { method, headers: { 'x-family-key': KEY, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let j = {}; try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const route = () => { const p = location.hash.replace(/^#\/?/, '').replace(/^k=[^/]*/, '').split('/').filter(Boolean); return { v: p[0] || 'today', a: p[1] }; };
const go = (h) => { location.hash = h; };

// ---------- load + refresh ----------
async function refresh() {
  if (!KEY) return render();
  try {
    S.me = await api('GET', '/me'); store.set('me', S.me);
    const ids = S.me.meets.map((m) => m.id);
    if (!ids.includes(S.meetId)) S.meetId = pickMeet(S.me.meets);
    store.set('meet', S.meetId);
    if (S.meetId) {
      const old = S.view || store.get('view:' + S.meetId);
      const v = await api('GET', `/meet?id=${encodeURIComponent(S.meetId)}${old && old.v ? '&v=' + encodeURIComponent(old.v) : ''}`);
      if (!v.same) { S.view = v; store.set('view:' + S.meetId, v); } else S.view = old;
    } else S.view = null;
    S.err = null; S.at = new Date(); S.online = true;
  } catch (e) {
    S.err = e; if (e.status === 401) { S.me = null; S.view = null; }
    if (!S.view && S.meetId) S.view = store.get('view:' + S.meetId);
  }
  syncBadge();
  // Don't redraw while someone is typing feedback.
  if (document.activeElement?.id !== 'fb') render();
}
function pickMeet(meets) {
  const t = todayIso();
  return (meets.find((m) => m.start <= t && m.end >= t) || meets.find((m) => m.start > t) || meets[meets.length - 1] || {}).id || null;
}
function syncBadge() {
  const b = $('#sync');
  if (!navigator.onLine || (S.err && S.err.status == null)) { b.textContent = 'offline'; b.className = 'sync off'; return; }
  b.className = 'sync';
  b.textContent = S.at ? `updated ${S.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '…';
}

// ---------- render ----------
function render() {
  const r = route();
  if (!KEY || (S.err && S.err.status === 401)) return renderNoKey();
  const V = S.view;
  if (!V) { tabs(r); app.innerHTML = S.me ? noMeet() : '<p class="empty">Loading…</p>'; return; }
  tabs(r);
  if (r.v === 'meet') return renderMeet(V);
  if (r.v === 'team') return renderTeam(V, r.a);
  if (r.v === 'info') return renderInfo(V);
  return renderToday(V, r.a);
}
function tabs(r) {
  const items = [['#/today', 'Today', 'my swims', r.v === 'today'], ['#/meet', 'Meet', 'all days', r.v === 'meet'], ['#/team', 'Team', 'heats & lanes', r.v === 'team'], ['#/info', 'Info', 'warm-up · more', r.v === 'info']];
  $('#tabs').innerHTML = S.view ? items.map(([h, t, s, on]) => `<a href="${h}" ${on ? 'aria-current="page"' : ''}>${esc(t)}<small>${esc(s)}</small></a>`).join('') : '';
}
function renderNoKey() {
  $('#tabs').innerHTML = '';
  app.innerHTML = `<div class="card"><h1>Meet Day</h1><p>${S.err && S.err.status === 401 ? 'This family link isn’t working any more.' : 'Open Meet Day from the private link your coach sent you.'}</p>
    <p class="small muted">Ask a coach for a new link, or email team@nseaswim.com.</p></div>`;
}
function noMeet() {
  return `<div class="hello"><p class="kicker">${esc(S.me.family ? S.me.family + ' family' : 'Your family')}</p><h1>No meet open yet</h1></div>
    <div class="card"><p>Meet Day opens for families when the coaches turn it on for a meet your swimmer${S.me.swimmers.length > 1 ? 's are' : ' is'} entered in.</p>
    <p class="small muted">Linked swimmers: ${esc(S.me.swimmers.join(', ') || 'none yet')}.</p></div>${feedbackCard()}`;
}
const meetChips = () => (S.me && S.me.meets.length > 1 ? `<div class="chips" style="margin-bottom:10px">${S.me.meets.map((m) => `<button class="chip" data-act="meet" data-id="${esc(m.id)}" aria-pressed="${m.id === S.meetId}">${esc(m.short || m.name)}</button>`).join('')}</div>` : '');
const meetDays = (V) => V.days.map((d) => d.day);
function curDay(V) {
  const t = todayIso(), ds = meetDays(V);
  return ds.includes(t) ? t : ds.find((d) => d > t) || ds[ds.length - 1];
}
const many = (V) => V.swimmers.length > 1;
const ordered = (list) => [...list].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (clockMin(a.start) ?? 9999) - (clockMin(b.start) ?? 9999) || a.session - b.session || a.event - b.event);

function swimCard(s, V, { soon = false } = {}) {
  const r = s.result;
  const where = [s.heat ? `Heat ${s.heat}${s.of ? ' of ' + s.of : ''}` : 'Heat TBD', s.lane ? `Lane ${s.lane}` : ''].filter(Boolean).join(' · ');
  const meta = [s.pool, s.start ? `about ${hm(s.start)}${s.est ? ' (estimated)' : ''}` : '', s.seed != null ? `seed ${fmt(s.seed)}` : 'no seed time'].filter(Boolean).join(' · ');
  const pills = [];
  if (s.isFinal) pills.push('<span class="pill fin">Final</span>');
  let res = '';
  if (s.scratched) res = '<div class="res"><span class="pill">Scratched</span></div>';
  else if (r) {
    if (r.time != null) {
      const vs = s.isFinal && s.dPrelim != null ? `<span class="${s.dPrelim < 0 ? 'drop' : 'add'}">${sgn(s.dPrelim)} vs prelims</span> ` : '';
      res = `<div class="res"><span class="time">${fmt(r.time)}</span>${vs}${s.dEntry != null ? `<span class="${s.dEntry < 0 ? 'drop' : 'add'}">${sgn(s.dEntry)} vs entry</span>` : ''}
        ${s.best ? '<span class="pill best">Best time</span>' : ''}${s.cuts.map((c) => `<span class="pill cut">New cut: ${esc(c.label)}</span>`).join('')}
        ${s.honors.map((h) => `<span class="pill rec">${h.kind === 'record' ? 'NEW ' : ''}${esc(h.label)}${h.sub ? ' · ' + esc(h.sub) : ''}</span>`).join('')}
        ${r.official ? '' : '<span class="pill unoff">Unofficial</span>'}</div>`;
    } else res = `<div class="res"><span class="time">${esc(r.status || '')}</span>${r.status === 'DQ' ? `<span class="small muted">${esc(s.dqWhy || 'Disqualified — your coach will talk it through with your swimmer.')}</span>` : ''}${r.official ? '' : '<span class="pill unoff">Unofficial</span>'}</div>`;
  }
  return `<div class="card swim ${r ? 'done' : soon ? 'soon' : ''} ${s.scratched ? 'scr' : ''}">
    <div class="row1"><div><div class="ev">#${s.event > 9000 ? 'TT' : s.event} ${esc(evName(s.title))}${s.round === 'Prelims' ? ' <span class="small muted">prelims</span>' : ''}</div>${many(V) || s.relay ? `<div class="who">${esc(s.name)}</div>` : ''}</div><div class="hl">${esc(where)}</div></div>
    <div class="meta">${esc(meta)}${pills.join('')}</div>
    ${s.relay && s.legs && s.legs.length ? `<div class="meta">Legs: ${s.legs.map((x, i) => `${i + 1} ${esc(x)}`).join(' · ')}</div>` : ''}
    ${res}</div>`;
}

function renderToday(V, dayArg) {
  const ds = meetDays(V);
  const day = ds.includes(dayArg) ? dayArg : curDay(V);
  const list = ordered(V.swims.filter((s) => s.day === day));
  const isToday = day === todayIso(), now = nowMin();
  const left = list.filter((s) => !s.result && !s.scratched);
  const next = isToday ? left.find((s) => (clockMin(s.start) ?? 9999) >= now - 3) : null;
  const D = V.days.find((d) => d.day === day);
  const nextHtml = next ? (() => { const m = clockMin(next.start) - now; return `<div class="card next"><p class="kicker">Next up${many(V) ? ' · ' + esc(next.name) : ''}</p><h2>${esc(evName(next.title))}</h2>
      <div class="big">${next.heat ? `Heat ${next.heat}` : 'Heat TBD'}${next.lane ? ` · Lane ${next.lane}` : ''}</div>
      <div class="sub">${next.pool ? esc(next.pool) + ' · ' : ''}${next.start ? `about ${hm(next.start)}${m > 0 ? ` (in ~${m < 90 ? m + ' min' : Math.round(m / 60) + ' h'})` : ' (any minute)'}` : 'time TBD'}${next.est ? ' · estimated' : ''}</div></div>`; })() : '';
  app.innerHTML = `${meetChips()}<div class="hello"><p class="kicker">${esc(V.meet.short)}</p><h1>${isToday ? 'Today' : esc(dayName(day))}</h1>
    <p class="small muted" style="margin:2px 0 0">${esc(V.swimmers.map((s) => s.name).join(' · '))}</p></div>
    ${ds.length > 1 ? `<div class="chips" style="margin-bottom:10px">${ds.map((d) => `<button class="chip" data-act="day" data-d="${d}" aria-pressed="${d === day}">${esc(dayShort(d))}${d === todayIso() ? ' · today' : ''}</button>`).join('')}</div>` : ''}
    ${nextHtml}
    ${D ? D.blocks.filter((b) => list.some((x) => b.pools.some((p) => p.n === x.session))).map((b) => b.warmup ? `<p class="wu"><b>${esc(b.name)}</b> · warm-up ${esc(b.warmup.time)}${b.warmup.group ? ' (' + esc(b.warmup.group) + ')' : ''}${b.warmup.pool ? ' · ' + esc(b.warmup.pool) : ''} · events start ${esc(hm(b.start || ''))}</p>` : '').join('') : ''}
    ${list.length ? list.map((s) => swimCard(s, V, { soon: s === next })).join('') : '<div class="card"><p class="muted">No swims this day.</p></div>'}
    ${recap(V, day)}
    <p class="small muted">Times are unofficial until the meet makes them official. Heat start times marked “estimated” are our best guess from the meet timeline; listen for the call to the blocks.</p>`;
}

function recap(V, day) {
  const sw = V.swims.filter((s) => s.day === day && !s.relay && s.result && s.result.time != null);
  if (!sw.length) return '';
  const rows = V.swimmers.map((p) => {
    const mine = sw.filter((s) => s.swimmer === p.id);
    if (!mine.length) return '';
    const best = mine.filter((s) => s.best).length, drop = mine.reduce((n, s) => n + (s.dEntry != null && s.dEntry < 0 ? -s.dEntry : 0), 0);
    const cuts = [...new Set(mine.flatMap((s) => s.cuts.map((c) => `${c.label} (${evName(s.title).replace(/^\d+ & (Under|Over) |^\d+-\d+ |^Open /, '')})`)))];
    const hon = mine.flatMap((s) => s.honors.map((h) => `${h.label} · ${evName(s.title).replace(/^\d+ & (Under|Over) |^\d+-\d+ |^Open /, '')}`));
    return `<tr><td><b>${esc(p.name)}</b><div class="small muted">${mine.length} swim${mine.length > 1 ? 's' : ''} · ${best} best time${best === 1 ? '' : 's'}</div>
      ${cuts.length ? `<div class="small">New cuts: ${esc(cuts.join(', '))}</div>` : ''}${hon.length ? `<div class="small"><b>${esc(hon.join(' · '))}</b></div>` : ''}</td><td class="num">${drop ? '−' + fmt(drop) : ''}<div class="small muted">${drop ? 'dropped' : ''}</div></td></tr>`;
  }).join('');
  const allDone = V.swims.filter((s) => s.day === day && !s.scratched).every((s) => s.result);
  return `<div class="card recap"><h3>${allDone ? 'End of day' : 'So far today'}</h3><table>${rows}</table>
    <p class="small muted" style="margin:6px 0 0">Records and Top 10 show once results are official.${navigator.share ? '' : ' Screenshot to share.'}</p>
    ${navigator.share ? `<div class="btns" style="margin-top:6px"><button class="btn sm" data-act="share-recap" data-d="${day}">Share</button></div>` : ''}</div>`;
}
function recapText(V, day) {
  const L = [`${V.meet.short} · ${dayName(day)}`];
  for (const s of ordered(V.swims.filter((x) => x.day === day && !x.relay && x.result && x.result.time != null))) {
    L.push(`${many(V) ? s.name.split(' ')[0] + ': ' : ''}${evName(s.title)} ${fmt(s.result.time)}${s.dEntry != null ? ` (${sgn(s.dEntry)})` : ''}${s.best ? ' best time' : ''}${s.cuts.length ? ' · new ' + s.cuts.map((c) => c.label).join(', ') : ''}${s.result.official ? '' : ' (unofficial)'}`);
  }
  return L.join('\n');
}

function renderMeet(V) {
  app.innerHTML = `${meetChips()}<div class="hello"><p class="kicker">${esc(V.meet.venue || V.meet.host || '')}</p><h1>${esc(V.meet.name)}</h1></div>
  ${V.days.map((d) => { const list = ordered(V.swims.filter((s) => s.day === d.day));
    return `<h2 style="margin-top:16px">${esc(dayName(d.day))}</h2>
    ${d.blocks.map((b) => `<p class="wu"><b>${esc(b.name)}</b>${b.warmup ? ` · warm-up ${esc(b.warmup.time)}${b.warmup.group ? ' (' + esc(b.warmup.group) + ')' : ''}` : ''}${b.start ? ` · events ${esc(hm(b.start))}${b.finish ? '–' + esc(hm(b.finish)) : ''}` : ''}${b.pools.length > 1 ? ' · ' + b.pools.map((p) => esc(p.pool)).join(' / ') : ''}${b.pools.every((p) => p.official) ? ' · <span class="ok-msg">official</span>' : ''}</p>`).join('')}
    ${list.length ? list.map((s) => swimCard(s, V)).join('') : '<p class="small muted">No swims this day.</p>'}`; }).join('')}`;
}

function renderTeam(V, sessArg) {
  const blocks = V.days.flatMap((d) => d.blocks.map((b) => ({ ...b, day: d.day })));
  const has = (b) => V.swims.some((x) => b.pools.some((p) => p.n === x.session));
  const cur = blocks.find((b) => String(b.n) === String(sessArg)) || blocks.find((b) => b.day === curDay(V) && has(b)) || blocks.find((b) => b.day === curDay(V)) || blocks[0];
  const ns = new Set(cur ? cur.pools.map((p) => p.n) : []);
  const rows = V.team.filter((t) => ns.has(t.session)).sort((a, b) => (clockMin(a.start) ?? 9999) - (clockMin(b.start) ?? 9999) || a.event - b.event || (a.heat ?? 99) - (b.heat ?? 99) || (a.lane ?? 99) - (b.lane ?? 99));
  const byEv = [];
  for (const t of rows) { const k = `${t.event}|${t.round}|${t.pool}`; let g = byEv.find((x) => x.k === k); if (!g) byEv.push(g = { k, t, rows: [] }); g.rows.push(t); }
  app.innerHTML = `${meetChips()}<div class="hello"><p class="kicker">Team heats &amp; lanes</p><h1>${cur ? esc(cur.name) : 'Team'}</h1>${cur ? `<p class="small muted" style="margin:2px 0 0">${esc(dayName(cur.day))}</p>` : ''}</div>
    <div class="chips" style="margin-bottom:10px">${blocks.map((b) => `<button class="chip" data-act="sess" data-s="${b.n}" aria-pressed="${cur && b.n === cur.n}">${esc(dayShort(b.day))} · ${esc(b.name.replace(/^(Friday|Saturday|Sunday|Thursday|Monday|Tuesday|Wednesday)\s+/i, ''))}</button>`).join('')}</div>
    <div class="card">${byEv.length ? byEv.map((g) => `<div class="evhead">#${g.t.event > 9000 ? 'TT' : g.t.event} ${esc(evName(g.t.title))} <small>${g.t.pool ? esc(g.t.pool) + ' · ' : ''}${g.t.start ? 'about ' + esc(hm(g.t.start)) : ''}</small></div>
      <table class="team">${g.rows.map((t) => `<tr class="${t.mine ? 'me' : ''}"><td class="hl">${t.heat ? `H${t.heat} L${t.lane ?? '–'}` : 'TBD'}</td><td>${esc(t.name)}${t.relay && t.legs && t.legs.length ? `<div class="small muted">${t.legs.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}</table>`).join('') : '<p class="muted">No NSEA swims in this session yet.</p>'}</div>
    <p class="small muted">Names only; each family sees their own swimmer's times.</p>`;
}

function renderInfo(V) {
  const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  app.innerHTML = `${meetChips()}<div class="hello"><p class="kicker">${esc(V.meet.short)}</p><h1>Meet info</h1></div>
    ${V.days.map((d) => `<details class="info" ${d.day === curDay(V) ? 'open' : ''}><summary>${esc(dayName(d.day))}: warm-ups &amp; sessions</summary><ul>${d.blocks.map((b) => `<li><b>${esc(b.name)}</b>${b.label ? ' · ' + esc(b.label) : ''}${b.warmup ? `<br>Warm-up ${esc(b.warmup.time)}${b.warmup.group ? ' · ' + esc(b.warmup.group) : ''}${b.warmup.pool ? ' · ' + esc(b.warmup.pool) : ''}${b.warmup.lanes ? ' · lanes ' + esc(b.warmup.lanes) : ''}` : ''}${b.start ? `<br>Events ${esc(hm(b.start))}${b.finish ? ' to about ' + esc(hm(b.finish)) : ''}` : ''}</li>`).join('')}</ul></details>`).join('')}
    ${V.info.map((g) => `<details class="info"><summary>${esc(g.title)}</summary><ul>${g.items.map((x) => `<li>${linkify(x)}</li>`).join('')}</ul></details>`).join('')}
    <div class="card"><h3>Phone alerts</h3><p class="small muted">A notification when your swimmer is about 15 minutes from swimming, when a time comes in, and when they make finals. This is new; tell us how it goes.</p>
      ${!pushOk ? `<p class="small">${ios && !standalone ? 'On iPhone, first add Meet Day to your Home Screen (Share › Add to Home Screen), open it from there, then turn alerts on.' : 'This browser can’t show alerts.'}</p>`
      : Notification.permission === 'denied' ? '<p class="small">Alerts are blocked for this site in your phone’s settings.</p>'
      : `<div class="btns"><button class="btn ${S.pushOn ? '' : 'solid'}" data-act="push" data-on="${S.pushOn ? 0 : 1}">${S.pushOn ? 'Turn alerts off on this phone' : 'Turn on alerts'}</button></div>`}</div>
    <div class="card"><h3>Keep it on your phone</h3><p class="small muted">${ios ? 'In Safari: Share › Add to Home Screen.' : 'In Chrome: ⋮ › Add to Home screen (or Install app).'} It opens without signal once it has loaded here. This link is private to your family; please don’t pass it on.</p></div>
    ${feedbackCard()}`;
  checkPush();
}
const linkify = (x) => esc(x).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
function feedbackCard() {
  return `<div class="card"><h3>Send feedback</h3><p class="small muted">What helped, what was confusing, what you wish it showed. Goes to the coaches.</p>
    <textarea id="fb" placeholder="Your feedback…"></textarea><div class="btns" style="margin-top:8px"><button class="btn solid" data-act="feedback">Send</button></div></div>`;
}

// ---------- alerts (Web Push) ----------
async function swReg() { return navigator.serviceWorker && (await navigator.serviceWorker.getRegistration('/meetday/')); }
async function checkPush() {
  try { const reg = await swReg(); const sub = reg && (await reg.pushManager.getSubscription()); const was = S.pushOn; S.pushOn = !!sub; if (was !== S.pushOn && route().v === 'info') render(); } catch { /* not supported */ }
}
const u8 = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
async function pushOn() {
  if ((await Notification.requestPermission()) !== 'granted') { toast('Alerts not allowed'); return; }
  const reg = (await swReg()) || (await navigator.serviceWorker.register('/meetday/sw.js', { scope: '/meetday/' }));
  await navigator.serviceWorker.ready;
  const { key } = await api('GET', '/push-key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
  await api('POST', '/push', { sub: sub.toJSON() });
  S.pushOn = true; toast('Alerts on for this phone');
}
async function pushOff() {
  const reg = await swReg(); const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) { await api('POST', '/push', { sub: sub.toJSON(), off: true }).catch(() => {}); await sub.unsubscribe(); }
  S.pushOn = false; toast('Alerts off');
}

// ---------- clicks ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  try {
    if (a === 'day') { go('#/today/' + t.dataset.d); return; }
    if (a === 'sess') { go('#/team/' + t.dataset.s); return; }
    if (a === 'meet') { S.meetId = t.dataset.id; store.set('meet', S.meetId); S.view = store.get('view:' + S.meetId); render(); refresh(); return; }
    if (a === 'feedback') {
      const text = $('#fb').value.trim(); if (!text) { toast('Type your feedback first'); return; }
      await api('POST', '/feedback', { meet: S.meetId, page: route().v, text }); $('#fb').value = ''; toast('Thanks! Sent to the coaches.'); return;
    }
    if (a === 'push') { t.disabled = true; if (t.dataset.on === '1') await pushOn(); else await pushOff(); render(); return; }
    if (a === 'share-recap') { try { await navigator.share({ title: 'Meet Day', text: recapText(S.view, t.dataset.d) }); } catch { /* cancelled */ } return; }
  } catch (e) { toast(e.message || 'That didn’t work'); t.disabled = false; }
});
window.addEventListener('hashchange', () => { if (/[#&]k=/.test(location.hash)) return; render(); window.scrollTo(0, 0); });
window.addEventListener('online', () => { S.online = true; refresh(); });
window.addEventListener('offline', () => { S.online = false; syncBadge(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

// Keep #k=… in the address only on the first page so Add to Home Screen keeps the key; move to the Today view.
if (fromHash) history.replaceState(null, '', `/meetday/#k=${fromHash}`);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/meetday/sw.js', { scope: '/meetday/' }).catch(() => {});
if (S.meetId) S.view = store.get('view:' + S.meetId);
render(); syncBadge(); refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 25000);
setInterval(() => { if (document.visibilityState === 'visible' && route().v === 'today' && document.activeElement?.id !== 'fb') render(); }, 60000);
