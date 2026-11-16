// NSEA Meet Day: coaches' meet app. Offline-first: everything renders from IndexedDB; the server is only
// for syncing between coaches and for fetching live results pages.
import { fmt, readPdf, pdfLines, parseHeatSheet, parseSessionReport, parseResults, clockMin, minClock, ocrColumns } from './lib/parse.mjs';
import { DEFAULT_CUTS } from './lib/flags.mjs';
import { derive, sessionSummary, parseTyped, notesFor, blocksOf, blockOf, blockFlow, nowInPools, poolName, ttEvent } from './lib/model.mjs';
import { guessSession, heatSheetRows, photoHeatRows, ttPhotoRows, resultOps, resultsFromText, screenshotResults, htmlToText, resultLinks } from './lib/ingest.mjs';
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
const tagList = () => (S.model && S.model.tags) || S.settings.tags || TAGS;
const TIER_TXT = { hit: 'Got it', under: 'Seed under', 1: '≤1%', 3: '≤3%' };
const KIND_TXT = { record: 'REC', top10: 'T10', cut: 'CUT' };

const S = { pool: '', meets: [], meetId: null, pkg: null, ops: [], model: null, settings: { cuts: DEFAULT_CUTS }, me: null, online: navigator.onLine, syncing: false, lastSync: null, outbox: 0, authed: true, filter: 'all', q: '', poll: null };
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
const SS = () => (S.model && S.model.sessions) || (S.pkg ? S.pkg.sessions : []);
// The package as the ingest helpers should see it: with sessions as changed by ops (times, timeline).
const PK = () => ({ ...S.pkg, sessions: SS(), events: (S.model && S.model.events) || S.pkg.events });
const BB = () => blocksOf(SS());
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
    if ((changed && !hadPkg) || (changed && route().v !== 'tools' && $('#sheet').hidden && !['q', 'gnote', 'tag-new'].includes(document.activeElement?.id) && !document.querySelector('#o-ttphoto table'))) render();
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
  const days = S.pkg ? [...new Set(SS().filter((s) => s.nsea !== false).map((s) => s.day))] : [];
  const items = [['#/', 'Meet', S.pkg ? S.pkg.short || 'Summary' : '', r.v === 'meet'], ...days.map((d) => [`#/day/${d}`, dayShort(d), d === todayIso() ? 'today' : d.slice(5).replace('-', '/'), r.v === 'day' && r.a === d]), ['#/tools', 'Tools', 'upload · live', r.v === 'tools']];
  $('#tabs').innerHTML = items.map(([h, t, s, on]) => `<a href="${h}" ${on ? 'aria-current="page"' : ''}>${esc(t)}<small>${esc(s)}</small></a>`).join('');
}

function renderNoMeet() {
  app.innerHTML = `<div class="card"><h1>No meet loaded</h1>
    <p class="muted">${S.online ? (S.authed ? 'No meets have been loaded yet.' : 'Sign in through the admin console, then come back here.') : 'You are offline and this phone has no meet saved yet. Open Meet Day once on Wi-Fi before the meet.'}</p>
    <div class="btns">${S.authed ? '' : '<a class="btn solid" href="/admin/">Sign in</a>'}<a class="btn" href="#/tools">Load a meet file</a></div></div>`;
  if (route().v === 'tools') renderTools();
}

// ---------- general coach notes (meet / day / session) ----------
const SCOPE_TXT = { meet: 'Whole meet', day: 'This day', session: 'This session' };
const tm = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function gnoteList(list, label) {
  if (!list.length) return '';
  return `<p class="kicker" style="margin:8px 0 2px">${esc(label)}</p><ul class="notes">${list.map((n) => `<li>${n.tags.length ? `<b>${n.tags.map(esc).join(' · ')}</b> ` : ''}${esc(n.text)}<small>${esc(n.by)} · ${esc(tm(n.at))} · <a href="#" data-act="undo" data-op="${esc(n.op)}">remove</a></small></li>`).join('')}</ul>`;
}
// session: a session object or null (meet page). Notes are added for the chosen scope.
function notesCard(session) {
  const N = notesFor(S.model, session);
  const scopes = session ? ['session', 'day', 'meet'] : ['meet'];
  const count = N.meet.length + N.day.length + N.session.length;
  return `<details class="card gnotes" ${count ? 'open' : ''}><summary><b>Coach notes</b> <span class="muted small">${count ? count + ' note' + (count === 1 ? '' : 's') : 'none yet'}</span></summary>
    ${session ? gnoteList(N.session, 'This session') + gnoteList(N.day, dayName(session.day)) : ''}${gnoteList(N.meet, 'Whole meet')}
    <div class="tags" style="margin-top:8px">${tagList().map((t) => `<button class="chip" data-act="tag" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
    <textarea id="gnote" placeholder="Pool notes, reminders, who's on which events, things to tell the team…"></textarea>
    <div class="btns" style="margin-top:8px">${scopes.length > 1 ? `<select id="gscope" style="width:auto">${scopes.map((k) => `<option value="${k}">${SCOPE_TXT[k]}</option>`).join('')}</select>` : ''}
      <button class="btn" data-act="save-gnote" ${session ? `data-s="${session.n}"` : ''}>Add note</button></div></details>`;
}

// ---------- meet summary ----------
function sessionsOf(day) { return SS().filter((s) => s.day === day); }
function flagCounts(rows) {
  const c = { hit: 0, under: 0, 1: 0, 3: 0 };
  for (const r of rows) { const f = (r.result && r.result.time != null ? r.post : r.pre).filter((x) => !x.open && !x.improve)[0]; if (f) c[f.tier]++; }
  return c;
}
function pills(c) { return ['hit', 'under', '1', '3'].filter((k) => c[k]).map((k) => `<span class="pill t-${k}">${c[k]} ${TIER_TXT[k]}</span>`).join(''); }

function renderMeet() {
  const P = S.pkg, M = S.model;
  const days = [...new Set(SS().map((s) => s.day))];
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
      <div class="stat"><b>${M.rows.filter((r) => !r.scratched && r.pre.some((f) => f.kind === 'record' && !f.open && f.tier)).length}</b><span>possible team records</span></div>
      <div class="stat"><b>${M.rows.filter((r) => !r.scratched && r.pre.some((f) => f.kind === 'cut' && f.tier)).length}</b><span>swims near a new cut</span></div>
    </div>
    <div class="legend">${['hit', 'under', '1', '3'].map((k) => `<span class="pill t-${k}">${k === 'hit' ? 'Got it (unofficial)' : k === 'under' ? 'Seed already under' : k === '1' ? 'Within 1%' : 'Within 3%'}</span>`).join('')}</div>
  </div>

  ${notesCard(null)}

  <h2>Daily overview</h2>
  ${days.map((d) => {
    const bs = BB().filter((b) => b.day === d);
    return `<div class="card day"><p class="kicker">${esc(dayName(d))}${d === todayIso() ? ' · today' : ''}</p>
      ${bs.map((B) => {
        const ns = new Set(B.sessions.map((x) => x.n));
        const rows = M.rows.filter((r) => ns.has(r.session) && !r.scratched);
        const sw = new Set(rows.map((r) => r.swimmerId)).size;
        const off = B.sessions.every((x) => M.official.get(x.n)?.on);
        return `<div class="sess"><div class="when">${esc(B.start)}</div><div class="what">
          <b>${esc(B.name)}</b><div class="small muted">${esc(B.label)}</div>
          ${!B.nsea ? '' : `<div class="small">${B.warmup ? `Warm-up <b>${esc(B.warmup.time)}</b> · ${esc(B.warmup.pool)} ${esc(B.warmup.lanes)}` : ''}</div>
          ${B.multi ? `<div class="small">${B.sessions.map((x) => `${esc(poolName(x))} ${esc(hm(x.start))}–${esc(hm(x.finish || ''))} (${rows.filter((r) => r.session === x.n).length})`).join(' · ')}</div>` : ''}
          <div class="small">${rows.length ? `${sw} swimmers · ${rows.length} swims` : esc(B.note || 'Entries come from the heat sheet.')} ${off ? '<span class="pill ok">official</span>' : ''}</div>
          <div>${pills(flagCounts(rows))}</div>
          <div class="btns" style="margin-top:6px"><a class="btn sm" href="#/day/${d}/${B.n}">Events</a>${rows.length ? `<a class="btn sm ghost" href="#/summary/${B.n}">Session summary</a>` : ''}</div>`}
        </div></div>`;
      }).join('')}</div>`;
  }).join('')}

  <h2>Meet info</h2>
  ${P.general.map((g, i) => `<details class="info" ${i < 2 ? 'open' : ''}><summary>${esc(g.title)}</summary><ul>${g.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}

  <h2>Swimmers</h2>
  ${M.meetOut.size ? `<div class="banner warn">Not attending (scratched from the meet): ${[...M.meetOut.keys()].map((id) => M.swimmers.get(id)).filter(Boolean).map((w) => `<a href="#/swimmer/${w.id}">${esc(w.name)}</a>`).join(', ')}</div>` : ''}
  <div class="card tight"><table class="t"><tbody>${swimmers.map(({ s, n }) => {
    const c = flagCounts(M.rows.filter((r) => r.swimmerId === s.id));
    return `<tr data-act="go" data-href="#/swimmer/${s.id}" style="cursor:pointer"><td><b>${esc(s.name)}</b> <span class="muted small">${s.age}</span><div>${pills(c)}</div></td><td class="num">${n} swims</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="small muted">Records and Top 10 from the live boards (${esc(P.refs.asOf?.records || '')}); cuts: ${esc(S.settings.cuts.join(', '))}. Package built ${esc(new Date(P.builtAt).toLocaleString())}.</p>`;
}

// ---------- day / session event flow ----------
function renderDay(day, sessN) {
  const bs = BB().filter((b) => b.day === day && b.nsea);
  if (!bs.length) { app.innerHTML = '<p class="empty">No sessions for us that day.</p>'; return; }
  const B = bs.find((x) => x.sessions.some((y) => String(y.n) === String(sessN))) || (day === todayIso() ? bs.find((x) => clockMin(x.finish) > nowMin()) : null) || bs[0];
  const M = S.model, ns = new Set(B.sessions.map((x) => x.n));
  if (S.pool && !B.sessions.some((x) => poolName(x) === S.pool)) S.pool = '';
  let rows = M.rows.filter((r) => ns.has(r.session) && !r.meetOut);
  const q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.swimmer.name.toLowerCase().includes(q));
  if (S.filter === 'flag') rows = rows.filter((r) => (r.result ? r.post : r.pre).some((f) => !f.improve && !f.open));
  if (S.filter === 'todo') rows = rows.filter((r) => !r.result && !r.scratched);
  if (S.filter === 'notes') rows = rows.filter((r) => r.notes.length);
  const allOff = B.sessions.every((x) => M.official.get(x.n)?.on), someOff = B.sessions.filter((x) => M.official.get(x.n)?.on);
  const narrowed = !!q || S.filter !== 'all';
  const all = blockFlow(PK(), B, rows);
  const now = day === todayIso() ? nowInPools(all, nowMin()) : [];
  const nowSet = new Set(now.map((x) => `${x.item.num}-${x.item.round}`));
  const flow = all.filter((it) => (it.rows.length || !narrowed) && (!S.pool || it.pool === S.pool));
  const w = B.warmup;
  app.innerHTML = `
  ${bs.length > 1 ? `<div class="chips" style="margin-bottom:10px">${bs.map((x) => `<a class="chip" href="#/day/${day}/${x.n}" aria-pressed="${x.key === B.key}">${esc(x.name)}</a>`).join('')}</div>` : ''}
  <p class="kicker">${esc(dayName(day))} · ${B.lead.tt ? 'Time trials (added in the app)' : `Session ${esc(B.multi ? B.lead.block : (B.lead.code || B.n))}`}${B.multi ? ` · ${B.sessions.length} pools` : ''}</p>
  <h1>${esc(B.name)}</h1>
  ${w ? `<div class="warm"><p class="kicker">Our warm-up · ${esc(w.group)}</p><div class="big">${esc(w.time)}</div>
    <div><b>${esc(w.pool)}</b> · lanes ${esc(w.lanes)}</div><div class="small">${esc(w.sprints || '')}</div>
    ${B.multi ? B.sessions.map((x) => `<div class="small"><b>${esc(poolName(x))}</b>: starts ${esc(hm(x.start))} · est. finish ${esc(hm(x.finish || ''))}</div>`).join('')
      : `<div class="small">Meet starts <b>${esc(B.start)}</b> · est. finish ${esc(B.finish || '')}</div>`}</div>`
    : B.multi ? `<div class="card tight">${B.sessions.map((x) => `<div class="small"><b>${esc(poolName(x))}</b>: starts ${esc(hm(x.start))} · est. finish ${esc(hm(x.finish || ''))}</div>`).join('')}</div>` : ''}
  ${B.note ? `<div class="banner warn">${esc(B.note)}</div>` : ''}
  ${B.lead.tt ? `<div class="card ttcard"><h3>Time trials</h3><p class="small muted">Add our swims as they're posted. Officials' handwritten changes (combined heats, moved lanes, merged events) can't be read from a photo, so check every row before applying.</p>
    <div class="btns"><button class="btn solid" data-act="tt-add" data-s="${B.n}">Add swims</button><label class="btn">Photo of the sheet<input type="file" id="f-ttphoto" accept="image/*" capture="environment" hidden></label></div><div id="o-ttphoto"></div></div>` : ''}
  ${notesCard(B.lead)}
  <div class="banner ${allOff ? 'off' : 'unoff'}">${allOff ? 'Official results loaded.' : someOff.length ? `Official for ${someOff.map((x) => esc(poolName(x))).join(', ')} only; the rest is <b>unofficial</b>.` : 'Times and flags here are <b>unofficial</b> until the official results are loaded.'}</div>
    ${now.length ? `<div class="nowbar">${now.map((x) => { const it = x.item, h = x.live && it.heats && it.minutes > 0 ? Math.min(it.heats, Math.floor(((nowMin() - it.startMin) * it.heats) / it.minutes) + 1) : null;
      return `<button data-act="now" data-ev="${it.num}-${esc(it.round)}"><b>${x.live ? 'Now' : 'Next'}</b>${x.pool ? ` · ${esc(x.pool)}` : ''}<span>#${it.num} ${esc((it.ev.title || '').replace(/^(Girls|Boys|Mixed) /, '').replace(/^13 & Over /, ''))}</span><small>${h ? `about heat ${h} of ${it.heats}` : x.live ? '' : `starts ~${esc(hm(it.start))}`}</small></button>`; }).join('')}</div>` : ''}
  <div class="sticky noprint">
    <input type="search" id="q" placeholder="Find a swimmer" value="${esc(S.q)}" autocomplete="off">
    ${B.multi ? `<div class="chips pools" style="margin-top:8px">${[['', 'Both pools'], ...B.sessions.map((x) => [poolName(x), poolName(x)])].map(([k, t]) => `<button class="chip" data-act="pool" data-p="${esc(k)}" aria-pressed="${S.pool === k}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="chips" style="margin-top:8px">
      ${[['all', 'All'], ['flag', 'Flagged'], ['todo', 'No result yet'], ['notes', 'Notes']].map(([k, t]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${t}</button>`).join('')}
      <a class="chip" href="#/summary/${B.n}" style="text-decoration:none;color:inherit">Session summary</a>
      <a class="chip" href="#/tools/${B.n}" style="text-decoration:none;color:inherit">Upload / live</a>
    </div>
  </div>
  ${flow.map((it) => eventBlock(it, nowSet)).join('') || '<p class="empty">No swims match.</p>'}`;
  const tf = $('#f-ttphoto');
  if (tf) tf.onchange = async () => { const o = $('#o-ttphoto'); if (!tf.files.length) return; const f = tf.files[0]; tf.value = '';
    busy(o, 'Reading the photo (this takes a few seconds)…');
    try { const text = await ocr(f, o, { columns: true }); const rows = ttPhotoRows(S.model, text); ttReview(o, B.n, rows.length ? rows : [{}], rows.length ? `Found ${rows.length} of our swimmers. Fix events, heats and lanes to match the officials' changes, add anyone missed, then apply.` : "Couldn't find our swimmers in the photo. Add them by hand below.", text); }
    catch (e) { out(o, `<p class="small" style="color:var(--coral)">${esc(e.message)}</p>`); } };
  const qi = $('#q');
  qi.oninput = () => { S.q = qi.value; const pos = qi.selectionStart; renderDay(day, B.n); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
}
// Event number as the coach sees it: time-trial events show the sheet's number (or "TT").
function evNo(num) { const e = PK().events[num] || {}; return e.tt ? (e.shown ? `TT #${e.shown}` : 'TT') : `#${num}`; }
const hm = (t) => String(t || '').replace(/^0/, '');
function eventBlock(it, nowSet) {
  const isNow = nowSet && nowSet.has(`${it.num}-${it.round}`);
  const pool = it.pool ? `<span class="pooltag">${esc(it.pool)}</span>` : '';
  const e = it.ev || {};
  const round = /Prelim/.test(it.round) ? ' · Prelims' : /2$/.test(it.round) ? ' · Night heat' : '';
  const heats = it.heats ? `${it.heats} heat${it.heats === 1 ? '' : 's'}` : '';
  const same = it.end && it.start.slice(-2) === it.end.slice(-2);
  const when = it.start ? (it.end && it.minutes > 0 ? `~${esc(hm(same ? it.start.slice(0, -3) : it.start))}–${esc(hm(it.end))}` : `~${esc(hm(it.start))}`) : '';
  const head = `<header><span class="n">${evNo(it.num)}</span><span class="t">${pool}${esc(e.title || '')}${round}</span>
    <span class="s">${when}${heats ? (when ? '<br>' : '') + heats : ''}</span></header>`;
  if (!it.rows.length) {
    return `<section class="ev none ${isNow ? 'now' : ''}" id="ev-${it.num}-${esc(it.round)}">${head}
      <div class="none-line">No ${esc(S.pkg.teamName)} swimmers${it.minutes > 0 ? ` · about ${it.minutes} min` : ''}${!heats ? ' · heats TBD' : ''}</div></section>`;
  }
  return `<section class="ev ${isNow ? 'now' : ''}" id="ev-${it.num}-${esc(it.round)}">${head}
    ${it.heatGroups.map((h) => `<div class="heat"><span>${h.heat ? `Heat ${h.heat}${h.of ? ` of ${h.of}` : ''}` : 'Heat TBD'}</span>${h.start ? `<span class="hs">~${esc(hm(h.start))}</span>` : ''}</div>
      ${h.rows.map((r) => rowHtml(r, false)).join('')}`).join('')}</section>`;
}
function rowHtml(r, showHeat = true) {
  const res = r.result;
  const flags = (res && res.time != null ? r.post : r.pre);
  const top = flags.find((f) => !f.open && !f.improve) || flags[0];
  const tier = top ? top.tier : '';
  const chips = flags.slice(0, 4).map((f) => `<span class="pill t-${f.tier}" title="${esc(f.label + ' ' + (f.sub || ''))}">${KIND_TXT[f.kind]} ${esc(shortLabel(f))}</span>`).join('');
  const d = r.delta;
  return `<div class="row tier-${esc(tier)} ${r.scratched ? 'scr' : ''}" data-act="entry" data-id="${esc(r.id)}">
    ${showHeat ? `<div class="hl ${r.heat ? '' : 'tbd'}">${r.heat ? `H${r.heat}<br>L${r.lane ?? '?'}` : 'TBD'}</div>`
      : `<div class="hl lane ${r.lane ? '' : 'tbd'}"><small>Lane</small>${r.lane ?? '?'}</div>`}
    <div class="who"><b>${esc(r.swimmer.name)}</b> <span class="muted small">${r.swimmer.age ?? ''}</span>${r.notes.length ? `<span class="note-dot">✎${r.notes.length}</span>` : ''}
      ${r.relay ? legsLine(r) : ''}
      <div class="seed">seed ${fmt(r.seed)}${r.scratched ? ' · SCRATCHED' : ''}</div><div>${chips}</div></div>
    <div class="res">${res ? `<b>${res.time != null ? fmt(res.time) : esc(res.status)}</b>${d != null ? `<small class="${d < 0 ? 'drop' : 'add'}">${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}</small>` : ''}<br>${r.official ? '<span class="pill ok">official</span>' : '<span class="pill off">unofficial</span>'}` : '<span class="muted small">tap to add</span>'}</div>
  </div>`;
}
const shortName = (w) => (w ? (w.unknown ? w.name : `${w.first || w.name.split(',')[1]?.trim() || ''} ${(w.last || w.name.split(',')[0] || '').charAt(0)}`.trim()) : '');
function legsLine(r) {
  const any = r.legSw.some(Boolean);
  return `<div class="legs">${any ? r.legSw.map((w, i) => `<span>${i + 1} ${w ? esc(shortName(w)) : '<i>?</i>'}</span>`).join('') : '<span class="muted">legs not set · tap to add</span>'}</div>
    ${r.legOut.length ? `<div class="small" style="color:var(--coral)">⚠ ${r.legOut.map(esc).join(', ')} scratched from the meet</div>` : ''}`;
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
    <p class="kicker">${evNo(r.event)} ${esc(r.ev.title || '')} · ${esc(r.round)}</p>
    <h2 style="margin-bottom:2px">${esc(r.swimmer.name)} <span class="muted small">${r.swimmer.age ?? ''}</span></h2>
    <p class="small muted" style="margin-top:0">${r.heat ? `Heat ${r.heat}${r.heats ? ' of ' + r.heats : ''} · Lane ${r.lane}` : 'Heat/lane not set'}${r.start ? ' · ~' + esc(r.start) : ''} · Seed <b class="mono">${fmt(r.seed)}</b></p>
    <label class="f" for="t">Time ${res ? `<span class="muted">(now ${res.time != null ? fmt(res.time) : esc(res.status)}, ${esc(res.source || 'manual')}${r.official ? ', official' : ', unofficial'})</span>` : ''}</label>
    <div class="timein"><input id="t" inputmode="decimal" autocomplete="off" placeholder="e.g. 5912 or 2:15.33" value="${res && res.time != null ? fmt(res.time) : ''}"><button class="btn solid" data-act="save-time" data-id="${esc(id)}">Save</button></div>
    <div class="btns" style="margin-top:8px">${['DQ', 'NS'].map((s) => `<button class="btn sm ghost" data-act="status" data-s="${s}" data-id="${esc(id)}">${s}</button>`).join('')}
      ${res ? `<button class="btn sm ghost" data-act="clear-time" data-id="${esc(id)}">Clear time</button>` : ''}
      ${r.meetOut ? '' : `<button class="btn sm ghost" data-act="scratch" data-id="${esc(id)}">${r.scratched ? 'Un-scratch' : 'Scratch'}</button>`}</div>
    ${r.meetOut ? `<p class="small" style="color:var(--coral)">Scratched from the whole meet. <a href="#/swimmer/${r.swimmerId}" data-act="close-go">Change on ${esc(r.swimmer.first || 'their')} page</a></p>` : ''}
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer;color:var(--teal-dark)">Change heat / lane${r.heat ? '' : ' (not set yet)'}</summary>
      <div class="timein" style="margin-top:8px"><input id="hh" inputmode="numeric" placeholder="Heat" value="${r.heat ?? ''}" style="font-size:18px"><input id="ll" inputmode="numeric" placeholder="Lane" value="${r.lane ?? ''}" style="font-size:18px"><button class="btn" data-act="save-hl" data-id="${esc(id)}">Save</button></div></details>
    ${r.relay ? legsEditor(r) : ''}
    ${r.relay ? '' : `<h3 style="margin-top:14px">Flags ${res && res.time != null ? (r.official ? '' : '<span class="pill off">unofficial</span>') : '<span class="muted small">(from seed)</span>'}</h3>
    ${flags.length ? `<ul class="flaglist">${flags.map((f) => `<li><span class="pill t-${f.tier}">${TIER_TXT[f.tier]}</span><span><b>${esc(f.label)}</b> <span class="muted">${esc(f.sub || '')}</span>${f.target != null && isFinite(f.target) ? ` · target <span class="mono">${fmt(f.target)}</span>${r.seed != null && !(res && res.time != null) ? ` · needs <span class="mono">${r.seed > f.target ? '−' + fmt(r.seed - f.target) : 'a PB'}</span>` : ''}${res && res.time != null ? ` · <span class="mono">${f.gap <= 0 ? 'by ' + fmt(-f.gap) : ''}</span>` : ''}` : ''}</span></li>`).join('')}</ul>` : '<p class="small muted">Nothing within 3% of a record, Top 10 or the cuts we flag.</p>'}`}
    <h3 style="margin-top:14px">Notes</h3>
    ${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${n.tags && n.tags.length ? `<b>${n.tags.map(esc).join(' · ')}</b> ` : ''}${esc(n.text)}<small>${esc(n.by)} · ${new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${n.op ? ` · <a href="#" data-act="undo" data-op="${esc(n.op)}">remove</a>` : ''}</small></li>`).join('')}</ul>` : ''}
    <div class="tags">${tagList().map((t) => `<button class="chip" data-act="tag" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
    <textarea id="note" placeholder="Race feedback, things to talk about…"></textarea>
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="save-note" data-id="${esc(id)}">Add note</button><button class="btn ghost" data-act="close">Close</button></div>
    ${r.relay ? '' : `<p class="small muted" style="margin-top:10px"><a href="#/swimmer/${r.swimmerId}" data-act="close-go">All of ${esc(r.swimmer.first || r.swimmer.name)}'s swims →</a></p>`}`);
  setTimeout(() => { const t = $('#t'); if (t && !res) t.focus(); }, 60);
}
function legsEditor(r) {
  const sw = [...S.model.swimmers.values()].filter((w) => (r.legs.includes(w.id) || !S.model.meetOut.has(w.id)) && (!r.ev.sex || r.ev.sex === 'X' || w.sex === r.ev.sex)).sort((a, b) => a.name.localeCompare(b.name));
  const names = r.ev.stroke === 'Medley' || /medley/i.test(r.ev.title || '') ? ['Back', 'Breast', 'Fly', 'Free'] : ['1st', '2nd', '3rd', '4th'];
  return `<h3 style="margin-top:14px">Legs</h3>
    ${[0, 1, 2, 3].map((i) => { const cur = r.legs[i];
      return `<label class="f" for="leg${i}">${names[i]}</label><select id="leg${i}"><option value="">—</option>${typeof cur === 'string' ? `<option value="s:${esc(cur)}" selected>${esc(cur)} (not on roster)</option>` : ''}${sw.map((w) => `<option value="${w.id}" ${cur === w.id ? 'selected' : ''}>${esc(w.name)} ${w.age ?? ''}${S.model.meetOut.has(w.id) ? ' (scratched)' : ''}</option>`).join('')}</select>`; }).join('')}
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="save-legs" data-id="${esc(r.id)}">Save legs</button></div>`;
}
function sheet(html) { const s = $('#sheet'); s.innerHTML = '<div class="grab"></div>' + html; s.hidden = false; $('#sheet-bg').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').onclick = closeSheet;

// ---------- end of session summary ----------
function renderSummary(n) {
  const B = blockOf(SS(), n), s = B && B.lead;
  if (!s) { app.innerHTML = '<p class="empty">Session not found.</p>'; return; }
  const ns = B.sessions.map((x) => x.n), X = sessionSummary(S.model, ns);
  const tag = X.official ? '' : ' <span class="pill off">unofficial</span>';
  const li = (a) => a.map(({ r, f }) => `<li><b>${esc(r.swimmer.name)}</b> · ${evNo(r.event)} ${esc(r.ev.title)} <span class="mono">${fmt(r.result.time)}</span> — ${esc(f.label)} ${f.sub ? `<span class="muted">(${esc(f.sub)})</span>` : ''}</li>`).join('');
  const finalsBack = /Prelim/.test(B.sessions.flatMap((x) => x.events).map((e) => e.round).join()) ? S.model.rows.filter((r) => ns.includes(r.session) && /Prelim/.test(r.round) && r.result && r.result.place && r.result.place <= 40) : [];
  app.innerHTML = `
  <p class="kicker">${esc(dayName(s.day))} · Session ${esc(B.multi ? s.block : s.n)}${B.multi ? ` · ${B.sessions.map((x) => esc(poolName(x))).join(' + ')}` : ''}</p>
  <h1>${esc(B.name)}: session summary</h1>
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
  ${finalsBack.length ? `<div class="card"><h3>Back for finals (top 40)${tag}</h3><ul class="sumlist">${finalsBack.map((r) => `<li><b>${esc(r.swimmer.name)}</b> · ${evNo(r.event)} ${esc(r.ev.title)} · ${r.result.place}${ordinal(r.result.place)} <span class="mono">${fmt(r.result.time)}</span></li>`).join('')}</ul></div>` : ''}
  ${X.close.length ? `<div class="card"><h3>Just missed (within 1%)</h3><ul class="sumlist">${X.close.map(({ r, f, miss }) => `<li><b>${esc(r.swimmer.name)}</b> · ${evNo(r.event)} ${esc(r.ev.title)} <span class="mono">${fmt(r.result.time)}</span> — ${esc(f.label)} by <span class="mono">${fmt(miss)}</span></li>`).join('')}</ul></div>` : ''}
  ${X.dq.length ? `<div class="card"><h3>DQ / NS</h3><ul class="sumlist">${X.dq.map((r) => `<li><b>${esc(r.swimmer.name)}</b> · ${evNo(r.event)} ${esc(r.ev.title)} · ${esc(r.result.status)}</li>`).join('')}</ul></div>` : ''}
  ${(() => { const N = notesFor(S.model, s); return N.meet.length + N.day.length + N.session.length ? `<div class="card"><h3>Coach notes</h3>${gnoteList(N.session, 'This session')}${gnoteList(N.day, dayName(s.day))}${gnoteList(N.meet, 'Whole meet')}</div>` : ''; })()}
  ${X.relays.length ? `<div class="card"><h3>Relays</h3><table class="t"><tbody>${X.relays.map((r) => `<tr><td>${evNo(r.event)} ${esc(r.ev.title || '')} <b>${esc(r.relay)}</b><div class="small muted">${r.legSw.map((w, i) => `${i + 1} ${w ? esc(shortName(w)) : '?'}`).join(' · ')}</div></td><td class="num">${fmt(r.seed)}</td><td class="num">${r.result ? (r.result.time != null ? fmt(r.result.time) : esc(r.result.status)) : '—'}</td><td class="num ${r.delta < 0 ? 'drop' : 'add'}">${r.delta != null ? (r.delta < 0 ? '−' : '+') + fmt(Math.abs(r.delta)) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="card"><h3>By swimmer</h3><table class="t"><thead><tr><th>Swim</th><th style="text-align:right">Seed</th><th style="text-align:right">Time</th><th style="text-align:right">+/−</th></tr></thead><tbody>
  ${X.swimmers.map((w) => `<tr><td colspan="4" style="background:var(--panel)"><b>${esc(w.swimmer.name)}</b> <span class="muted small">${w.best}/${w.rows.length} best times</span></td></tr>${w.rows.map((r) => `<tr><td>${evNo(r.event)} ${esc(r.ev.title)}${r.notes.length ? `<div class="small" style="color:var(--violet)">${r.notes.map((n) => esc([...(n.tags || []), n.text].filter(Boolean).join(' · '))).join('<br>')}</div>` : ''}</td><td class="num">${fmt(r.seed)}</td><td class="num">${r.result ? (r.result.time != null ? fmt(r.result.time) : esc(r.result.status)) : '—'}</td><td class="num ${r.delta < 0 ? 'drop' : 'add'}">${r.delta != null ? (r.delta < 0 ? '−' : '+') + fmt(Math.abs(r.delta)) : ''}</td></tr>`).join('')}`).join('')}
  </tbody></table></div>
  <div class="btns noprint"><button class="btn solid" data-act="copy-summary" data-s="${n}">Copy as text</button><button class="btn" data-act="print">Print / PDF</button><a class="btn ghost" href="#/day/${s.day}/${s.n}">Back to events</a></div>`;
}
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function summaryText(n) {
  const B = blockOf(SS(), n), s = B.lead, X = sessionSummary(S.model, B.sessions.map((x) => x.n));
  const L = [`${S.pkg.short || S.pkg.name} · ${B.name}${X.official ? '' : ' (UNOFFICIAL)'}`, `${X.swum}/${X.entries} swims · ${X.best} best times (${X.pctBest}%) · ${fmt(X.drop)} dropped`];
  const sec = (t, a) => { if (a.length) { L.push('', t); a.forEach(({ r, f }) => L.push(`• ${r.swimmer.first || r.swimmer.name} ${r.swimmer.last || ''} – ${r.ev.title} ${fmt(r.result.time)} (${f.label})`)); } };
  sec('TEAM RECORDS', X.records); sec('NEW CUTS', X.cuts); sec('TOP 10', X.top10);
  const N = notesFor(S.model, s), gn = [...N.session, ...N.day, ...N.meet];
  if (gn.length) { L.push('', 'COACH NOTES'); gn.forEach((x) => L.push(`• ${[...x.tags, x.text].filter(Boolean).join(' · ')}`)); }
  return L.join('\n');
}

// ---------- swimmer ----------
function renderSwimmer(id) {
  const sw = S.model.swimmers.get(id);
  if (!sw) { app.innerHTML = '<p class="empty">Swimmer not found.</p>'; return; }
  const rows = S.model.rows.filter((r) => r.swimmerId === id || (r.relay && r.legs.includes(id)));
  const out = S.model.meetOut.get(id);
  app.innerHTML = `<p class="kicker">${esc(S.pkg.short || S.pkg.name)}</p><h1>${esc(sw.name)} <span class="muted small">${sw.age ?? ''}</span></h1>
  ${out ? `<div class="banner warn">Scratched from the whole meet${out.why ? ` (${esc(out.why)})` : ''} · ${esc(out.by || '')} ${esc(tm(out.at))}. Their swims are hidden from the event flow and left out of summaries.</div>` : ''}
  <div class="btns" style="margin-bottom:10px"><button class="btn sm ${out ? 'solid' : 'ghost'}" data-act="mscratch" data-id="${id}" data-on="${out ? '0' : '1'}">${out ? 'Back in the meet' : 'Scratch from whole meet'}</button></div>
  ${SS().filter((s) => rows.some((r) => r.session === s.n)).map((s) => `<h3>${esc(dayShort(s.day))} · ${esc(s.name)}</h3><div class="ev">${rows.filter((r) => r.session === s.n).map((r) => rowHtml(r).replace('<div class="who">', `<div class="who"><span class="small muted">${evNo(r.event)} ${esc(r.ev.title || '')}</span><br>`)).join('')}</div>`).join('')}
  ${rows.filter((r) => r.session == null).length ? `<h3>Not placed in a session</h3><div class="ev">${rows.filter((r) => r.session == null).map((r) => rowHtml(r)).join('')}</div>` : ''}`;
}

// ---------- tools: uploads, photos, live results, settings ----------
function renderTools() {
  const r = route();
  const sessN = +r.a || (S.pkg ? currentSession() : null);
  const ss = S.pkg ? SS().filter((s) => s.nsea !== false) : [];
  const src = S.model ? S.model.sources.filter((x) => x.kind === 'live').slice(-1)[0] : null;
  const evs = S.pkg ? (SS().find((s) => s.n === sessN)?.events || []) : [];
  app.innerHTML = `<h1>Uploads & live results</h1>
  ${S.pkg ? `
  <div class="card"><label class="f" for="sess">Session</label>
    <select id="sess">${ss.map((s) => `<option value="${s.n}" ${s.n === sessN ? 'selected' : ''}>${esc(dayShort(s.day))} · ${esc(s.name)}</option>`).join('')}</select></div>

  ${(() => { const s = SS().find((x) => x.n === sessN); if (!s) return ''; return `<div class="card"><h3>Session times</h3><p class="small muted">Host moved the session? Change the times here. Every heat and event start already loaded for this session moves by the same amount, and the change syncs to all coaches.${s.changed ? ` Last changed by ${esc(s.changed.by || 'a coach')}${s.changed.shift ? ` (${s.changed.shift > 0 ? '+' : ''}${s.changed.shift} min)` : ''}.` : ''}</p>
    <label class="f" for="tm-start">Events start</label><input id="tm-start" value="${esc(s.start || '')}" placeholder="6:50 PM">
    ${(() => { const B = blockOf(SS(), s.n); return B && B.multi ? `<label class="small" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="tm-both" checked style="width:auto"> Move every pool of this session (${B.sessions.map((x) => esc(poolName(x))).join(', ')}) by the same amount</label>` : ''; })()}
    ${s.warmup ? `<label class="f" for="tm-warm">Warm-up</label><input id="tm-warm" value="${esc(s.warmup.time || '')}">
    <p class="small muted" style="margin:4px 0 0">Leave warm-up as is and it moves by the same amount as the start.</p>` : ''}
    <div class="btns" style="margin-top:8px"><button class="btn solid" data-act="save-times" data-s="${s.n}">Save times</button></div></div>`; })()}

  <div class="card"><h3>Time trials</h3><p class="small muted">Time trials aren't in the meet file. Add a session for them, then add swims on its page (typed, or from a photo of the sheet).</p>
    ${SS().filter((x) => x.tt).map((x) => `<div class="small" style="margin:4px 0"><a href="#/day/${x.day}/${x.n}">${esc(dayShort(x.day))} · ${esc(x.name)}</a> · ${S.model.rows.filter((r) => r.session === x.n).length} swims${!S.model.rows.some((r) => r.session === x.n) && x.op ? ` · <a href="#" data-act="tt-remove" data-op="${esc(x.op)}">remove</a>` : ''}</div>`).join('')}
    <label class="f" for="tt-day">Day</label><select id="tt-day">${[...new Set(SS().map((x) => x.day))].map((d) => `<option value="${d}" ${d === todayIso() ? 'selected' : ''}>${esc(dayName(d))}</option>`).join('')}</select>
    <label class="f" for="tt-start">About when (optional)</label><input id="tt-start" type="text" placeholder="12:00 PM">
    <div class="btns" style="margin-top:8px"><button class="btn solid" data-act="tt-new">Add time-trial session</button></div></div>

  <div class="card"><h3>Meet timeline (session report PDF)</h3><p class="small muted">The host's Hy-Tek session report / timeline: event start times and heat counts for every session, and each pool's session when the meet runs in two pools. Load the newest one; times already changed with Session times are replaced by it.</p>
    <input type="file" id="f-timeline" accept="application/pdf,.pdf"><div id="o-timeline"></div></div>

  <div class="card"><h3>Heat sheet (PDF)</h3><p class="small muted">Finals sheets and updated programs. Our heats and lanes for that session are replaced with what's on the sheet.</p>
    <input type="file" id="f-heat" accept="application/pdf,.pdf"><div id="o-heat"></div></div>

  <div class="card"><h3>Photo of a heat sheet (re-seed)</h3><p class="small muted">Take a picture of the posted re-seed. Only our swimmers' lines are read; you check the result before it's applied.</p>
    <label class="f" for="ev-photo">Event (if the photo doesn't show the event title)</label>
    <select id="ev-photo"><option value="">— read it from the photo —</option>${evs.map((e) => `<option value="${e.num}">#${e.num} ${esc(PK().events[e.num]?.title || '')} (${esc(e.round)})</option>`).join('')}</select>
    <input type="file" id="f-photo" accept="image/*" capture="environment" style="margin-top:8px"><div id="o-photo"></div></div>

  <div class="card"><h3>Live results web page</h3><p class="small muted">Paste the address the host pushes results to (Hy-Tek real-time results, a results page or PDF). Checked every minute while this screen is open; nothing counts as official until you mark it.</p>
    <input type="url" id="live-url" placeholder="https://…" value="${esc((src && src.url) || '')}">
    <div class="btns" style="margin-top:8px"><button class="btn solid" data-act="live-check">Check now</button><button class="btn" data-act="live-poll">${S.poll ? 'Stop auto-check' : 'Auto-check every minute'}</button></div><div id="o-live"></div></div>

  ${(() => { const M = S.model, key = M.notifyKey; const url = key ? `${location.origin}/api/meetday/notify?meet=${encodeURIComponent(S.meetId)}&key=${key}` : '';
    const ns = M.notices || [], ok = ns.filter((x) => x.status === 'matched').length, miss = ns.filter((x) => !['matched', 'not-ours', 'kept'].includes(x.status)).slice(-8).reverse();
    const why = { unread: "couldn't read", 'no-entry': 'no entry for that event' };
    return `<div class="card"><h3>Meet Mobile alerts (Android)</h3><p class="small muted">An Android phone with MacroDroid forwards each Meet Mobile result notification here. Times arrive as unofficial and sync to every coach; a time someone typed is never overwritten.</p>
    ${key ? `<label class="f" for="mm-url">Address for MacroDroid (HTTP request, POST, body = notification text)</label><input id="mm-url" readonly value="${esc(url)}">
      <div class="btns" style="margin-top:8px"><button class="btn solid" data-act="mm-copy">Copy address</button><button class="btn" data-act="mm-key">Make a new key</button></div>
      <p class="small muted">${ns.length} received · ${ok} matched${ns.length ? ` · last ${esc(new Date(ns[ns.length - 1].at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}` : ''}</p>
      ${miss.length ? `<p class="small">Not placed:</p><ul class="small">${miss.map((x) => `<li>${esc(x.text)} <span class="muted">(${esc(why[x.status] || x.status)})</span></li>`).join('')}</ul>` : ''}`
    : `<div class="btns"><button class="btn solid" data-act="mm-key">Turn on (make a key)</button></div>`}</div>`; })()}

  <div class="card"><h3>Meet Mobile screenshot</h3><p class="small muted">In Meet Mobile, filter each event's results to Favorites (our swimmers) and screenshot it. Add several events' screenshots at once: the event is read from the title on each screen. Times are unofficial.</p>
    <label class="f" for="ev-shot">Event (only if the title can't be read)</label>
    <select id="ev-shot"><option value="">— read it from the screenshot —</option>${evs.map((e) => `<option value="${e.num}">#${e.num} ${esc(PK().events[e.num]?.title || '')} (${esc(e.round)})</option>`).join('')}</select>
    <input type="file" id="f-shot" accept="image/*" multiple style="margin-top:8px"><div id="o-shot"></div></div>

  <div class="card"><h3>Official results</h3><p class="small muted">When the host posts official results, load the results PDF (or the official results page above with “official” ticked). Then mark the session official.</p>
    <input type="file" id="f-official" accept="application/pdf,.pdf"><div id="o-official"></div>
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="official" data-s="${sessN}">${S.model.official.get(sessN)?.on ? 'Mark session unofficial' : 'Mark session official'}</button></div></div>` : ''}

  <div class="card"><h3>Offline</h3><p class="small muted">Downloads the PDF and photo readers to this phone so uploads and photos work with no signal. Do this on Wi-Fi before the meet.</p>
    <div class="btns"><button class="btn" data-act="offline-libs">Download readers for offline</button></div><div id="o-off"></div></div>

  ${S.pkg ? `<div class="card"><h3>Cuts to flag</h3><div class="tags">${(S.pkg.refs.cutNames || []).map((c) => `<button class="chip" data-act="cut" data-c="${esc(c)}" aria-pressed="${S.settings.cuts.includes(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}

  ${S.pkg ? `<div class="card"><h3>Note tags</h3><p class="small muted">The quick tags on swim and coach notes. Changes sync to every coach for this meet; renaming a tag also relabels notes that already use it.</p>
    <div id="tag-list">${tagList().map((t, i) => `<div class="timein" style="margin-top:6px"><input data-tag-i="${i}" value="${esc(t)}" aria-label="Tag ${i + 1}"><button class="btn sm" data-act="tag-save" data-i="${i}">Save</button><button class="btn sm ghost" data-act="tag-del" data-i="${i}" aria-label="Delete ${esc(t)}">✕</button></div>`).join('')}</div>
    <div class="timein" style="margin-top:10px"><input id="tag-new" placeholder="New tag"><button class="btn solid" data-act="tag-add">Add</button></div>
    ${S.model.tags ? `<div class="btns" style="margin-top:8px"><button class="btn sm ghost" data-act="tag-reset">Reset to the standard list</button></div>` : ''}</div>` : ''}

  <div class="card"><h3>Meet file</h3><p class="small muted">Load a Meet Day package (.meetday.json) built from the meet folder. Coaches' phones pick it up on their next sync.</p>
    <input type="file" id="f-pkg" accept=".json,application/json"><div id="o-pkg"></div>
    ${S.pkg ? `<p class="small muted">Loaded: ${esc(S.pkg.name)} · built ${esc(new Date(S.pkg.builtAt).toLocaleString())} · ${S.ops.length} changes synced${S.outbox ? `, ${S.outbox} waiting to send` : ''}.</p>` : ''}
    ${S.err ? `<p class="small" style="color:var(--coral)">Last sync problem: ${esc(S.err)}</p>` : ''}</div>`;
  bindTools();
}
function currentSession() {
  const t = todayIso();
  const ss = SS().filter((s) => s.nsea !== false);
  return (ss.find((s) => s.day === t && clockMin(s.finish) >= nowMin()) || ss.find((s) => s.day >= t) || ss[0]).n;
}
const selSession = () => +$('#sess').value;

function bindTools() {
  const on = (id, fn) => {
    const el = $('#' + id);
    if (!el) return;
    el.onchange = async () => {
      const o = $('#o-' + id.slice(2));
      if (!el.files || !el.files.length) return;
      const files = [...el.files];
      busy(o, `Got ${files.length > 1 ? files.length + ' files' : '“' + (files[0].name || 'file') + '”'}. Working…`);
      try { await fn(files, o); }
      catch (e) { out(o, `<p class="small" style="color:var(--coral)"><b>That didn't work:</b> ${esc((e && e.message) || String(e))}</p>`); console.error(e); }
      finally { el.value = ''; } // lets the same file be picked again
    };
  };
  const sess = $('#sess'); if (sess) sess.onchange = () => { location.hash = '#/tools/' + sess.value; };
  on('f-heat', heatUpload);
  on('f-timeline', timelineUpload);
  on('f-photo', photoUpload);
  on('f-shot', shotUpload);
  on('f-official', officialUpload);
  on('f-pkg', pkgUpload);
}
const out = (el, html) => { el.innerHTML = html; };
const busy = (el, t) => out(el, `<p class="small muted">${esc(t)}</p><div class="progress"><i id="pg"></i></div>`);

let pdfjsP;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = import(CDN.pdf).then((m) => { m.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; return m; }).catch((e) => { pdfjsP = null; throw new Error('Could not load the PDF reader: ' + e.message); });
  return pdfjsP;
}
let tessP;
async function ocr(file, el, { columns = false } = {}) {
  if (!tessP) tessP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = CDN.tess; s.onload = res; s.onerror = () => rej(new Error('Could not load the photo reader (download it for offline while on Wi-Fi).')); document.head.appendChild(s); })
    .then(() => window.Tesseract.createWorker('eng', 1, { workerPath: CDN.tessWorker, corePath: CDN.tessCore, langPath: CDN.tessLang, logger: (m) => { const p = $('#pg'); if (p && m.progress) p.style.width = Math.round(m.progress * 100) + '%'; } }));
  const p = $('#pg'); if (p) p.parentElement.previousElementSibling.textContent = 'Loading the photo reader (first time needs signal)…';
  const w = await Promise.race([tessP, new Promise((_, rej) => setTimeout(() => rej(new Error('The photo reader did not load. With signal, try again; before the next meet use Tools › Download readers for offline.')), 60000))]).catch((e) => { tessP = null; throw e; });
  if (p) p.parentElement.previousElementSibling.textContent = 'Reading the image…';
  await w.setParameters({ tessedit_pageseg_mode: columns ? '3' : '6', preserve_interword_spaces: '1' });
  const img = await shrink(file);
  if (!columns) { const { data } = await w.recognize(img); return data.text; }
  // Heat sheet photos: two columns. Rebuild lines column by column from the word boxes (and level a tilted photo).
  const { data } = await w.recognize(img, {}, { blocks: true, text: true });
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) words.push({ text: wd.text, ...wd.bbox });
  return words.length ? ocrColumns(words) : data.text;
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
  const sess = guessSession(PK(), parsed) || selSession();
  const data = heatSheetRows(PK(), S.model, parsed, sess);
  if (!data.rows.length) {
    const lanes = parsed.events.flatMap((e) => e.heats.flatMap((h) => h.lanes));
    const teams = [...new Set(lanes.map((l) => l.team))].slice(0, 8);
    const why = !parsed.lineCount ? 'No text could be read from this PDF (it may be a scanned image; try a photo of each NSEA heat instead).'
      : !parsed.events.length ? `Read ${parsed.lineCount} lines but found no “Event N …” headings.`
      : !lanes.length ? `Found ${parsed.events.length} events but no swimmer lines under them.`
      : `Found ${parsed.events.length} events and ${lanes.length} swimmers; teams seen: ${teams.join(', ')}.`;
    const re = new RegExp(S.pkg.teamMatch || 'nsea', 'i');
    const ours = (parsed.lines || []).filter((t) => re.test(t) || re.test(t.replace(/[\s.\-]+/g, ''))).slice(0, 4);
    const sample = ours.length ? `<p class="small">Lines on the sheet that mention ${esc(S.pkg.teamName)} (screenshot this for Claude):</p><pre class="small" style="white-space:pre-wrap">${ours.map(esc).join('\n')}</pre>`
      : `<p class="small">No line on the sheet mentions ${esc(S.pkg.teamName)} at all. First lines read:</p><pre class="small" style="white-space:pre-wrap">${(parsed.lines || []).slice(0, 12).map(esc).join('\n')}</pre>`;
    return out(el, `<p class="small">No ${esc(S.pkg.teamName)} swimmers found on “${esc(parsed.session || files[0].name)}”. ${esc(why)}</p>${sample}`);
  }
  reviewEntries(el, data, `${parsed.session || files[0].name}: ${parsed.events.length} events, ${data.rows.length} ${S.pkg.teamName} swims → Session ${sess} (${esc(SS().find((s) => s.n === sess)?.name)})`);
}
// ---------- time trials ----------
const TT_EVENTS = [[25, 'Free'], [50, 'Free'], [100, 'Free'], [200, 'Free'], [500, 'Free'], [1000, 'Free'], [1650, 'Free'], [25, 'Back'], [50, 'Back'], [100, 'Back'], [200, 'Back'], [25, 'Breast'], [50, 'Breast'], [100, 'Breast'], [200, 'Breast'], [25, 'Fly'], [50, 'Fly'], [100, 'Fly'], [200, 'Fly'], [100, 'IM'], [200, 'IM'], [400, 'IM']];
function ttReview(el, sessN, rows, head, ocrText) {
  const roster = [...S.model.swimmers.values()].filter((w) => !S.model.meetOut.has(w.id)).sort((a, b) => a.name.localeCompare(b.name));
  const row = (r, i) => `<tr data-i="${i}"><td><select data-k="sw"><option value="">—</option>${roster.map((w) => `<option value="${w.id}" ${r.swimmerId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></td>
    <td><select data-k="ev"><option value="">—</option>${TT_EVENTS.map(([d, st]) => `<option value="${d}|${st}" ${r.dist === d && r.stroke === st ? 'selected' : ''}>${d} ${st}</option>`).join('')}</select><input data-k="shown" inputmode="numeric" placeholder="ev #" value="${r.shown ?? ''}" class="ttnum"></td>
    <td><input data-k="heat" inputmode="numeric" value="${r.heat ?? ''}"></td><td><input data-k="lane" inputmode="numeric" value="${r.lane ?? ''}"></td>
    <td><input data-k="seed" inputmode="decimal" placeholder="seed" value="${r.seed != null ? fmt(r.seed) : ''}"></td><td><button class="btn sm ghost" data-tt="del" aria-label="Remove row">✕</button></td></tr>`;
  out(el, `<p class="small"><b>${esc(head)}</b></p><div class="ttwrap"><table class="t review tt"><thead><tr><th>Swimmer</th><th>Event</th><th>Heat</th><th>Lane</th><th>Seed</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>
    <div class="btns" style="margin-top:8px"><button class="btn" data-tt="add">+ Row</button><button class="btn solid" data-tt="apply">Apply</button><button class="btn ghost" data-tt="cancel">Cancel</button></div>
    ${ocrText ? `<details><summary class="small muted">What the photo reader saw</summary><pre class="small" style="white-space:pre-wrap">${esc(ocrText)}</pre></details>` : ''}`);
  const tb = $('tbody', el);
  el.onclick = async (e) => {
    const b = e.target.closest('[data-tt]'); if (!b) return;
    e.stopPropagation();
    const k = b.dataset.tt;
    if (k === 'del') { b.closest('tr').remove(); return; }
    if (k === 'cancel') { out(el, ''); return; }
    if (k === 'add') { const last = tb.lastElementChild; const prev = last ? { dist: +String(last.querySelector('[data-k=ev]').value).split('|')[0] || null, stroke: String(last.querySelector('[data-k=ev]').value).split('|')[1] || null, heat: +last.querySelector('[data-k=heat]').value || null } : {}; tb.insertAdjacentHTML('beforeend', row(prev, tb.children.length)); return; }
    if (k === 'apply') {
      const events = { ...PK().events }, newEvents = [], rowsOut = [];
      for (const tr of tb.children) {
        const v = (q) => tr.querySelector(`[data-k=${q}]`).value.trim();
        const sw = S.model.swimmers.get(+v('sw')), [d, st] = v('ev').split('|');
        if (!sw && !d) continue;
        if (!sw || !d) { toast('Each row needs a swimmer and an event'); return; }
        const ev = ttEvent(events, sessN, { dist: +d, stroke: st, sex: sw.sex, shown: v('shown') ? +v('shown') : null });
        if (ev.meta) { events[ev.num] = ev.meta; newEvents.push(ev.meta); }
        const typed = parseTyped(v('seed'));
        const best = S.model.rows.filter((r) => r.swimmerId === sw.id && r.ev.dist === +d && r.ev.stroke === st && !r.ev.tt).map((r) => (r.result && r.result.time != null ? Math.min(r.result.time, r.seed ?? 1e9) : r.seed)).filter((x) => x != null).sort((a, b) => a - b)[0] ?? null;
        rowsOut.push({ event: ev.num, round: 'Finals', swimmerId: sw.id, name: sw.name, age: sw.age, sex: sw.sex, heat: +v('heat') || null, lane: +v('lane') || null, seed: typed ?? best, start: null });
      }
      if (!rowsOut.length) { toast('Nothing to add'); return; }
      await addOp('entries', { session: sessN, mode: 'merge', source: 'time trials', rows: rowsOut, newEvents });
      toast(`Added ${rowsOut.length} time-trial swim${rowsOut.length === 1 ? '' : 's'}`);
    }
  };
}

async function timelineUpload(files, el) {
  busy(el, 'Reading the timeline…');
  const lib = await pdfjs();
  const parsed = parseSessionReport(pdfLines(await readPdf(lib, new Uint8Array(await files[0].arrayBuffer()))));
  if (!parsed.length) return out(el, '<p class="small">No “Session: …” headings found. This needs the Hy-Tek Session Report (timeline) PDF.</p>');
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const match = (p) => SS().find((x) => x.code && String(x.code).toUpperCase() === String(p.code).toUpperCase()) || SS().find((x) => norm(x.name) === norm(p.name));
  out(el, `<p class="small"><b>${parsed.length} sessions read.</b> Check the times, then apply.</p><table class="t review"><thead><tr><th>Session</th><th>Times</th><th style="text-align:right">Events</th></tr></thead><tbody>
    ${parsed.map((p) => `<tr><td>${esc(p.code)} ${esc(p.name)} ${match(p) ? '' : '<span class="pill t-3">new</span>'}</td><td class="mono small">${esc(hm(p.start || '?'))}–${esc(hm(p.finish || '?'))}</td><td class="num">${p.events.length}${p.events.some((e) => e.heats == null) ? ' <span class="pill t-3">check</span>' : ''}</td></tr>`).join('')}</tbody></table>
    <div class="btns" style="margin-top:8px"><button class="btn solid" id="apply">Apply</button><button class="btn ghost" id="cancel">Cancel</button></div>`);
  $('#cancel', el).onclick = () => out(el, '');
  $('#apply', el).onclick = async () => {
    await addOp('timeline', { sessions: parsed });
    out(el, `<p class="small" style="color:var(--teal-dark)">Timeline applied to ${parsed.length} sessions.</p>`);
  };
}
async function photoUpload(files, el) {
  busy(el, 'Reading the photo (this takes a few seconds)…');
  const text = await ocr(files[0], el, { columns: true });
  const ev = +$('#ev-photo').value || null;
  const data = photoHeatRows(PK(), S.model, text, selSession(), ev);
  if (!data.rows.length) return out(el, `<p class="small">Couldn't find our swimmers in that photo. Try a straighter, closer shot, or pick the event.</p><details><summary class="small">What was read</summary><pre class="small">${esc(text)}</pre></details>`);
  reviewEntries(el, data, `Found ${data.rows.length} of our swimmers. Check heats and lanes before applying.`, true);
  el.insertAdjacentHTML('beforeend', `<details><summary class="small muted">What the photo reader saw</summary><pre class="small" style="white-space:pre-wrap">${esc(text)}</pre></details>`);
}
function reviewEntries(el, data, head, editable) {
  out(el, `<p class="small"><b>${esc(head)}</b></p><table class="t review"><thead><tr><th>Swimmer</th><th>Ev</th><th>Heat</th><th>Lane</th><th style="text-align:right">Seed</th></tr></thead><tbody>
    ${data.rows.map((r, i) => `<tr><td>${esc(r.name)}${r.isNew ? ' <span class="pill t-3">new</span>' : ''}${r.guessed ? ' <span class="pill t-3">check</span>' : ''}</td><td>#${r.event}</td>
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
  const all = [], missed = [];
  const picked = +$('#ev-shot').value || null;
  for (const [i, f] of [...files].entries()) {
    busy(el, `Reading screenshot ${i + 1} of ${files.length}…`);
    const text = await ocr(f, el);
    const r = screenshotResults(PK(), S.model, text, { event: files.length === 1 ? picked : null, session: selSession() });
    if (!r.event && picked) Object.assign(r, screenshotResults(PK(), S.model, text, { event: picked, session: selSession() }));
    if (!r.event) { missed.push(f.name || `screenshot ${i + 1}`); continue; }
    all.push(...r.results.map((x) => ({ ...x, event: r.event })));
  }
  reviewResults(el, all, 'screenshot (OCR)');
  if (missed.length) el.insertAdjacentHTML('afterbegin', `<p class="small" style="color:var(--coral)">Couldn't tell which event ${missed.length === 1 ? 'this screenshot shows' : 'these screenshots show'}: ${missed.map(esc).join(', ')}. Pick the event above and add ${missed.length === 1 ? 'it' : 'them'} again.</p>`);
}
function reviewResults(el, list, source, official) {
  if (!list.length) return out(el, `<p class="small">No new times for our swimmers.</p>`);
  out(el, `<table class="t review"><thead><tr><th>Swimmer</th><th>Ev</th><th>Time</th></tr></thead><tbody>
    ${list.map((r, i) => `<tr><td>${esc(r.swimmer)}${r.fuzzy ? ' <span class="pill t-3">check name</span>' : ''}</td><td>#${r.event}</td><td><input data-i="${i}" style="width:90px" value="${r.time != null ? fmt(r.time) : esc(r.status)}"></td></tr>`).join('')}</tbody></table>
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
  const list = resultOps(PK(), S.model, swims, { source: 'official results PDF', official: true, session: selSession() });
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
  const list = resultsFromText(PK(), S.model, text, { source: 'live results', official: false, session });
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
    if (a === 'now') { const el = document.getElementById(`ev-${t.dataset.ev}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'pool') { S.pool = t.dataset.p; render(); return; }
    if (a === 'tag') { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); return; }
    if (a === 'mm-key') {
      if (S.model.notifyKey && !confirm('Make a new key? The old address stops working until MacroDroid gets the new one.')) return;
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      const key = [...b].map((x) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[x % 57]).join('');
      await addOp('notifykey', { key }); toast('Key made. Copy the address into MacroDroid.'); render(); return;
    }
    if (a === 'mm-copy') { await navigator.clipboard.writeText($('#mm-url').value); toast('Address copied'); return; }
    if (a === 'save-times') {
      const n = +t.dataset.s, s = SS().find((x) => x.n === n);
      const start = $('#tm-start').value.trim(), warmEl = $('#tm-warm');
      const a0 = clockMin(s.start || ''), a1 = clockMin(/[AP]M/i.test(start) ? start : `${start} ${(String(s.start).match(/[AP]M/i) || ['PM'])[0]}`);
      if (a1 == null) { toast('Type a start time like 6:50 PM'); return; }
      const data = { session: n, start: minClock(a1), shift: a0 == null ? 0 : a1 - a0 };
      if (warmEl && warmEl.value.trim() && warmEl.value.trim() !== (s.warmup && s.warmup.time)) data.warmup = warmEl.value.trim();
      if (!data.shift && !data.warmup) { toast('Nothing changed'); return; }
      const B = blockOf(SS(), n);
      if ($('#tm-both') && $('#tm-both').checked && B && B.multi && data.shift) {
        for (const x of B.sessions) await addOp('times', { ...data, session: x.n, start: x.n === n ? data.start : minClock(clockMin(x.start) + data.shift) });
      } else await addOp('times', data);
      toast(data.shift ? `Session moved ${data.shift > 0 ? '+' : ''}${data.shift} min` : 'Warm-up updated'); render(); return;
    }
    if (a === 'save-time') {
      const v = $('#t').value; const cs = parseTyped(v);
      if (cs == null) { toast('Type a time like 5912 or 1:02.45'); return; }
      await addOp('result', { entry: t.dataset.id, time: cs, status: 'OK', source: 'manual', official: false });
      closeSheet(); toast('Saved'); return;
    }
    if (a === 'save-hl') {
      const r = S.model.rows.find((x) => x.id === t.dataset.id);
      const heat = parseInt($('#hh').value, 10), lane = parseInt($('#ll').value, 10);
      if (!heat || !lane || lane > 12) { toast('Type a heat and a lane'); return; }
      await addOp('entries', { session: r.session, mode: 'merge', source: 'typed heat/lane', rows: [{ event: r.event, round: r.round, swimmerId: r.swimmerId, name: r.swimmer.name, heat, heats: r.heats, lane, seed: r.seed, start: r.start }] });
      closeSheet(); toast(`Heat ${heat}, lane ${lane}`); return;
    }
    if (a === 'status') { await addOp('result', { entry: t.dataset.id, time: null, status: t.dataset.s, source: 'manual', official: false }); closeSheet(); return; }
    if (a === 'clear-time') { const r = S.model.rows.find((x) => x.id === t.dataset.id); if (r && r.result) await addOp('undo', { op: r.result.op }); closeSheet(); return; }
    if (a === 'scratch') { const r = S.model.rows.find((x) => x.id === t.dataset.id); await addOp('scratch', { entry: t.dataset.id, on: !r.scratched }); closeSheet(); return; }
    if (a === 'tt-new') {
      const day = $('#tt-day').value, st = $('#tt-start').value.trim();
      const start = st ? (/[AP]M/i.test(st) ? st : `${st} PM`) : null;
      const n = Math.max(900, ...SS().map((x) => x.n)) + 1;
      const name = `${new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })} time trials`;
      await addOp('session', { n, day, name, start, tt: true }); location.hash = `#/day/${day}/${n}`; return;
    }
    if (a === 'tt-remove') { ev.preventDefault(); if (!confirm('Remove this time-trial session?')) return; await addOp('undo', { op: t.dataset.op }); return; }
    if (a === 'tt-add') { const o = $('#o-ttphoto'); ttReview(o, +t.dataset.s, [{}, {}, {}], 'Add swims: pick the swimmer and event, then heat and lane as posted (seed fills in from their entry times if left blank).'); return; }
    if (a === 'save-legs') {
      const legs = [0, 1, 2, 3].map((i) => { const v = $('#leg' + i).value; return !v ? null : v.startsWith('s:') ? v.slice(2) : +v; });
      const ids = legs.filter((x) => typeof x === 'number');
      if (new Set(ids).size !== ids.length) { toast('Someone is on two legs'); return; }
      await addOp('legs', { entry: t.dataset.id, legs }); openEntry(t.dataset.id); toast('Legs saved'); return;
    }
    if (a === 'save-gnote') {
      const text = $('#gnote').value.trim(), card = t.closest('.gnotes');
      const tags = [...card.querySelectorAll('[data-act=tag][aria-pressed=true]')].map((x) => x.textContent);
      if (!text && !tags.length) { toast('Write a note or pick a tag'); return; }
      const scope = $('#gscope') ? $('#gscope').value : 'meet', s = SS().find((x) => x.n === +t.dataset.s);
      await addOp('gnote', { scope, key: scope === 'session' ? s.n : scope === 'day' ? s.day : null, text, tags }); toast('Note added'); return;
    }
    if (a === 'mscratch') {
      const id = +t.dataset.id, on = t.dataset.on === '1', w = S.model.swimmers.get(id);
      if (on) { const why = prompt(`Scratch ${w.name} from the whole meet? Their swims are hidden and left out of summaries. Reason (optional):`, ''); if (why === null) return; await addOp('mscratch', { swimmer: id, on: true, why: why.trim() }); }
      else await addOp('mscratch', { swimmer: id, on: false });
      toast(on ? 'Scratched from the meet' : 'Back in the meet'); return;
    }
    if (a === 'tag-add' || a === 'tag-save' || a === 'tag-del' || a === 'tag-reset') {
      let list = [...tagList()], rename = null;
      if (a === 'tag-add') { const v = $('#tag-new').value.trim(); if (!v) return; if (list.includes(v)) { toast('Already a tag'); return; } list.push(v); }
      if (a === 'tag-save') { const i = +t.dataset.i, v = $(`[data-tag-i="${i}"]`).value.trim(); if (!v || v === list[i]) return; if (list.includes(v)) { toast('Already a tag'); return; } rename = { from: list[i], to: v }; list[i] = v; }
      if (a === 'tag-del') { const i = +t.dataset.i; if (!confirm(`Delete the tag "${list[i]}"? Notes that already use it keep it.`)) return; list.splice(i, 1); }
      if (a === 'tag-reset') list = [...TAGS];
      S.settings.tags = list; await store.set('settings', S.settings);
      await addOp('tags', rename ? { list, rename } : { list }); toast('Tags updated'); return;
    }
    if (a === 'save-note') {
      const text = $('#note').value.trim(); const tags = [...document.querySelectorAll('#sheet [data-act=tag][aria-pressed=true]')].map((x) => x.textContent);
      if (!text && !tags.length) { toast('Write a note or pick a tag'); return; }
      await addOp('note', { entry: t.dataset.id, text, tags }); openEntry(t.dataset.id); toast('Note added'); return;
    }
    if (a === 'undo') { ev.preventDefault(); if (!t.closest('#sheet') && !confirm('Remove this note?')) return; await addOp('undo', { op: t.dataset.op }); const id = $('#sheet [data-act=save-note]')?.dataset.id; if (id) openEntry(id); return; }
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

// Anything that fails silently on a phone shows up as a message instead.
addEventListener('error', (e) => toast('Error: ' + (e.message || 'unknown'), 6000));
addEventListener('unhandledrejection', (e) => toast('Error: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'), 6000));

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
  if (!location.hash && S.pkg) { const t = todayIso(); if (SS().some((s) => s.day === t && s.nsea !== false)) location.hash = `#/day/${t}`; }
  render();
  sync();
})();
