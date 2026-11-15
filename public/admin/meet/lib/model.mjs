// Meet Day model: package + ops -> what the screens show. Pure functions (tested in test/meetday.test.mjs).
import { flagsFor, DEFAULT_CUTS } from './flags.mjs';
import { sameSwimmer, clockMin, minClock, parseMmNotify } from './parse.mjs';

export const entryKey = (event, round, swimmerId) => `${event}-${String(round || 'F')[0]}${/2$/.test(round || '') ? '2' : ''}-${swimmerId}`;

export function derive(pkg, ops, settings = {}) {
  const cuts = settings.cuts || DEFAULT_CUTS;
  const swimmers = new Map(pkg.swimmers.map((s) => [s.id, { ...s }]));
  const entries = new Map(pkg.entries.map((e) => [e.id, { ...e }]));
  const sorted = [...ops].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : String(a.id).localeCompare(String(b.id))));
  const undone = new Set(sorted.filter((o) => o.type === 'undo').map((o) => o.data && o.data.op));
  const results = new Map(), notes = new Map(), scratch = new Map(), official = new Map(), sources = [];
  const notices = []; let notifyKey = null;
  const sessions = pkg.sessions.map((x) => ({ ...x, warmup: x.warmup ? { ...x.warmup } : x.warmup, events: (x.events || []).map((e) => ({ ...e })) }));

  for (const o of sorted) {
    if (undone.has(o.id) || o.type === 'undo') continue;
    const d = o.data || {};
    if (o.type === 'entries') applyEntries(entries, swimmers, d);
    else if (o.type === 'result') results.set(d.entry, { ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'note') (notes.get(d.entry) || notes.set(d.entry, []).get(d.entry)).push({ ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'scratch') scratch.set(d.entry, !!d.on);
    else if (o.type === 'official') official.set(d.session, { on: !!d.on, by: o.by, at: o.at });
    else if (o.type === 'source') sources.push({ ...d, at: o.at, by: o.by });
    else if (o.type === 'times') applyTimes(sessions, entries, d, o);
    else if (o.type === 'notifykey') notifyKey = d.key || null;
    else if (o.type === 'mmnotify') notices.push(applyNotify(pkg, sessions, entries, swimmers, results, d, o));
  }

  const rows = [];
  for (const e of entries.values()) {
    const s = swimmers.get(e.swimmerId);
    const ev = pkg.events[e.event] || {};
    if (!s) continue;
    const r = results.get(e.id) || null;
    const off = official.get(e.session);
    const swim = { sex: s.sex, age: s.age, dist: ev.dist, stroke: ev.stroke, name: s.name, seed: e.seed };
    const pre = flagsFor(swim, pkg.refs, { cuts });
    const post = r && r.time != null ? flagsFor({ ...swim, time: r.time }, pkg.refs, { cuts }) : [];
    rows.push({
      ...e, swimmer: s, ev, result: r, notes: notes.get(e.id) || [], scratched: !!scratch.get(e.id),
      official: !!(off && off.on) || !!(r && r.official), pre, post,
      delta: r && r.time != null && e.seed != null ? r.time - e.seed : null,
      startMin: clockMin(e.start || ''),
    });
  }
  rows.sort((a, b) => (a.session ?? 99) - (b.session ?? 99) || order(pkg, a) - order(pkg, b) || (a.heat ?? 99) - (b.heat ?? 99) || (a.lane ?? 99) - (b.lane ?? 99));
  return { rows, swimmers, official, sources, results, sessions, notices, notifyKey };
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
    for (const e of s.events || []) if (e.start) e.start = shiftClock(e.start, m);
    if (s.warmup && !d.warmup) s.warmup.time = shiftText(s.warmup.time, m);
    if (s.warmup && !d.sprints && s.warmup.sprints) s.warmup.sprints = shiftText(s.warmup.sprints, m);
    for (const e of entries.values()) if (e.session === d.session && e.start) e.start = shiftClock(e.start, m);
  }
  if (d.start) s.start = minClock(clockMin(d.start));
  if (d.warmup && s.warmup) s.warmup.time = d.warmup;
  if (d.sprints && s.warmup) s.warmup.sprints = d.sprints;
  s.changed = { by: o.by, at: o.at, shift: m };
}

function order(pkg, r) {
  const s = pkg.sessions.find((x) => x.n === r.session);
  const i = s ? s.events.findIndex((e) => e.num === r.event && (e.round || 'Finals') === (r.round || 'Finals')) : -1;
  return i < 0 ? 999 : i;
}

// data: { session, mode: 'replace' | 'merge', rows: [{ event, round, swimmerId?, name, age, sex, heat, heats, lane, seed, start }] }
export function applyEntries(entries, swimmers, d) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const touched = new Set(rows.map((r) => `${r.event}|${r.round}`));
  const keep = new Set();
  for (const r of rows) {
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

// ---------- session summary ----------
export function sessionSummary(model, session) {
  const rows = model.rows.filter((r) => r.session === session && !r.scratched);
  const swum = rows.filter((r) => r.result && (r.result.time != null || r.result.status !== 'OK'));
  const timed = swum.filter((r) => r.result.time != null);
  const best = timed.filter((r) => r.seed == null || r.result.time < r.seed);
  const drop = best.filter((r) => r.seed != null).reduce((n, r) => n + (r.seed - r.result.time), 0);
  const ach = (kind) => timed.flatMap((r) => r.post.filter((f) => f.kind === kind && f.tier === 'hit' && !f.open).map((f) => ({ r, f })));
  const close = timed.flatMap((r) => r.pre.filter((f) => (f.tier === '1' || f.tier === 'under') && !f.open && !f.improve && !r.post.some((p) => p.label === f.label)).map((f) => ({ r, f, miss: r.result.time - f.target })))
    .filter((x) => x.miss > 0 && x.miss <= x.f.target * 0.01);
  const dq = swum.filter((r) => r.result.status && r.result.status !== 'OK');
  const swimmers = [...new Set(rows.map((r) => r.swimmerId))].map((id) => {
    const mine = rows.filter((r) => r.swimmerId === id);
    return { swimmer: model.swimmers.get(id), rows: mine, best: mine.filter((r) => r.result && r.result.time != null && (r.seed == null || r.result.time < r.seed)).length };
  }).sort((a, b) => a.swimmer.name.localeCompare(b.swimmer.name));
  return {
    entries: rows.length, swum: swum.length, timed: timed.length, best: best.length, drop,
    pctBest: timed.length ? Math.round((best.length / timed.length) * 100) : 0,
    records: ach('record'), top10: ach('top10'), cuts: ach('cut'), close, dq, swimmers,
    notes: rows.flatMap((r) => r.notes.map((n) => ({ r, n }))),
    official: rows.length > 0 && rows.every((r) => r.official),
    pending: rows.filter((r) => !r.result).length,
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
