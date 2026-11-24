// Meet Day model: package + ops -> what the screens show. Pure functions (tested in test/meetday.test.mjs).
import { flagsFor, DEFAULT_CUTS } from './flags.mjs';
import { sameSwimmer, clockMin, minClock, parseMmNotify } from './parse.mjs';
import { dqCalls, matchDq, dqCall } from './dqcodes.mjs';

export const relayKey = (event, round, letter) => `${event}-${String(round || 'F')[0]}${/2$/.test(round || '') ? '2' : ''}-R${letter}`;
export const entryKey = (event, round, swimmerId) => `${event}-${String(round || 'F')[0]}${/2$/.test(round || '') ? '2' : ''}-${swimmerId}`;

// Motivational standards (B through AAAA): one "B–AAAA" choice in the app.
export const MOTIVATIONAL = ['B', 'BB', 'A', 'AA', 'AAA', 'AAAA'];
// A session (pool) where every event is 12 & under: track the motivational times and age group champs by default.
const YOUNG = /\b(?:8|10|12) & Under\b|\b(?:9-10|11-12|10 & U|8 & U)\b/i;
export function youngSession(session, events) {
  const ts = (session.events || []).map((e) => (events[e.num] || {}).title || '').filter(Boolean);
  return ts.length > 0 && ts.every((t) => YOUNG.test(t) && !/\b1[3-9]\b|Open|Senior|& Over/i.test(t));
}
export function autoCuts(session, events, base, names) {
  if (!youngSession(session, events)) return base;
  const have = new Set(names && names.length ? names : [...MOTIVATIONAL, 'NC AG']);
  return [...MOTIVATIONAL, 'NC AG'].filter((c) => have.has(c));
}
// Coach assignment groups (session setup): which of the session's swimmers a coach is mainly watching.
export const GROUPS = { all: 'All swimmers', '12U': '12 & Under', '13O': '13 & Over', '10U': '10 & Under', '11-12': '11–12', '13-14': '13–14', '15O': '15 & Over', F: 'Girls', M: 'Boys' };
export function inGroup(group, sw) {
  const a = sw && sw.age;
  switch (group || 'all') {
    case 'all': return true;
    case '12U': return a != null && a <= 12;
    case '13O': return a != null && a >= 13;
    case '10U': return a != null && a <= 10;
    case '11-12': return a === 11 || a === 12;
    case '13-14': return a === 13 || a === 14;
    case '15O': return a != null && a >= 15;
    case 'F': case 'M': return sw.sex === group;
    default: return true;
  }
}

// A swim's DQ: the coach's call (codes + descriptions + details) and, when official results printed a reason,
// that reason too (`dqOfficial`). With no coach call, the official reason stands in as the DQ's reason.
function dqOf(q, r, ev, relay) {
  const off = r && r.status === 'DQ' && r.dqWhy ? (() => { const c = matchDq(r.dqWhy, ev && ev.stroke, relay); return { desc: r.dqWhy, call: c ? dqCall(c) : null }; })() : null;
  if (q) return { dq: { ...q, calls: dqCalls(q, ev && ev.stroke, relay) }, dqOfficial: off };
  if (off) return { dq: { calls: [off.call || { code: '', slip: '', desc: off.desc }], codes: off.call ? [off.call.code] : [], text: '', by: 'official results', official: true }, dqOfficial: off };
  return { dq: null, dqOfficial: null };
}

export function derive(pkg, ops, settings = {}) {
  const baseCuts = settings.cuts || DEFAULT_CUTS;
  const swimmers = new Map(pkg.swimmers.map((s) => [s.id, { ...s }]));
  const entries = new Map(pkg.entries.map((e) => [e.id, { ...e }]));
  const sorted = [...ops].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : String(a.id).localeCompare(String(b.id))));
  const undone = new Set(sorted.filter((o) => o.type === 'undo').map((o) => o.data && o.data.op));
  const results = new Map(), notes = new Map(), scratch = new Map(), official = new Map(), sources = [];
  const notices = []; let notifyKey = null;
  const meetOut = new Map(), gnotes = [], renames = [], legsOf = new Map(); let tags = null;
  const dqs = new Map(), stars = new Map(), sessOut = new Map(), assigns = new Map(), sessCuts = new Map(); let meetCuts = null;
  const events = { ...pkg.events };
  const addEvents = (list) => { for (const e of list || []) if (e && e.num && !events[e.num] && (e.title || e.dist)) events[e.num] = { ...(e.tt ? { tt: true, ttSession: e.ttSession, shown: e.shown ?? null } : {}), num: e.num, sex: e.sex, dist: e.dist, stroke: e.stroke, relay: !!e.relay, course: pkg.course, title: String(e.title || '').replace(/ Yard /, ' ').replace(/ Open /, ' ') }; };
  const sessions = pkg.sessions.map((x) => ({ ...x, warmup: x.warmup ? { ...x.warmup } : x.warmup, events: (x.events || []).map((e) => ({ ...e })) }));

  for (const o of sorted) {
    if (undone.has(o.id) || o.type === 'undo') continue;
    const d = o.data || {};
    if (o.type === 'entries') {
      addEvents(d.newEvents); applyEntries(entries, swimmers, d); applyHeatInfo(sessions, d);
      const ts = sessions.find((x) => x.n === d.session && x.tt);
      if (ts) for (const r of d.rows || []) if (!ts.events.some((e) => e.num === r.event)) ts.events.push({ num: r.event, round: r.round || 'Finals' });
    }
    else if (o.type === 'result') results.set(d.entry, { ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'note') (notes.get(d.entry) || notes.set(d.entry, []).get(d.entry)).push({ ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'scratch') scratch.set(d.entry, !!d.on);
    else if (o.type === 'official') official.set(d.session, { on: !!d.on, by: o.by, at: o.at });
    else if (o.type === 'source') sources.push({ ...d, at: o.at, by: o.by });
    else if (o.type === 'times') applyTimes(sessions, entries, d, o);
    else if (o.type === 'timeline') { applyTimeline(sessions, pkg, d.sessions, { at: o.at, by: o.by }); for (const x of d.sessions || []) addEvents(x.events); }
    else if (o.type === 'notifykey') notifyKey = d.key || null;
    else if (o.type === 'legs') legsOf.set(d.entry, Array.isArray(d.legs) ? d.legs.slice(0, 4) : []);
    else if (o.type === 'session') addSession(sessions, d, o);
    else if (o.type === 'mscratch') { if (d.on) meetOut.set(d.swimmer, { by: o.by, at: o.at, why: d.why || '' }); else meetOut.delete(d.swimmer); }
    else if (o.type === 'gnote') gnotes.push({ scope: d.scope, key: d.key ?? null, text: d.text || '', tags: d.tags || [], by: o.by, at: o.at, op: o.id });
    else if (o.type === 'tags') { if (Array.isArray(d.list)) tags = d.list.filter(Boolean); if (d.rename && d.rename.from && d.rename.to) renames.push(d.rename); }
    else if (o.type === 'dq') { if ((d.calls && d.calls.length) || (d.codes && d.codes.length) || d.text) dqs.set(d.entry, { calls: d.calls || null, codes: d.codes || [], text: d.text || '', by: o.by, at: o.at, op: o.id }); else dqs.delete(d.entry); }
    else if (o.type === 'star') { if (d.on) stars.set(d.entry, { by: o.by, at: o.at }); else stars.delete(d.entry); }
    else if (o.type === 'sscratch') for (const n of [].concat(d.sessions ?? d.session)) { const k = `${n}|${d.swimmer}`; if (d.on) sessOut.set(k, { by: o.by, at: o.at, why: d.why || '' }); else sessOut.delete(k); }
    else if (o.type === 'assign') { const k = `${d.block}|${d.coach}`; if (d.on === false) assigns.delete(k); else if (d.coach) assigns.set(k, { block: d.block, coach: d.coach, pools: d.pools || [], group: d.group || 'all', by: o.by, at: o.at }); }
    else if (o.type === 'cuts') { const list = Array.isArray(d.list) ? d.list : null; if (d.session == null) meetCuts = list; else for (const n of [].concat(d.session)) if (list) sessCuts.set(n, list); else sessCuts.delete(n); }
    else if (o.type === 'mmnotify') notices.push(applyNotify(pkg, sessions, entries, swimmers, results, d, o));
  }

  // Renaming a tag relabels the notes that already use it (deleting a tag leaves old notes as they were).
  const relabel = (t) => renames.reduce((x, r) => (x === r.from ? r.to : x), t);
  if (renames.length) {
    for (const list of notes.values()) for (const n of list) n.tags = (n.tags || []).map(relabel);
    for (const n of gnotes) n.tags = n.tags.map(relabel);
  }
  // Cuts flagged in a session: that session's (or pool's) own choice, else the meet's, else 12 & under
  // defaults for a 12 & under pool, else this phone's list. Team records and Top 10 are always tracked.
  const meetBase = meetCuts || baseCuts;
  const cutInfo = (n) => {
    if (sessCuts.has(n)) return { list: sessCuts.get(n), how: 'session' };
    const s = sessions.find((x) => x.n === n);
    const auto = s ? autoCuts(s, events, meetBase, pkg.refs && pkg.refs.cutNames) : meetBase;
    return { list: auto, how: auto !== meetBase ? 'auto' : meetCuts ? 'meet' : 'phone' };
  };
  const cutsMemo = new Map();
  const cutsOf = (n) => { if (!cutsMemo.has(n)) cutsMemo.set(n, cutInfo(n)); return cutsMemo.get(n).list; };
  const rows = [];
  for (const e of entries.values()) {
    const ev = events[e.event] || {};
    if (e.relay) {
      // A relay: the "swimmer" is the team's relay; legs are swimmer ids (or names not on our roster).
      const legs = (legsOf.get(e.id) || e.legs || []).slice(0, 4);
      const legSw = legs.map((x) => (typeof x === 'number' ? swimmers.get(x) : null) || (x ? { name: String(x), unknown: true } : null));
      const r = results.get(e.id) || null, off = official.get(e.session);
      rows.push({
        ...e, swimmer: { id: `R${e.relay}`, name: `${pkg.teamName || 'NSEA'} ${e.relay} relay`, first: `${e.relay} relay`, relay: true, sex: ev.sex }, ev, result: r,
        notes: notes.get(e.id) || [], scratched: !!scratch.get(e.id), meetOut: false, legs, legSw, ...dqOf(dqs.get(e.id), r, ev, true), starred: stars.has(e.id),
        legOut: legs.filter((x) => meetOut.has(x)).map((x) => swimmers.get(x)?.name).filter(Boolean),
        official: !!(off && off.on) || !!(r && r.official), pre: [], post: [],
        delta: r && r.time != null && e.seed != null ? r.time - e.seed : null, startMin: clockMin(e.start || ''),
      });
      continue;
    }
    const s = swimmers.get(e.swimmerId);
    if (!s) continue;
    const r = results.get(e.id) || null;
    const off = official.get(e.session);
    const swim = { sex: s.sex, age: s.age, dist: ev.dist, stroke: ev.stroke, name: s.name, seed: e.seed };
    const cuts = cutsOf(e.session);
    const pre = flagsFor(swim, pkg.refs, { cuts });
    const post = r && r.time != null ? flagsFor({ ...swim, time: r.time }, pkg.refs, { cuts }) : [];
    const so = sessOut.get(`${e.session}|${e.swimmerId}`) || null;
    rows.push({
      ...e, swimmer: s, ev, result: r, notes: notes.get(e.id) || [], scratched: !!scratch.get(e.id) || meetOut.has(e.swimmerId) || !!so, meetOut: meetOut.has(e.swimmerId), sessOut: so,
      ...dqOf(dqs.get(e.id), r, ev, false), starred: stars.has(e.id),
      official: !!(off && off.on) || !!(r && r.official), pre, post,
      delta: r && r.time != null && e.seed != null ? r.time - e.seed : null,
      startMin: clockMin(e.start || ''),
    });
  }
  // Meet Manager files Did Not Finish and Declared False Start as their own results (DNF, DFS), though
  // they're on the DQ slip (7C, 7D). A DQ whose only call is one of them reads as that status.
  for (const x of rows) {
    const codes = x.result && x.result.status === 'DQ' && x.dq ? x.dq.calls.map((c) => c.code) : [];
    const st = codes.length && codes.every((c) => c === '7C') ? 'DNF' : codes.length && codes.every((c) => c === '7D') ? 'DFS' : null;
    if (st) x.result = { ...x.result, status: st, fromDq: true };
  }
  compareRounds(rows);
  rows.sort((a, b) => (a.session ?? 99) - (b.session ?? 99) || order(sessions, a) - order(sessions, b) || (a.heat ?? 99) - (b.heat ?? 99) || (a.lane ?? 99) - (b.lane ?? 99));
  const cutsInfo = (n) => { cutsOf(n); return cutsMemo.get(n); };
  return { rows, swimmers, official, sources, results, sessions, events, legsOf, notices, notifyKey, meetOut, gnotes, tags, sessOut, assigns: [...assigns.values()], meetCuts, cutsOf, cutsInfo };
}

// Entry time vs prelims: every swim is measured against the swimmer's entry time (best time, time dropped);
// a final after prelims also shows its change from the prelim swim. Adds entryTime, dEntry, best, and for finals
// isFinal, prelim ({ time, status } or null), dPrelim. `delta` is what the card shows first: vs prelims for a
// final, vs seed otherwise.
export function compareRounds(rows) {
  const prelims = new Map();
  for (const r of rows) if (!r.relay && /Prelim/i.test(r.round || '')) prelims.set(`${r.swimmerId}|${r.event}`, r);
  for (const r of rows) {
    const t = r.result && r.result.time != null ? r.result.time : null;
    const p = !r.relay && !/Prelim/i.test(r.round || '') ? prelims.get(`${r.swimmerId}|${r.event}`) : null;
    if (p && p !== r) {
      r.isFinal = true;
      r.prelim = p.result ? { time: p.result.time ?? null, status: p.result.status } : null;
      r.entryTime = p.entrySeed ?? p.seed ?? null;
      const base = r.prelim && r.prelim.time != null ? r.prelim.time : r.seed;
      r.dPrelim = t != null && base != null ? t - base : null;
      r.delta = r.dPrelim;
    } else {
      r.entryTime = r.entrySeed ?? r.seed ?? null;
    }
    r.dEntry = t != null && r.entryTime != null ? t - r.entryTime : null;
    r.best = t != null && !r.relay && (r.entryTime == null || t < r.entryTime);
  }
  return rows;
}

// Session time change (e.g. the host pushes the session back 30 min).
// data: { session, start?, warmup?, sprints?, shift? (minutes) }. Heat and event start times already
// loaded for that session move by `shift`; heat sheets uploaded afterwards keep their printed times.
const shiftClock = (t, m) => { const n = clockMin(t || ''); return n == null ? t : minClock(n + m); };
const shiftText = (t, m) => String(t || '').replace(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/gi, (all, h, mm, ap) => {
  const ref = ap || (String(t).match(/[AP]M/i) || ['PM'])[0];
  const out = minClock(clockMin(`${h}:${mm} ${ref}`) + m).replace(/^0/, '');
  return ap ? out : out.replace(/\s*[AP]M$/, '');
});
export function applyTimes(sessions, entries, d, o = {}) {
  const s = sessions.find((x) => x.n === d.session);
  if (!s) return;
  const m = Math.round(+d.shift || 0);
  if (m) {
    s.finish = shiftClock(s.finish, m);
    for (const e of s.events || []) {
      if (e.start) e.start = shiftClock(e.start, m);
      if (Array.isArray(e.heatStarts)) e.heatStarts = e.heatStarts.map((t) => (t ? shiftClock(t, m) : t));
    }
    if (s.warmup && !d.warmup) s.warmup.time = shiftText(s.warmup.time, m);
    if (s.warmup && !d.sprints && s.warmup.sprints) s.warmup.sprints = shiftText(s.warmup.sprints, m);
    for (const e of entries.values()) if (e.session === d.session && e.start) e.start = shiftClock(e.start, m);
  }
  if (d.start) s.start = minClock(clockMin(d.start));
  if (d.warmup && s.warmup) s.warmup.time = d.warmup;
  if (d.sprints && s.warmup) s.warmup.sprints = d.sprints;
  s.changed = { by: o.by, at: o.at, shift: m };
}

function order(sessions, r) {
  const s = sessions.find((x) => x.n === r.session);
  const i = s ? s.events.findIndex((e) => e.num === r.event && (e.round || 'Finals') === (r.round || 'Finals')) : -1;
  return i < 0 ? 999 : i;
}

// data: { session, mode: 'replace' | 'merge', rows: [{ event, round, swimmerId?, name, age, sex, heat, heats, lane, seed, start }] }
export function applyEntries(entries, swimmers, d) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const touched = new Set(rows.map((r) => `${r.event}|${r.round}`));
  const keep = new Set();
  for (const r of rows) {
    if (r.relay) {
      const id = relayKey(r.event, r.round, r.relay);
      const old = entries.get(id);
      const legs = (r.legs || []).map((x) => (typeof x === 'number' ? x : ([...swimmers.values()].find((s) => sameSwimmer(s.name, x)) || {}).id ?? x));
      entries.set(id, { ...(old || {}), id, relay: r.relay, swimmerId: null, event: r.event, round: r.round, session: d.session ?? (old && old.session), heat: r.heat ?? null, heats: r.heats ?? null, lane: r.lane ?? null, seed: r.seed ?? (old && old.seed) ?? null, start: r.start || (old && old.start) || null, legs: legs.some(Boolean) ? legs : (old && old.legs) || [], source: d.source || 'heat sheet update' });
      keep.add(id);
      continue;
    }
    let sid = r.swimmerId;
    if (sid == null || !swimmers.has(sid)) {
      const found = [...swimmers.values()].find((s) => sameSwimmer(s.name, r.name));
      if (found) sid = found.id;
      else { sid = 5000 + swimmers.size; swimmers.set(sid, { id: sid, name: r.name, sex: r.sex || 'X', age: r.age, added: true }); }
    }
    const id = entryKey(r.event, r.round, sid);
    const old = entries.get(id) || [...entries.values()].find((e) => e.event === r.event && e.round === r.round && e.swimmerId === sid);
    entries.set(old ? old.id : id, { ...(old || {}), id: old ? old.id : id, swimmerId: sid, event: r.event, round: r.round, session: d.session ?? (old && old.session), heat: r.heat ?? null, heats: r.heats ?? null, lane: r.lane ?? null, seed: r.seed ?? (old && old.seed) ?? null, start: r.start || (old && old.start) || null, source: d.source || 'heat sheet update' });
    keep.add(old ? old.id : id);
  }
  if (d.mode === 'replace') for (const [id, e] of entries) if (touched.has(`${e.event}|${e.round}`) && e.session === d.session && !keep.has(id)) entries.delete(id);
}

// Heat counts / heat start times for every event on an uploaded heat sheet (ours or not), so events we
// have no swimmers in still show how many heats and roughly when. data.heatInfo: [{ num, heats, starts }]
export function applyHeatInfo(sessions, d) {
  const s = sessions.find((x) => x.n === d.session);
  if (!s || !Array.isArray(d.heatInfo)) return;
  for (const h of d.heatInfo) {
    let e = s.events.find((x) => x.num === h.num);
    if (!e) { e = { num: h.num, round: h.round || 'Finals', start: null, added: true }; s.events.push(e); }
    e.heats = h.heats || null;
    e.heatStarts = Array.isArray(h.starts) ? h.starts : [];
  }
  if (s.events.some((e) => e.added)) {
    const t = (e) => clockMin((e.heatStarts && e.heatStarts[0]) || e.start || '');
    s.events.sort((a, b) => (t(a) ?? 9e3) - (t(b) ?? 9e3) || a.num - b.num);
  }
}
export const heatInfoOf = (parsed) => parsed.events.map((e) => ({ num: e.num, round: e.heats[0]?.round || null, heats: e.heats.length, starts: e.heats.map((h) => h.start || null) }));

// Event for a time-trial swim. TT sheets have their own numbering (or none), so TT events get numbers of
// their own from 9001 up; the number printed on the sheet is kept as `shown`. Same distance/stroke/sex in the
// same TT session -> same event. Returns { num, meta } (meta only when the event is new).
export function ttEvent(events, session, { dist, stroke, sex, shown } = {}) {
  const same = Object.values(events).find((e) => e.tt && e.ttSession === session && e.dist === dist && e.stroke === stroke && e.sex === sex && (shown == null || e.shown == null || String(e.shown) === String(shown)));
  if (same) return { num: same.num };
  const num = Math.max(9000, ...Object.keys(events).map(Number)) + 1;
  const sx = sex === 'F' ? 'Girls' : sex === 'M' ? 'Boys' : 'Mixed';
  return { num, meta: { num, sex, dist, stroke, course: 'SCY', title: `${sx} ${dist} ${stroke}`, tt: true, ttSession: session, shown: shown ?? null } };
}

// A session added in the app (time trials, or anything else not in the meet file). data: { n, day, name, start?, tt? }
export function addSession(sessions, d, o = {}) {
  if (!d || !d.day || !d.name) return;
  const n = d.n && !sessions.some((x) => x.n === d.n) ? d.n : Math.max(900, ...sessions.map((x) => x.n)) + 1;
  sessions.push({ n, day: d.day, name: d.name, label: d.tt ? 'Time trials' : (d.label || ''), start: d.start && clockMin(d.start) != null ? minClock(clockMin(d.start)) : null, finish: null, events: [], tt: !!d.tt, nsea: true, addedBy: o.by, op: o.id });
  sessions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (clockMin(a.start || '') ?? 1e4) - (clockMin(b.start || '') ?? 1e4));
}

// ---------- multi-pool meets ----------
// Hy-Tek splits a session run in two pools into sub-sessions ("2G Saturday Prelim - Girls Scoreboard",
// "2B ... - Boys Divewell"). In the app each pool is its own session (its own events, times, heat sheet,
// official flag) and sessions sharing a `block` are shown and summarised together.
const poolOf = (name) => (String(name || '').match(/\s-\s(.+)$/) || [])[1] || null;
const blockName = (name) => String(name || '').replace(/\s-\s.+$/, '').trim();
const isoPlus = (iso, days) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// parsed: parseSessionReport() output. Updates matching sessions (by code, then name) with start, finish, heat
// counts and event start times; sessions not in the meet yet are added. Coach-entered warm-ups/notes are kept.
export function applyTimeline(sessions, pkg, parsed, o = {}) {
  if (!Array.isArray(parsed)) return;
  for (const p of parsed) {
    let s = sessions.find((x) => x.code && p.code && String(x.code).toUpperCase() === String(p.code).toUpperCase())
      || sessions.find((x) => norm(x.name) === norm(p.name));
    if (!s) {
      const day = p.day && pkg.start ? isoPlus(pkg.start, p.day - 1) : (sessions[sessions.length - 1] || {}).day;
      const blk = String(p.code || '').match(/^(\d+)[A-Z]$/i);
      const mate = blk && sessions.find((x) => x.block === blk[1] && x.warmup);
      s = { n: Math.max(0, ...sessions.map((x) => x.n)) + 1, day, name: p.name, label: '', events: [], added: true, ...(mate ? { warmup: { ...mate.warmup }, nsea: mate.nsea } : {}) };
      sessions.push(s);
    }
    s.code = s.code || p.code;
    const blk = String(p.code || '').match(/^(\d+)[A-Z]$/i);
    if (blk) { s.block = s.block || blk[1]; s.pool = s.pool || poolOf(p.name) || p.pool; }
    if (p.start) s.start = p.start;
    if (p.finish) s.finish = p.finish;
    if (p.interval) s.interval = p.interval;
    for (const pe of p.events || []) {
      let e = s.events.find((x) => x.num === pe.num);
      if (!e) { e = { num: pe.num, round: pe.round }; s.events.push(e); }
      if (pe.start) e.start = pe.start;
      if (pe.heats != null) e.heats = pe.heats;
      if (pe.entries != null) e.entries = pe.entries;
      if (!e.round) e.round = pe.round;
    }
    const idx = new Map((p.events || []).map((e, i) => [e.num, i]));
    s.events.sort((a, b) => (idx.get(a.num) ?? 999) - (idx.get(b.num) ?? 999));
    s.timeline = { at: o.at || null, by: o.by || null };
  }
  sessions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (clockMin(a.start || '') ?? 0) - (clockMin(b.start || '') ?? 0) || String(a.pool || '').localeCompare(String(b.pool || '')));
}

// Sessions grouped for display: pools of the same block together, everything else on its own.
export function blocksOf(sessions) {
  const out = [];
  for (const s of sessions) {
    const k = s.block ? `${s.day}|${s.block}` : `n${s.n}`;
    let b = out.find((x) => x.key === k);
    if (!b) out.push(b = { key: k, day: s.day, sessions: [] });
    b.sessions.push(s);
  }
  for (const b of out) {
    const ss = b.sessions;
    b.lead = ss[0];
    b.n = ss[0].n;
    b.multi = ss.length > 1;
    b.name = b.multi ? blockName(ss[0].name) : ss[0].name;
    b.label = ss.map((x) => x.label).find(Boolean) || '';
    const st = ss.map((x) => clockMin(x.start || '')).filter((x) => x != null), fi = ss.map((x) => clockMin(x.finish || '')).filter((x) => x != null);
    b.start = st.length ? minClock(Math.min(...st)) : ss[0].start;
    b.finish = fi.length ? minClock(Math.max(...fi)) : ss[0].finish;
    b.warmup = (ss.find((x) => x.warmup) || {}).warmup || null;
    b.nsea = ss.some((x) => x.nsea !== false);
    b.note = ss.map((x) => x.note).filter(Boolean)[0] || '';
  }
  return out;
}
export const blockOf = (sessions, n) => blocksOf(sessions).find((b) => b.sessions.some((s) => s.n === n)) || null;
export const poolName = (s) => s.pool ? (poolOf(s.name) || s.pool) : '';

// One block's events from every pool, in time order; each item carries its pool.
export function blockFlow(pkg, block, rows) {
  const items = [];
  for (const s of block.sessions) for (const it of sessionFlow(pkg, s, rows.filter((r) => r.session === s.n))) items.push({ ...it, session: s.n, pool: block.multi ? poolName(s) : '' });
  if (block.multi) items.sort((a, b) => (a.startMin ?? 1e4) - (b.startMin ?? 1e4) || a.num - b.num);
  return items;
}
// What's on now (or next) in each pool: the latest event that has started, else the first one.
export function nowInPools(items, now) {
  const by = new Map();
  for (const it of items) { if (it.startMin == null) continue; (by.get(it.pool) || by.set(it.pool, []).get(it.pool)).push(it); }
  return [...by.entries()].map(([pool, list]) => {
    const on = list.filter((x) => x.startMin <= now + 2 && (x.endMin == null || now < x.endMin)).pop();
    const next = list.find((x) => x.startMin > now);
    if (!on && !next && list[list.length - 1].endMin != null && now >= list[list.length - 1].endMin) return null;
    return { pool, item: on || next, live: !!on };
  }).filter(Boolean);
}

// ---------- session event flow ----------
// Every event in the session, in order, with our swims grouped by heat. Events with none of our swimmers
// are kept (rows: []), with the heat count and an approximate start / end where known.
export function sessionFlow(pkg, session, rows) {
  const once = (num) => (pkg.sessions || []).filter((x) => (x.events || []).some((e) => e.num === num)).length <= 1;
  const items = [];
  const used = new Set();
  const mk = (num, round, se) => {
    const mine = rows.filter((r) => r.event === num && (r.round || 'Finals') === (round || 'Finals'));
    mine.forEach((r) => used.add(r.id));
    const ev = pkg.events[num] || {};
    const fb = once(num) ? ev : {};
    const heatStarts = (se && se.heatStarts && se.heatStarts.length ? se.heatStarts : fb.heatStarts) || [];
    const heats = (se && se.heats) || Math.max(0, ...mine.map((r) => r.heats || 0)) || fb.heatCount || heatStarts.length || null;
    const rowStart = mine.map((r) => r.startMin).filter((x) => x != null).sort((a, b) => a - b)[0];
    const startMin = clockMin(heatStarts[0] || '') ?? clockMin((se && se.start) || '') ?? rowStart ?? null;
    const byHeat = new Map();
    for (const r of mine) { const k = r.heat ?? 0; (byHeat.get(k) || byHeat.set(k, []).get(k)).push(r); }
    const heatGroups = [...byHeat.entries()].sort((a, b) => (a[0] || 999) - (b[0] || 999)).map(([h, rs]) => {
      rs.sort((a, b) => (a.lane ?? 99) - (b.lane ?? 99));
      const st = (h && heatStarts[h - 1]) || rs.map((r) => r.start).find(Boolean) || null;
      return { heat: h || null, of: heats || rs.find((r) => r.heats)?.heats || null, start: st, rows: rs };
    });
    return { num, round: round || 'Finals', ev, rows: mine, heats, heatStarts, startMin, heatGroups };
  };
  for (const se of session.events || []) items.push(mk(se.num, se.round, se));
  for (const r of rows) if (!used.has(r.id)) items.push(mk(r.event, r.round, null));
  const fin = clockMin(session.finish || '');
  items.forEach((it, i) => {
    const next = items.slice(i + 1).map((x) => x.startMin).find((x) => x != null && it.startMin != null && x >= it.startMin);
    it.endMin = it.startMin == null ? null : next ?? (fin != null && fin > it.startMin ? fin : null);
    it.start = it.startMin != null ? minClock(it.startMin) : null;
    it.end = it.endMin != null ? minClock(it.endMin) : null;
    it.minutes = it.endMin != null ? it.endMin - it.startMin : null;
    // No heat start times on the sheet (common in prelim programs): spread the event's time over its heats.
    if (it.minutes > 0 && it.heats) for (const h of it.heatGroups) if (!h.start && h.heat) { h.start = minClock(it.startMin + Math.round(((h.heat - 1) * it.minutes) / it.heats)); h.est = true; }
  });
  return items;
}

// General (not per-swim) coach notes that apply to a session: the session's own, its day's and the meet's.
export function notesFor(model, session) {
  const g = model.gnotes || [];
  if (!session) return { meet: g.filter((n) => n.scope === 'meet'), day: [], session: [] };
  return { meet: g.filter((n) => n.scope === 'meet'), day: g.filter((n) => n.scope === 'day' && n.key === session.day), session: g.filter((n) => n.scope === 'session' && n.key === session.n) };
}

// ---------- session summary ----------
export function sessionSummary(model, session) {
  const set = new Set([].concat(session));
  const rows = model.rows.filter((r) => set.has(r.session) && !r.scratched);
  const swum = rows.filter((r) => r.result && (r.result.time != null || r.result.status !== 'OK'));
  const timed = swum.filter((r) => r.result.time != null && !r.relay);
  const best = timed.filter((r) => r.best);
  const drop = best.filter((r) => r.entryTime != null).reduce((n, r) => n + (r.entryTime - r.result.time), 0);
  const ach = (kind) => timed.flatMap((r) => r.post.filter((f) => f.kind === kind && f.tier === 'hit' && !f.open).map((f) => ({ r, f })));
  const close = timed.flatMap((r) => r.pre.filter((f) => (f.tier === '1' || f.tier === 'under') && !f.open && !f.improve && !r.post.some((p) => p.label === f.label)).map((f) => ({ r, f, miss: r.result.time - f.target })))
    .filter((x) => x.miss > 0 && x.miss <= x.f.target * 0.01);
  const dq = swum.filter((r) => r.result.status && r.result.status !== 'OK');
  const relays = rows.filter((r) => r.relay);
  const swimmers = [...new Set(rows.filter((r) => !r.relay).map((r) => r.swimmerId))].map((id) => {
    const mine = rows.filter((r) => r.swimmerId === id);
    return { swimmer: model.swimmers.get(id), rows: mine, best: mine.filter((r) => r.best).length };
  }).sort((a, b) => a.swimmer.name.localeCompare(b.swimmer.name));
  return {
    entries: rows.length, swum: swum.length, timed: timed.length, best: best.length, drop,
    pctBest: timed.length ? Math.round((best.length / timed.length) * 100) : 0,
    records: ach('record'), top10: ach('top10'), cuts: ach('cut'), close, dq, swimmers, relays,
    dqNoReason: dq.filter((r) => r.result.status === 'DQ' && !r.dq), starred: rows.filter((r) => r.starred),
    notes: rows.flatMap((r) => r.notes.map((n) => ({ r, n }))),
    official: rows.length > 0 && rows.every((r) => r.official),
    pending: rows.filter((r) => !r.result).length,
  };
}

// ---------- meet wrap-up ----------
// Whole meet: each swimmer/event counted once (the faster of prelims and finals) for best times and drops.
export function meetSummary(model) {
  const rows = model.rows.filter((r) => !r.scratched);
  const swum = rows.filter((r) => r.result && (r.result.time != null || r.result.status !== 'OK'));
  const timed = swum.filter((r) => r.result.time != null && !r.relay);
  const byEv = new Map();
  for (const r of timed) { const k = `${r.swimmerId}|${r.event}`, o = byEv.get(k); if (!o || r.result.time < o.result.time) byEv.set(k, r); }
  const fastest = [...byEv.values()];
  const best = fastest.filter((r) => r.best);
  const drop = best.filter((r) => r.entryTime != null).reduce((n, r) => n + (r.entryTime - r.result.time), 0);
  const ach = (kind) => {
    const seen = new Map();
    for (const r of timed) for (const f of r.post) if (f.kind === kind && f.tier === 'hit' && !f.open) {
      const k = `${r.swimmerId}|${r.event}|${f.label}`, o = seen.get(k);
      if (!o || r.result.time < o.r.result.time) seen.set(k, { r, f });
    }
    return [...seen.values()];
  };
  const dq = swum.filter((r) => r.result.status && r.result.status !== 'OK');
  const swimNotes = rows.flatMap((r) => r.notes.map((n) => ({ r, n })));
  const all = [...swimNotes, ...(model.gnotes || []).map((n) => ({ r: null, n }))];
  const byTag = new Map();
  for (const x of all) for (const t of (x.n.tags && x.n.tags.length ? x.n.tags : [''])) (byTag.get(t) || byTag.set(t, []).get(t)).push(x);
  const tags = [...byTag.entries()].filter(([t]) => t).sort((a, b) => b[1].length - a[1].length).map(([tag, list]) => ({ tag, list }));
  return {
    entries: rows.length, swum: swum.length, events: fastest.length, best: best.length, drop,
    pctBest: fastest.length ? Math.round((best.length / fastest.length) * 100) : 0,
    swimmers: new Set(rows.filter((r) => !r.relay).map((r) => r.swimmerId)).size,
    records: ach('record'), top10: ach('top10'), cuts: ach('cut'), dq, dqNoReason: dq.filter((r) => r.result.status === 'DQ' && !r.dq),
    starred: rows.filter((r) => r.starred), tags, untagged: byTag.get('') || [], swimNotes,
    official: rows.length > 0 && rows.every((r) => r.official),
  };
}

// Time typed on a phone keypad: "5912" -> 59.12, "21533" -> 2:15.33, "1:02.4" -> 1:02.40
export function parseTyped(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  if (/^\d{1,2}:\d{1,2}(\.\d{1,2})?$/.test(t) || /^\d{1,2}\.\d{1,2}$/.test(t)) {
    const [a, b] = t.includes(':') ? t.split(':') : ['0', t];
    const [sec, frac = '0'] = b.split('.');
    return (+a * 60 + +sec) * 100 + +frac.padEnd(2, '0').slice(0, 2);
  }
  if (/^\d{3,6}$/.test(t)) {
    const cs = +t.slice(-2), rest = t.slice(0, -2);
    const sec = +rest.slice(-2), min = +(rest.slice(0, -2) || 0);
    if (sec >= 60) return null;
    return (min * 60 + sec) * 100 + cs;
  }
  return null;
}

// Which event is on now (or next), from heat start times.
export function nowEvent(rows, nowMin) {
  const timed = rows.filter((r) => r.startMin != null && !r.scratched);
  if (!timed.length) return null;
  const next = timed.filter((r) => r.startMin >= nowMin - 3).sort((a, b) => a.startMin - b.startMin)[0];
  return (next || timed[timed.length - 1]).event;
}

// Meet Mobile notification forwarded from a coach's Android phone (MacroDroid -> /api/meetday/notify).
// Matched to the swimmer's entry for that event; with prelims and finals of the same event, the session
// running when the notification arrived wins, else the first one with no time yet. Never overrides a
// time a coach typed or an official result.
function localNow(at, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  } catch { return null; }
}
export function applyNotify(pkg, sessions, entries, swimmers, results, d, o = {}) {
  const n = parseMmNotify(d.text);
  const base = { text: d.text, at: o.at, op: o.id };
  if (!n) return { ...base, status: 'unread' };
  const sw = [...swimmers.values()].filter((x) => sameSwimmer(x.name, n.name));
  const cands = [...entries.values()].filter((e) => e.event === n.event && sw.some((x) => x.id === e.swimmerId));
  if (!cands.length) return { ...base, ...n, status: sw.length ? 'no-entry' : 'not-ours' };
  let pick = cands[0];
  if (cands.length > 1) {
    const now = o.at && localNow(o.at, pkg.tz || 'America/New_York');
    // The session that most recently started (or starts within 45 min) on that day, if not long over.
    const live = now && cands.map((e) => { const s = sessions.find((x) => x.n === e.session); const a = s && s.day === now.day ? clockMin(s.start || '') : null, b = s ? clockMin(s.finish || '') : null; return { e, a, ok: a != null && now.min >= a - 45 && (b == null || now.min <= b + 90) }; })
      .filter((x) => x.ok).sort((x, y) => y.a - x.a)[0]?.e;
    pick = live || cands.find((e) => !results.has(e.id)) || cands[cands.length - 1];
  }
  const prev = results.get(pick.id);
  if (prev && prev.source !== 'mm-notify' && (prev.source === 'manual' || prev.official)) return { ...base, ...n, entry: pick.id, status: 'kept' };
  results.set(pick.id, { entry: pick.id, time: n.time, status: n.status, source: 'mm-notify', official: n.official, by: 'Meet Mobile', at: o.at, op: o.id });
  return { ...base, ...n, entry: pick.id, status: 'matched' };
}
