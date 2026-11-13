// NSEA Meet Day: coaches' meet app. Offline-first: everything renders from IndexedDB; the server is only
// for syncing between coaches and for fetching live results pages.
import { fmt, readPdf, pdfLines, parseHeatSheet, parseResults, clockMin } from './lib/parse.mjs';
import { DEFAULT_CUTS } from './lib/flags.mjs';
import { derive, sessionSummary, parseTyped, nowEvent } from './lib/model.mjs';
import { guessSession, heatSheetRows, photoHeatRows, resultOps, resultsFromText, screenshotResults, htmlToText, resultLinks } from './lib/ingest.mjs';
import * as store from './lib/store.mjs';

const CDN = {
  pdf: new URL('vendor/pdf.min.mjs', import.meta.url).href,
  pdfWorker: new URL('vendor/pdf.worker.min.mjs', import.meta.url).href,
  tess: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  tessWorker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  tessCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  tessLang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
};
const TAGS = ['Great start', 'Breakouts', 'Underwaters', 'Turns', 'Finish', 'Pacing', 'Went out fast', 'Faded', 'Stroke count', 'Talk after', 'DQ review'];
const TIER_TXT = { hit: 'Got it', under: 'Seed under', 1: '≤1%', 3: '≤3%' };
const KIND_TXT = { record: 'REC', top10: 'T10', cut: 'CUT' };

const S = { meets: [], meetId: null, pkg: null, ops: [], model: null, settings: { cuts: DEFAULT_CUTS }, me: null, online: navigator.onLine, syncing: false, lastSync: null, outbox: 0, authed: true, filter: 'all', q: '', poll: null };
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
const dayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const dayShort = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), ms); }

// ---------- server ----------
async function api(method, path, body) {
  const r = await fetch('/api/admin' + path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  if (!type.includes('json')) { const e = new Error('Sign in again (open the admin console once while online).'); e.auth = true; throw e; }
  const j = await r.json();
  if (r.status === 401) { const e = new Error(j.error || 'Not signed in'); e.auth = true; throw e; }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------- state ----------
async function loadMeet(id) {
  S.meetId = id;
  S.pkg = await store.getPkg(id);
  S.ops = S.pkg ? await store.opsFor(id) : [];
  await store.set('current', id);
  recompute();
}
function recompute() { S.model = S.pkg ? derive(S.pkg, S.ops, S.settings) : null; }
async function addOp(type, data) {
  const op = { id: rid(), meet: S.meetId, at: new Date().toISOString(), by: (S.me && S.me.name) || 'me', type, data, local: true };
  await store.putOps([op]); await store.queue(op);
  S.ops.push(op); recompute(); S.outbox++;
  render(); sync();
  return op;
}

async function sync(force) {
  if (S.syncing) return;
  S.online = navigator.onLine;
  if (!S.online) return syncBadge();
  S.syncing = true; syncBadge();
  const hadPkg = !!S.pkg; let pkgChanged = false;
  try {
    const list = await api('GET', '/meetday/meets');
    S.me = list.me; S.authed = true;
    S.meets = list.meets; await store.set('meets', S.meets); await store.set('me', S.me);
    for (const m of S.meets) {
      const local = await store.getPkg(m.id);
      if (!local || local._updated !== m.updated_at || force === m.id) {
        const r = await api('GET', '/meetday/meet/' + m.id);
        await store.putPkg({ ...r.pkg, _updated: r.updated_at });
        if (m.id === S.meetId) { S.pkg = await store.getPkg(m.id); pkgChanged = true; }
      }
    }
    if (!S.meetId && S.meets.length) await loadMeet(pickMeet(S.meets));
    // push
    const out = await store.outbox();
    for (const meet of [...new Set(out.map((o) => o.meet))]) {
      const mine = out.filter((o) => o.meet === meet);
      for (let i = 0; i < mine.length; i += 100) {
        const chunk = mine.slice(i, i + 100);
        await api('POST', '/meetday/ops', { meet, ops: chunk.map(({ id, at, type, data }) => ({ id, at, type, data })) });
        await store.unqueue(chunk.map((o) => o.id));
      }
    }
    // pull
    for (const m of S.meets) {
      let since = (await store.get('since:' + m.id)) || 0, more = true;
      while (more) {
        const r = await api('GET', `/meetday/ops?meet=${encodeURIComponent(m.id)}&since=${since}`);
        if (r.ops.length) await store.putOps(r.ops.map((o) => ({ ...o, meet: m.id, local: false })));
        since = r.last; more = r.more;
      }
      await store.set('since:' + m.id, since);
    }
    let changed = !hadPkg && !!S.pkg;
    if (S.meetId) { const ops = await store.opsFor(S.meetId); if (ops.length !== S.ops.length || pkgChanged) { S.ops = ops; changed = true; } recompute(); }
    S.failed = false; S.err = null;
    S.lastSync = new Date(); await store.set('lastSync', S.lastSync.toISOString());
    S.outbox = (await store.outbox()).length;
    // Don't redraw under someone mid-task (uploads/reviews on Tools, an open swim sheet, typing in search)
    if ((changed && !hadPkg) || (changed && route().v !== 'tools' && $('#sheet').hidden && document.activeElement?.id !== 'q')) render();
  } catch (e) {
    if (e.auth) S.authed = false;
    else if (!navigator.onLine) S.online = false;
    S.err = e instanceof TypeError ? 'Could not reach the server (weak signal, or the sign-in expired: tap the badge to sign in). Your changes are saved on this phone.' : e.message;
    S.failed = true;
  } finally { S.syncing = false; syncBadge(); }
}
function pickMeet(meets) {
  const t = todayIso();
  const live = meets.find((m) => m.start_date <= t && m.end_date >= t);
  const next = [...meets].filter((m) => m.end_date >= t).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  return (live || next || meets[0]).id;
}
function syncBadge() {
  const b = $('#sync');
  b.className = 'sync' + (!S.online || !S.authed ? ' off' : S.outbox ? ' wait' : '');
  if (S.failed && !S.syncing && S.online && S.authed) { b.className = 'sync wait'; b.textContent = S.outbox ? `${S.outbox} TO SEND · RETRY` : 'RETRY'; return; }
  b.textContent = !S.online ? `OFFLINE${S.outbox ? ' · ' + S.outbox + ' to send' : ''}` : !S.authed ? 'SIGN IN' : S.syncing ? 'SYNCING…' : S.outbox ? `${S.outbox} TO SEND` : S.lastSync ? `SYNCED ${S.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'SYNC';
}
$('#sync').onclick = () => { if (!S.authed || (S.failed && /sign-in/.test(S.err || '') && confirm('Sign in again? (Unsent changes stay on this phone.)'))) location.href = '/admin/'; else sync(); };
addEventListener('online', () => { S.online = true; sync(); });
addEventListener('offline', () => { S.online = false; syncBadge(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 25000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

// ---------- routing ----------
addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
function route() { const p = location.hash.replace(/^#\/?/, '').split('/'); return { v: p[0] || 'meet', a: p[1], b: p[2] }; }

function render() {
  syncBadge();
  const r = route();
  tabs(r);
  if (!S.pkg) return renderNoMeet();
  if (r.v === 'day') return renderDay(r.a, r.b);
  if (r.v === 'summary') return renderSummary(+r.a);
  if (r.v === 'swimmer') return renderSwimmer(+r.a);
  if (r.v === 'tools') return renderTools();
  return renderMeet();
}
function tabs(r) {
  const days = S.pkg ? [...new Set(S.pkg.sessions.filter((s) => s.nsea !== false).map((s) => s.day))] : [];
  const items = [['#/', 'Meet', S.pkg ? S.pkg.short || 'Summary' : '', r.v === 'meet'], ...days.map((d) => [`#/day/${d}`, dayShort(d), d === todayIso() ? 'today' : d.slice(5).replace('-', '/'), r.v === 'day' && r.a === d]), ['#/tools', 'Tools', 'upload · live', r.v === 'tools']];
  $('#tabs').innerHTML = items.map(([h, t, s, on]) => `<a href="${h}" ${on ? 'aria-current="page"' : ''}>${esc(t)}<small>${esc(s)}</small></a>`).join('');
}

function renderNoMeet() {
  app.innerHTML = `<div class="card"><h1>No meet loaded</h1>
    <p class="muted">${S.online ? (S.authed ? 'No meets have been loaded yet.' : 'Sign in through the admin console, then come back here.') : 'You are offline and this phone has no meet saved yet. Open Meet Day once on Wi-Fi before the meet.'}</p>
    <div class="btns">${S.authed ? '' : '<a class="btn solid" href="/admin/">Sign in</a>'}<a class="btn" href="#/tools">Load a meet file</a></div></div>`;
  if (route().v === 'tools') renderTools();
}

// ---------- meet summary ----------
function sessionsOf(day) { return S.pkg.sessions.filter((s) => s.day === day); }
function flagCounts(rows) {
  const c = { hit: 0, under: 0, 1: 0, 3: 0 };
  for (const r of rows) { const f = (r.result && r.result.time != null ? r.post : r.pre).filter((x) => !x.open && !x.improve)[0]; if (f) c[f.tier]++; }
  return c;
}
function pills(c) { return ['hit', 'under', '1', '3'].filter((k) => c[k]).map((k) => `<span class="pill t-${k}">${c[k]} ${TIER_TXT[k]}</span>`).join(''); }

function renderMeet() {
  const P = S.pkg, M = S.model;
  const days = [...new Set(P.sessions.map((s) => s.day))];
  const swimmers = [...M.swimmers.values()].map((s) => ({ s, n: M.rows.filter((r) => r.swimmerId === s.id && !r.scratched).length })).filter((x) => x.n).sort((a, b) => a.s.name.localeCompare(b.s.name));
  const girls = swimmers.filter((x) => x.s.sex === 'F').length;
  app.innerHTML = `
  ${S.meets.length > 1 ? `<div class="chips" style="margin-bottom:10px">${S.meets.map((m) => `<button class="chip" data-act="meet" data-id="${esc(m.id)}" aria-pressed="${m.id === S.meetId}">${esc(m.name)}</button>`).join('')}</div>` : ''}
  <div class="card">
    <p class="kicker">${esc(dayName(P.start))} – ${esc(dayName(P.end))}</p>
    <h1>${esc(P.name)}</h1>
    <p class="muted small" style="margin:0">${esc(P.venue)}<br>Host: ${esc(P.host)} · ${esc(P.course)}</p>
    <div class="grid2" style="margin-top:12px">
      <div class="stat"><b>${swimmers.length}</b><span>${esc(P.teamName)} swimmers (${girls} G · ${swimmers.length - girls} B)</span></div>
      <div class="stat"><b>${M.rows.filter((r) => !r.scratched).length}</b><span>swims entered</span></div>
      <div class="stat"><b>${M.rows.filter((r) => r.pre.some((f) => f.kind === 'record' && !f.open && f.tier)).length}</b><span>possible team records</span></div>
      <div class="stat"><b>${M.rows.filter((r) => r.pre.some((f) => f.kind === 'cut' && f.tier)).length}</b><span>swims near a new cut</span></div>
    </div>
    <div class="legend">${['hit', 'under', '1', '3'].map((k) => `<span class="pill t-${k}">${k === 'hit' ? 'Got it (unofficial)' : k === 'under' ? 'Seed already under' : k === '1' ? 'Within 1%' : 'Within 3%'}</span>`).join('')}</div>
  </div>

  <h2>Daily overview</h2>
  ${days.map((d) => {
    const ss = sessionsOf(d);
    return `<div class="card day"><p class="kicker">${esc(dayName(d))}${d === todayIso() ? ' · today' : ''}</p>
      ${ss.map((s) => {
        const rows = M.rows.filter((r) => r.session === s.n && !r.scratched);
        const sw = new Set(rows.map((r) => r.swimmerId)).size;
        return `<div class="sess"><div class="when">${esc(s.start)}</div><div class="what">
          <b>${esc(s.name)}</b><div class="small muted">${esc(s.label)}</div>
          ${s.nsea === false ? '' : `<div class="small">${s.warmup ? `Warm-up <b>${esc(s.warmup.time)}</b> · ${esc(s.warmup.pool)} ${esc(s.warmup.lanes)}` : ''}</div>
          <div class="small">${rows.length ? `${sw} swimmers · ${rows.length} swims` : esc(s.note || 'Entries come from the heat sheet.')} ${M.official.get(s.n)?.on ? '<span class="pill ok">official</span>' : ''}</div>
          <div>${pills(flagCounts(rows))}</div>
          <div class="btns" style="margin-top:6px"><a class="btn sm" href="#/day/${d}/${s.n}">Events</a>${rows.length ? `<a class="btn sm ghost" href="#/summary/${s.n}">Session summary</a>` : ''}</div>`}
        </div></div>`;
      }).join('')}</div>`;
  }).join('')}

  <h2>Meet info</h2>
  ${P.general.map((g, i) => `<details class="info" ${i < 2 ? 'open' : ''}><summary>${esc(g.title)}</summary><ul>${g.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}

  <h2>Swimmers</h2>
  <div class="card tight"><table class="t"><tbody>${swimmers.map(({ s, n }) => {
    const c = flagCounts(M.rows.filter((r) => r.swimmerId === s.id));
    return `<tr data-act="go" data-href="#/swimmer/${s.id}" style="cursor:pointer"><td><b>${esc(s.name)}</b> <span class="muted small">${s.age}</span><div>${pills(c)}</div></td><td class="num">${n} swims</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="small muted">Records and Top 10 from the live boards (${esc(P.refs.asOf?.records || '')}); cuts: ${esc(S.settings.cuts.join(', '))}. Package built ${esc(new Date(P.builtAt).toLocaleString())}.</p>`;
}

// ---------- day / session event flow ----------
function renderDay(day, sessN) {
  const ss = sessionsOf(day).filter((s) => s.nsea !== false);
  if (!ss.length) { app.innerHTML = '<p class="empty">No sessions for us that day.</p>'; return; }
  const s = ss.find((x) => String(x.n) === String(sessN)) || (day === todayIso() ? ss.find((x) => clockMin(x.finish) > nowMin()) : null) || ss[0];
  const M = S.model;
  let rows = M.rows.filter((r) => r.session === s.n);
  const nowEv = day === todayIso() ? nowEvent(rows, nowMin()) : null;
  const q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.swimmer.name.toLowerCase().includes(q));
  if (S.filter === 'flag') rows = rows.filter((r) => (r.result ? r.post : r.pre).some((f) => !f.improve && !f.open));
  if (S.filter === 'todo') rows = rows.filter((r) => !r.result && !r.scratched);
  if (S.filter === 'notes') rows = rows.filter((r) => r.notes.length);
  const off = M.official.get(s.n);
  const groups = [];
  for (const r of rows) { const k = `${r.event}|${r.round}`; let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, ev: r.ev, event: r.event, round: r.round, rows: [] }); g.rows.push(r); }
  const planned = s.events.filter((e) => !groups.some((g) => g.event === e.num && g.round === e.round));
  app.innerHTML = `
  ${ss.length > 1 ? `<div class="chips" style="margin-bottom:10px">${ss.map((x) => `<a class="chip" href="#/day/${day}/${x.n}" aria-pressed="${x.n === s.n}" style="text-decoration:none;color:inherit">${esc(x.name)}</a>`).join('')}</div>` : ''}
  <p class="kicker">${esc(dayName(day))} · Session ${s.n}</p>
  <h1>${esc(s.name)}</h1>
  ${s.warmup ? `<div class="warm"><p class="kicker">Our warm-up · ${esc(s.warmup.group)}</p><div class="big">${esc(s.warmup.time)}</div>
    <div><b>${esc(s.warmup.pool)}</b> · lanes ${esc(s.warmup.lanes)}</div><div class="small">${esc(s.warmup.sprints || '')}</div>
    <div class="small">Meet starts <b>${esc(s.start)}</b> · est. finish ${esc(s.finish || '')}</div></div>` : ''}
  ${s.note ? `<div class="banner warn">${esc(s.note)}</div>` : ''}
  <div class="banner ${off && off.on ? 'off' : 'unoff'}">${off && off.on ? `Official results loaded (${esc(off.by)}).` : 'Times and flags here are <b>unofficial</b> until the official results are loaded.'}</div>
  <div class="sticky noprint">
    <input type="search" id="q" placeholder="Find a swimmer" value="${esc(S.q)}" autocomplete="off">
    <div class="chips" style="margin-top:8px">
      ${[['all', 'All'], ['flag', 'Flagged'], ['todo', 'No result yet'], ['notes', 'Notes']].map(([k, t]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${t}</button>`).join('')}
      ${nowEv ? `<button class="chip" data-act="now" data-ev="${nowEv}">Now: #${nowEv}</button>` : ''}
      <a class="chip" href="#/summary/${s.n}" style="text-decoration:none;color:inherit">Session summary</a>
      <a class="chip" href="#/tools/${s.n}" style="text-decoration:none;color:inherit">Upload / live</a>
    </div>
  </div>
  ${groups.map((g) => eventBlock(g, nowEv)).join('') || '<p class="empty">No swims match.</p>'}
  ${planned.length && !q && S.filter === 'all' ? `<div class="card"><h3>Also in this session</h3><p class="small muted">No ${esc(S.pkg.teamName)} swims loaded for these yet${s.n && s.note ? ' (upload the heat sheet)' : ''}:</p><ul class="small">${planned.map((e) => `<li>#${e.num} ${esc(S.pkg.events[e.num]?.title || '')} · ${esc(e.round)} ${e.start ? '· ~' + esc(e.start) : ''}</li>`).join('')}</ul></div>` : ''}`;
  const qi = $('#q');
  qi.oninput = () => { S.q = qi.value; const pos = qi.selectionStart; renderDay(day, s.n); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
}
function eventBlock(g, nowEv) {
  const e = g.ev || {};
  const start = g.rows.map((r) => r.startMin).filter((x) => x != null).sort((a, b) => a - b)[0];
  const heats = e.heatCount ? `${e.heatCount} heats` : '';
  return `<section class="ev ${g.event === nowEv ? 'now' : ''}" id="ev-${g.event}-${esc(g.round)}">
    <header><span class="n">#${g.event}</span><span class="t">${esc(e.title || '')}${/Prelim/.test(g.round) ? ' · Prelims' : /2$/.test(g.round) ? ' · Night heat' : g.round === 'Finals' && e.heatCount == null ? '' : ''}</span>
    <span class="s">${start != null ? '~' + esc(g.rows.find((r) => r.startMin === start).start) : ''}${heats ? '<br>' + heats : ''}</span></header>
    ${g.rows.map(rowHtml).join('')}</section>`;
}
function rowHtml(r) {
  const res = r.result;
  const flags = (res && res.time != null ? r.post : r.pre);
  const top = flags.find((f) => !f.open && !f.improve) || flags[0];
  const tier = top ? top.tier : '';
  const chips = flags.slice(0, 4).map((f) => `<span class="pill t-${f.tier}" title="${esc(f.label + ' ' + (f.sub || ''))}">${KIND_TXT[f.kind]} ${esc(shortLabel(f))}</span>`).join('');
  const d = r.delta;
  return `<div class="row tier-${esc(tier)} ${r.scratched ? 'scr' : ''}" data-act="entry" data-id="${esc(r.id)}">
    <div class="hl ${r.heat ? '' : 'tbd'}">${r.heat ? `H${r.heat}<br>L${r.lane ?? '?'}` : 'TBD'}</div>
    <div class="who"><b>${esc(r.swimmer.name)}</b> <span class="muted small">${r.swimmer.age ?? ''}</span>${r.notes.length ? `<span class="note-dot">✎${r.notes.length}</span>` : ''}
      <div class="seed">seed ${fmt(r.seed)}${r.scratched ? ' · SCRATCHED' : ''}</div><div>${chips}</div></div>
    <div class="res">${res ? `<b>${res.time != null ? fmt(res.time) : esc(res.status)}</b>${d != null ? `<small class="${d < 0 ? 'drop' : 'add'}">${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}</small>` : ''}<br>${r.official ? '<span class="pill ok">official</span>' : '<span class="pill off">unofficial</span>'}` : '<span class="muted small">tap to add</span>'}</div>
  </div>`;
}
function shortLabel(f) {
  if (f.kind === 'record') return f.label.replace('Team record ', '');
  if (f.kind === 'top10') return f.label.replace('Top 10 ', '');
  return f.label.replace(' 18&U', '').replace(' (max)', '').replace('Winter Jrs', 'WJ').replace('Sectionals', 'Sect');
}

// ---------- entry sheet ----------
function openEntry(id) {
  const r = S.model.rows.find((x) => x.id === id);
  if (!r) return;
  const res = r.result;
  const flags = res && res.time != null ? r.post : r.pre;
  sheet(`
    <p class="kicker">#${r.event} ${esc(r.ev.title || '')} · ${esc(r.round)}</p>
    <h2 style="margin-bottom:2px">${esc(r.swimmer.name)} <span class="muted small">${r.swimmer.age ?? ''}</span></h2>
    <p class="small muted" style="margin-top:0">${r.heat ? `Heat ${r.heat}${r.heats ? ' of ' + r.heats : ''} · Lane ${r.lane}` : 'Heat/lane not set'}${r.start ? ' · ~' + esc(r.start) : ''} · Seed <b class="mono">${fmt(r.seed)}</b></p>
    <label class="f" for="t">Time ${res ? `<span class="muted">(now ${res.time != null ? fmt(res.time) : esc(res.status)}, ${esc(res.source || 'manual')}${r.official ? ', official' : ', unofficial'})</span>` : ''}</label>
    <div class="timein"><input id="t" inputmode="decimal" autocomplete="off" placeholder="e.g. 5912 or 2:15.33" value="${res && res.time != null ? fmt(res.time) : ''}"><button class="btn solid" data-act="save-time" data-id="${esc(id)}">Save</button></div>
    <div class="btns" style="margin-top:8px">${['DQ', 'NS'].map((s) => `<button class="btn sm ghost" data-act="status" data-s="${s}" data-id="${esc(id)}">${s}</button>`).join('')}
      ${res ? `<button class="btn sm ghost" data-act="clear-time" data-id="${esc(id)}">Clear time</button>` : ''}
      <button class="btn sm ghost" data-act="scratch" data-id="${esc(id)}">${r.scratched ? 'Un-scratch' : 'Scratch'}</button></div>
    <h3 style="margin-top:14px">Flags ${res && res.time != null ? (r.official ? '' : '<span class="pill off">unofficial</span>') : '<span class="muted small">(from seed)</span>'}</h3>
    ${flags.length ? `<ul class="flaglist">${flags.map((f) => `<li><span class="pill t-${f.tier}">${TIER_TXT[f.tier]}</span><span><b>${esc(f.label)}</b> <span class="muted">${esc(f.sub || '')}</span>${f.target != null && isFinite(f.target) ? ` · target <span class="mono">${fmt(f.target)}</span>${r.seed != null && !(res && res.time != null) ? ` · needs <span class="mono">${r.seed > f.target ? '−' + fmt(r.seed - f.target) : 'a PB'}</span>` : ''}${res && res.time != null ? ` · <span class="mono">${f.gap <= 0 ? 'by ' + fmt(-f.gap) : ''}</span>` : ''}` : ''}</span></li>`).join('')}</ul>` : '<p class="small muted">Nothing within 3% of a record, Top 10 or the cuts we flag.</p>'}
    <h3 style="margin-top:14px">Notes</h3>
    ${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${n.tags && n.tags.length ? `<b>${n.tags.map(esc).join(' · ')}</b> ` : ''}${esc(n.text)}<small>${esc(n.by)} · ${new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${n.op ? ` · <a href="#" data-act="undo" data-op="${esc(n.op)}">remove</a>` : ''}</small></li>`).join('')}</ul>` : ''}
    <div class="tags">${TAGS.map((t) => `<button class="chip" data-act="tag" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
    <textarea id="note" placeholder="Race feedback, things to talk about…"></textarea>
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="save-note" data-id="${esc(id)}">Add note</button><button class="btn ghost" data-act="close">Close</button></div>
    <p class="small muted" style="margin-top:10px"><a href="#/swimmer/${r.swimmerId}" data-act="close-go">All of ${esc(r.swimmer.first || r.swimmer.name)}'s swims →</a></p>`);
  setTimeout(() => { const t = $('#t'); if (t && !res) t.focus(); }, 60);
}
function sheet(html) { const s = $('#sheet'); s.innerHTML = '<div class="grab"></div>' + html; s.hidden = false; $('#sheet-bg').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').onclick = closeSheet;

// ---------- end of session summary ----------
function renderSummary(n) {
  const s = S.pkg.sessions.find((x) => x.n === n);
  if (!s) { app.innerHTML = '<p class="empty">Session not found.</p>'; return; }
  const X = sessionSummary(S.model, n);
  const tag = X.official ? '' : ' <span class="pill off">unofficial</span>';
  const li = (a) => a.map(({ r, f }) => `<li><b>${esc(r.swimmer.name)}</b> · #${r.event} ${esc(r.ev.title)} <span class="mono">${fmt(r.result.time)}</span> — ${esc(f.label)} ${f.sub ? `<span class="muted">(${esc(f.sub)})</span>` : ''}</li>`).join('');
  const finalsBack = /Prelim/.test(s.events.map((e) => e.round).join()) ? S.model.rows.filter((r) => r.session === n && /Prelim/.test(r.round) && r.result && r.result.place && r.result.place <= 40) : [];
  app.innerHTML = `
  <p class="kicker">${esc(dayName(s.day))} · Session ${s.n}</p>
  <h1>${esc(s.name)}: session summary</h1>
  <div class="banner ${X.official ? 'off' : 'unoff'}">${X.official ? 'Built from official results.' : `Unofficial: built from ${X.swum ? 'live / entered times' : 'no results yet'}. ${X.pending ? X.pending + ' swims still have no result.' : ''} Load official results to confirm.`}</div>
  <div class="grid2" style="margin-bottom:12px">
    <div class="stat"><b>${X.swum}/${X.entries}</b><span>swims with a result</span></div>
    <div class="stat"><b>${X.best}</b><span>best times (${X.pctBest}% of timed swims)</span></div>
    <div class="stat"><b>${fmt(X.drop)}</b><span>total time dropped vs seed</span></div>
    <div class="stat"><b>${X.records.length + X.top10.length + X.cuts.length}</b><span>records · Top 10 · new cuts</span></div>
  </div>
  ${X.records.length ? `<div class="card"><h3>Team records${tag}</h3><ul class="sumlist">${li(X.records)}</ul></div>` : ''}
  ${X.cuts.length ? `<div class="card"><h3>New championship cuts${tag}</h3><ul class="sumlist">${li(X.cuts)}</ul></div>` : ''}
  ${X.top10.length ? `<div class="card"><h3>Top 10 boards${tag}</h3><ul class="sumlist">${li(X.top10)}</ul></div>` : ''}
  ${finalsBack.length ? `<div class="card"><h3>Back for finals (top 40)${tag}</h3><ul class="sumlist">${finalsBack.map((r) => `<li><b>${esc(r.swimmer.name)}</b> · #${r.event} ${esc(r.ev.title)} · ${r.result.place}${ordinal(r.result.place)} <span class="mono">${fmt(r.result.time)}</span></li>`).join('')}</ul></div>` : ''}
  ${X.close.length ? `<div class="card"><h3>Just missed (within 1%)</h3><ul class="sumlist">${X.close.map(({ r, f, miss }) => `<li><b>${esc(r.swimmer.name)}</b> · #${r.event} ${esc(r.ev.title)} <span class="mono">${fmt(r.result.time)}</span> — ${esc(f.label)} by <span class="mono">${fmt(miss)}</span></li>`).join('')}</ul></div>` : ''}
  ${X.dq.length ? `<div class="card"><h3>DQ / NS</h3><ul class="sumlist">${X.dq.map((r) => `<li><b>${esc(r.swimmer.name)}</b> · #${r.event} ${esc(r.ev.title)} · ${esc(r.result.status)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><h3>By swimmer</h3><table class="t"><thead><tr><th>Swim</th><th style="text-align:right">Seed</th><th style="text-align:right">Time</th><th style="text-align:right">+/−</th></tr></thead><tbody>
  ${X.swimmers.map((w) => `<tr><td colspan="4" style="background:var(--panel)"><b>${esc(w.swimmer.name)}</b> <span class="muted small">${w.best}/${w.rows.length} best times</span></td></tr>${w.rows.map((r) => `<tr><td>#${r.event} ${esc(r.ev.title)}${r.notes.length ? `<div class="small" style="color:var(--violet)">${r.notes.map((n) => esc([...(n.tags || []), n.text].filter(Boolean).join(' · '))).join('<br>')}</div>` : ''}</td><td class="num">${fmt(r.seed)}</td><td class="num">${r.result ? (r.result.time != null ? fmt(r.result.time) : esc(r.result.status)) : '—'}</td><td class="num ${r.delta < 0 ? 'drop' : 'add'}">${r.delta != null ? (r.delta < 0 ? '−' : '+') + fmt(Math.abs(r.delta)) : ''}</td></tr>`).join('')}`).join('')}
  </tbody></table></div>
  <div class="btns noprint"><button class="btn solid" data-act="copy-summary" data-s="${n}">Copy as text</button><button class="btn" data-act="print">Print / PDF</button><a class="btn ghost" href="#/day/${s.day}/${s.n}">Back to events</a></div>`;
}
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function summaryText(n) {
  const s = S.pkg.sessions.find((x) => x.n === n), X = sessionSummary(S.model, n);
  const L = [`${S.pkg.short || S.pkg.name} · ${s.name}${X.official ? '' : ' (UNOFFICIAL)'}`, `${X.swum}/${X.entries} swims · ${X.best} best times (${X.pctBest}%) · ${fmt(X.drop)} dropped`];
  const sec = (t, a) => { if (a.length) { L.push('', t); a.forEach(({ r, f }) => L.push(`• ${r.swimmer.first || r.swimmer.name} ${r.swimmer.last || ''} – ${r.ev.title} ${fmt(r.result.time)} (${f.label})`)); } };
  sec('TEAM RECORDS', X.records); sec('NEW CUTS', X.cuts); sec('TOP 10', X.top10);
  return L.join('\n');
}

// ---------- swimmer ----------
function renderSwimmer(id) {
  const sw = S.model.swimmers.get(id);
  if (!sw) { app.innerHTML = '<p class="empty">Swimmer not found.</p>'; return; }
  const rows = S.model.rows.filter((r) => r.swimmerId === id);
  app.innerHTML = `<p class="kicker">${esc(S.pkg.short || S.pkg.name)}</p><h1>${esc(sw.name)} <span class="muted small">${sw.age ?? ''}</span></h1>
  ${S.pkg.sessions.filter((s) => rows.some((r) => r.session === s.n)).map((s) => `<h3>${esc(dayShort(s.day))} · ${esc(s.name)}</h3><div class="ev">${rows.filter((r) => r.session === s.n).map((r) => rowHtml(r).replace('<div class="who">', `<div class="who"><span class="small muted">#${r.event} ${esc(r.ev.title || '')}</span><br>`)).join('')}</div>`).join('')}
  ${rows.filter((r) => r.session == null).length ? `<h3>Not placed in a session</h3><div class="ev">${rows.filter((r) => r.session == null).map(rowHtml).join('')}</div>` : ''}`;
}

// ---------- tools: uploads, photos, live results, settings ----------
function renderTools() {
  const r = route();
  const sessN = +r.a || (S.pkg ? currentSession() : null);
  const ss = S.pkg ? S.pkg.sessions.filter((s) => s.nsea !== false) : [];
  const src = S.model ? S.model.sources.filter((x) => x.kind === 'live').slice(-1)[0] : null;
  const evs = S.pkg ? (S.pkg.sessions.find((s) => s.n === sessN)?.events || []) : [];
  app.innerHTML = `<h1>Uploads & live results</h1>
  ${S.pkg ? `
  <div class="card"><label class="f" for="sess">Session</label>
    <select id="sess">${ss.map((s) => `<option value="${s.n}" ${s.n === sessN ? 'selected' : ''}>${esc(dayShort(s.day))} · ${esc(s.name)}</option>`).join('')}</select></div>

  <div class="card"><h3>Heat sheet (PDF)</h3><p class="small muted">Finals sheets and updated programs. Our heats and lanes for that session are replaced with what's on the sheet.</p>
    <input type="file" id="f-heat" accept="application/pdf,.pdf"><div id="o-heat"></div></div>

  <div class="card"><h3>Photo of a heat sheet (re-seed)</h3><p class="small muted">Take a picture of the posted re-seed. Only our swimmers' lines are read; you check the result before it's applied.</p>
    <label class="f" for="ev-photo">Event (if the photo doesn't show the event title)</label>
    <select id="ev-photo"><option value="">— read it from the photo —</option>${evs.map((e) => `<option value="${e.num}">#${e.num} ${esc(S.pkg.events[e.num]?.title || '')} (${esc(e.round)})</option>`).join('')}</select>
    <input type="file" id="f-photo" accept="image/*" capture="environment" style="margin-top:8px"><div id="o-photo"></div></div>

  <div class="card"><h3>Live results web page</h3><p class="small muted">Paste the address the host pushes results to (Hy-Tek real-time results, a results page or PDF). Checked every minute while this screen is open; nothing counts as official until you mark it.</p>
    <input type="url" id="live-url" placeholder="https://…" value="${esc((src && src.url) || '')}">
    <div class="btns" style="margin-top:8px"><button class="btn solid" data-act="live-check">Check now</button><button class="btn" data-act="live-poll">${S.poll ? 'Stop auto-check' : 'Auto-check every minute'}</button></div><div id="o-live"></div></div>

  <div class="card"><h3>Meet Mobile screenshot</h3><p class="small muted">Meet Mobile has no public feed, so screenshot the event's results screen and add it here. Times are read for our swimmers in that event (unofficial).</p>
    <label class="f" for="ev-shot">Event</label>
    <select id="ev-shot"><option value="">— read it from the screenshot —</option>${evs.map((e) => `<option value="${e.num}">#${e.num} ${esc(S.pkg.events[e.num]?.title || '')} (${esc(e.round)})</option>`).join('')}</select>
    <input type="file" id="f-shot" accept="image/*" multiple style="margin-top:8px"><div id="o-shot"></div></div>

  <div class="card"><h3>Official results</h3><p class="small muted">When the host posts official results, load the results PDF (or the official results page above with “official” ticked). Then mark the session official.</p>
    <input type="file" id="f-official" accept="application/pdf,.pdf"><div id="o-official"></div>
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="official" data-s="${sessN}">${S.model.official.get(sessN)?.on ? 'Mark session unofficial' : 'Mark session official'}</button></div></div>` : ''}

  <div class="card"><h3>Offline</h3><p class="small muted">Downloads the PDF and photo readers to this phone so uploads and photos work with no signal. Do this on Wi-Fi before the meet.</p>
    <div class="btns"><button class="btn" data-act="offline-libs">Download readers for offline</button></div><div id="o-off"></div></div>

  ${S.pkg ? `<div class="card"><h3>Cuts to flag</h3><div class="tags">${(S.pkg.refs.cutNames || []).map((c) => `<button class="chip" data-act="cut" data-c="${esc(c)}" aria-pressed="${S.settings.cuts.includes(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}

  <div class="card"><h3>Meet file</h3><p class="small muted">Load a Meet Day package (.meetday.json) built from the meet folder. Coaches' phones pick it up on their next sync.</p>
    <input type="file" id="f-pkg" accept=".json,application/json"><div id="o-pkg"></div>
    ${S.pkg ? `<p class="small muted">Loaded: ${esc(S.pkg.name)} · built ${esc(new Date(S.pkg.builtAt).toLocaleString())} · ${S.ops.length} changes synced${S.outbox ? `, ${S.outbox} waiting to send` : ''}.</p>` : ''}
    ${S.err ? `<p class="small" style="color:var(--coral)">Last sync problem: ${esc(S.err)}</p>` : ''}</div>`;
  bindTools();
}
function currentSession() {
  const t = todayIso();
  const ss = S.pkg.sessions.filter((s) => s.nsea !== false);
  return (ss.find((s) => s.day === t && clockMin(s.finish) >= nowMin()) || ss.find((s) => s.day >= t) || ss[0]).n;
}
const selSession = () => +$('#sess').value;

function bindTools() {
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onchange = () => el.files.length && fn(el.files, $('#o-' + id.slice(2))).catch((e) => out($('#o-' + id.slice(2)), `<p class="small" style="color:var(--coral)">${esc(e.message)}</p>`)); };
  const sess = $('#sess'); if (sess) sess.onchange = () => { location.hash = '#/tools/' + sess.value; };
  on('f-heat', heatUpload);
  on('f-photo', photoUpload);
  on('f-shot', shotUpload);
  on('f-official', officialUpload);
  on('f-pkg', pkgUpload);
}
const out = (el, html) => { el.innerHTML = html; };
const busy = (el, t) => out(el, `<p class="small muted">${esc(t)}</p><div class="progress"><i id="pg"></i></div>`);

let pdfjsP;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = import(CDN.pdf).then((m) => { m.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; return m; });
  return pdfjsP;
}
let tessP;
async function ocr(file, el) {
  if (!tessP) tessP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = CDN.tess; s.onload = res; s.onerror = () => rej(new Error('Could not load the photo reader (download it for offline while on Wi-Fi).')); document.head.appendChild(s); })
    .then(() => window.Tesseract.createWorker('eng', 1, { workerPath: CDN.tessWorker, corePath: CDN.tessCore, langPath: CDN.tessLang, logger: (m) => { const p = $('#pg'); if (p && m.progress) p.style.width = Math.round(m.progress * 100) + '%'; } }));
  const w = await tessP;
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  const img = await shrink(file);
  const { data } = await w.recognize(img);
  return data.text;
}
// Big phone photos make OCR slow: scale to ~2000px wide, greyscale.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.25)'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

async function heatUpload(files, el) {
  busy(el, 'Reading the heat sheet…');
  const lib = await pdfjs();
  const pages = await readPdf(lib, new Uint8Array(await files[0].arrayBuffer()));
  const parsed = parseHeatSheet(pdfLines(pages));
  const sess = guessSession(S.pkg, parsed) || selSession();
  const data = heatSheetRows(S.pkg, S.model, parsed, sess);
  if (!data.rows.length) return out(el, `<p class="small">No ${esc(S.pkg.teamName)} swimmers found on “${esc(parsed.session || files[0].name)}”.</p>`);
  reviewEntries(el, data, `${parsed.session || files[0].name}: ${parsed.events.length} events, ${data.rows.length} ${S.pkg.teamName} swims → Session ${sess} (${esc(S.pkg.sessions.find((s) => s.n === sess)?.name)})`);
}
async function photoUpload(files, el) {
  busy(el, 'Reading the photo (this takes a few seconds)…');
  const text = await ocr(files[0], el);
  const ev = +$('#ev-photo').value || null;
  const data = photoHeatRows(S.pkg, S.model, text, selSession(), ev);
  if (!data.rows.length) return out(el, `<p class="small">Couldn't find our swimmers in that photo. Try a straighter, closer shot, or pick the event.</p><details><summary class="small">What was read</summary><pre class="small">${esc(text)}</pre></details>`);
  reviewEntries(el, data, `Found ${data.rows.length} of our swimmers. Check heats and lanes before applying.`, true);
}
function reviewEntries(el, data, head, editable) {
  out(el, `<p class="small"><b>${esc(head)}</b></p><table class="t review"><thead><tr><th>Swimmer</th><th>Ev</th><th>Heat</th><th>Lane</th><th style="text-align:right">Seed</th></tr></thead><tbody>
    ${data.rows.map((r, i) => `<tr><td>${esc(r.name)}${r.isNew ? ' <span class="pill t-3">new</span>' : ''}</td><td>#${r.event}</td>
      <td>${editable ? `<input data-i="${i}" data-k="heat" inputmode="numeric" value="${r.heat ?? ''}">` : r.heat ?? ''}</td>
      <td>${editable ? `<input data-i="${i}" data-k="lane" inputmode="numeric" value="${r.lane ?? ''}">` : r.lane ?? ''}</td><td class="num">${fmt(r.seed)}</td></tr>`).join('')}</tbody></table>
    <div class="btns" style="margin-top:8px"><button class="btn solid" id="apply">Apply</button><button class="btn ghost" id="cancel">Cancel</button></div>`);
  $('#cancel', el).onclick = () => out(el, '');
  $('#apply', el).onclick = async () => {
    el.querySelectorAll('input[data-i]').forEach((inp) => { const v = parseInt(inp.value, 10); data.rows[+inp.dataset.i][inp.dataset.k] = isNaN(v) ? null : v; });
    const { newEvents, events, ...op } = data;
    if (newEvents && newEvents.length) { for (const e of newEvents) S.pkg.events[e.num] = e; await store.putPkg(S.pkg); }
    await addOp('entries', { ...op, newEvents });
    out(el, `<p class="small" style="color:var(--teal-dark)">Applied ${data.rows.length} swims.</p>`);
  };
}

async function shotUpload(files, el) {
  const all = [];
  for (const [i, f] of [...files].entries()) {
    busy(el, `Reading screenshot ${i + 1} of ${files.length}…`);
    const text = await ocr(f, el);
    const ev = +$('#ev-shot').value || null;
    const r = screenshotResults(S.pkg, S.model, text, { event: ev, session: selSession() });
    if (!r.event) { out(el, '<p class="small">Pick the event, then add the screenshot again.</p>'); return; }
    all.push(...r.results.map((x) => ({ ...x, event: r.event })));
  }
  reviewResults(el, all, 'screenshot (OCR)');
}
function reviewResults(el, list, source, official) {
  if (!list.length) return out(el, `<p class="small">No new times for our swimmers.</p>`);
  out(el, `<table class="t review"><thead><tr><th>Swimmer</th><th>Ev</th><th>Time</th></tr></thead><tbody>
    ${list.map((r, i) => `<tr><td>${esc(r.swimmer)}</td><td>#${r.event}</td><td><input data-i="${i}" style="width:90px" value="${r.time != null ? fmt(r.time) : esc(r.status)}"></td></tr>`).join('')}</tbody></table>
    <div class="btns" style="margin-top:8px"><button class="btn solid" id="apply">Save ${list.length} time${list.length > 1 ? 's' : ''}${official ? ' (official)' : ''}</button><button class="btn ghost" id="cancel">Cancel</button></div>`);
  $('#cancel', el).onclick = () => out(el, '');
  $('#apply', el).onclick = async () => {
    el.querySelectorAll('input[data-i]').forEach((inp) => { const r = list[+inp.dataset.i]; const v = inp.value.trim().toUpperCase(); if (/^(DQ|NS|SCR|DFS|DNF)$/.test(v)) { r.time = null; r.status = v; } else { const t = parseTyped(v); if (t != null) { r.time = t; r.status = 'OK'; } } });
    for (const r of list) await addOp('result', { entry: r.entry, time: r.time, status: r.status, place: r.place ?? null, source, official: !!official });
    out(el, `<p class="small" style="color:var(--teal-dark)">Saved ${list.length} result${list.length > 1 ? 's' : ''}.</p>`);
  };
}

async function officialUpload(files, el) {
  busy(el, 'Reading the results…');
  const lib = await pdfjs();
  const pages = await readPdf(lib, new Uint8Array(await files[0].arrayBuffer()));
  const swims = parseResults(pdfLines(pages));
  const list = resultOps(S.pkg, S.model, swims, { source: 'official results PDF', official: true, session: selSession() });
  reviewResults(el, list, 'official results PDF', true);
}

async function liveCheck(quiet) {
  const el = $('#o-live'); const url = ($('#live-url') || {}).value || (await store.get('live:' + S.meetId));
  if (!url) return;
  await store.set('live:' + S.meetId, url);
  if (!navigator.onLine) { if (el) out(el, '<p class="small">Offline — will check when back online.</p>'); return; }
  if (el && !quiet) busy(el, 'Checking…');
  const session = selSessionSafe();
  const got = await api('POST', '/meetday/fetch', { url });
  let text = '';
  if (got.type === 'pdf') {
    const lib = await pdfjs();
    const pages = await readPdf(lib, Uint8Array.from(atob(got.base64), (c) => c.charCodeAt(0)));
    text = pdfLines(pages).map((l) => l.text).join('\n');
  } else {
    text = htmlToText(got.text);
    // An index page: follow links to the events in this session that we swim
    const want = new Set(S.model.rows.filter((r) => r.session === session).map((r) => r.event));
    const links = resultLinks(got.text, got.url).filter((l) => want.has(l.event)).slice(0, 30);
    for (const l of links) { try { const p = await api('POST', '/meetday/fetch', { url: l.href }); text += '\n' + (p.type === 'text' ? htmlToText(p.text) : ''); } catch { /* one page failing shouldn't stop the rest */ } }
  }
  const list = resultsFromText(S.pkg, S.model, text, { source: 'live results', official: false, session });
  for (const r of list) await addOp('result', { entry: r.entry, time: r.time, status: r.status, place: r.place ?? null, source: 'live results', official: false });
  if (!S.model.sources.some((x) => x.url === url)) await addOp('source', { kind: 'live', url });
  if (el) out(el, `<p class="small">${list.length ? `Added ${list.length} new time${list.length > 1 ? 's' : ''}` : 'No new times yet'} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (unofficial)</p>`);
  if (list.length && quiet) toast(`${list.length} new live result${list.length > 1 ? 's' : ''}`);
}
const selSessionSafe = () => ($('#sess') ? selSession() : currentSession());

async function pkgUpload(files, el) {
  const pkg = JSON.parse(await files[0].text());
  if (pkg.format !== 'nsea-meetday/1') throw new Error('That is not a Meet Day package.');
  await store.putPkg({ ...pkg, _updated: 'local' });
  try { await api('POST', '/meetday/meet', { pkg, replace: true }); out(el, '<p class="small" style="color:var(--teal-dark)">Loaded and shared with the other coaches.</p>'); }
  catch (e) { out(el, `<p class="small">Loaded on this phone only (${esc(e.message)}).</p>`); }
  await loadMeet(pkg.id); sync(pkg.id);
}

async function offlineLibs(el) {
  busy(el, 'Downloading…');
  const urls = [CDN.tess, CDN.tessWorker, `${CDN.tessCore}/tesseract-core-simd-lstm.wasm.js`, `${CDN.tessCore}/tesseract-core-lstm.wasm.js`, `${CDN.tessCore}/tesseract-core-simd.wasm.js`, `${CDN.tessCore}/tesseract-core.wasm.js`, `${CDN.tessLang}/eng.traineddata.gz`];
  const c = await caches.open('meetday-libs-v1');
  let n = 0;
  for (const u of urls) { await c.add(new Request(u, { mode: 'cors' })); n++; const p = $('#pg'); if (p) p.style.width = Math.round((n / urls.length) * 100) + '%'; }
  await store.set('libs', new Date().toISOString());
  out(el, '<p class="small" style="color:var(--teal-dark)">Ready: PDF and photo reading work offline on this phone.</p>');
}

// ---------- clicks ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  try {
    if (a === 'entry') return openEntry(t.dataset.id);
    if (a === 'go') { location.hash = t.dataset.href; return; }
    if (a === 'close') return closeSheet();
    if (a === 'close-go') { closeSheet(); return; }
    if (a === 'meet') { await loadMeet(t.dataset.id); render(); return; }
    if (a === 'filter') { S.filter = t.dataset.f; render(); return; }
    if (a === 'now') { const el = document.querySelector(`[id^="ev-${t.dataset.ev}-"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'tag') { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); return; }
    if (a === 'save-time') {
      const v = $('#t').value; const cs = parseTyped(v);
      if (cs == null) { toast('Type a time like 5912 or 1:02.45'); return; }
      await addOp('result', { entry: t.dataset.id, time: cs, status: 'OK', source: 'manual', official: false });
      closeSheet(); toast('Saved'); return;
    }
    if (a === 'status') { await addOp('result', { entry: t.dataset.id, time: null, status: t.dataset.s, source: 'manual', official: false }); closeSheet(); return; }
    if (a === 'clear-time') { const r = S.model.rows.find((x) => x.id === t.dataset.id); if (r && r.result) await addOp('undo', { op: r.result.op }); closeSheet(); return; }
    if (a === 'scratch') { const r = S.model.rows.find((x) => x.id === t.dataset.id); await addOp('scratch', { entry: t.dataset.id, on: !r.scratched }); closeSheet(); return; }
    if (a === 'save-note') {
      const text = $('#note').value.trim(); const tags = [...document.querySelectorAll('#sheet [data-act=tag][aria-pressed=true]')].map((x) => x.textContent);
      if (!text && !tags.length) { toast('Write a note or pick a tag'); return; }
      await addOp('note', { entry: t.dataset.id, text, tags }); openEntry(t.dataset.id); toast('Note added'); return;
    }
    if (a === 'undo') { ev.preventDefault(); await addOp('undo', { op: t.dataset.op }); const id = $('#sheet [data-act=save-note]')?.dataset.id; if (id) openEntry(id); return; }
    if (a === 'official') { const on = !S.model.official.get(+t.dataset.s)?.on; if (on && !confirm('Mark this session official? Do this once the official results have been loaded.')) return; await addOp('official', { session: +t.dataset.s, on }); render(); return; }
    if (a === 'copy-summary') { await navigator.clipboard.writeText(summaryText(+t.dataset.s)); toast('Copied'); return; }
    if (a === 'print') { window.print(); return; }
    if (a === 'live-check') { await liveCheck(false); return; }
    if (a === 'live-poll') {
      if (S.poll) { clearInterval(S.poll); S.poll = null; } else { await liveCheck(false); S.poll = setInterval(() => liveCheck(true).catch(() => {}), 60000); }
      renderTools(); return;
    }
    if (a === 'offline-libs') { await offlineLibs($('#o-off')); return; }
    if (a === 'cut') { const c = t.dataset.c; S.settings.cuts = S.settings.cuts.includes(c) ? S.settings.cuts.filter((x) => x !== c) : [...S.settings.cuts, c]; await store.set('settings', S.settings); recompute(); renderTools(); return; }
  } catch (e) { toast(e.message, 4000); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 't') $('[data-act=save-time]').click(); if (e.key === 'Escape') closeSheet(); });

// ---------- boot ----------
(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  S.settings = { cuts: DEFAULT_CUTS, ...((await store.get('settings')) || {}) };
  S.meets = (await store.get('meets')) || [];
  S.me = await store.get('me');
  const ls = await store.get('lastSync'); if (ls) S.lastSync = new Date(ls);
  S.outbox = (await store.outbox()).length;
  const cur = await store.get('current');
  const ids = await store.listPkgIds();
  if (cur && ids.includes(cur)) await loadMeet(cur); else if (ids.length) await loadMeet(ids[0]);
  if (!location.hash && S.pkg) { const t = todayIso(); if (S.pkg.sessions.some((s) => s.day === t && s.nsea !== false)) location.hash = `#/day/${t}`; }
  render();
  sync();
})();
