// Meet Day model: package + ops -> what the screens show. Pure functions (tested in test/meetday.test.mjs).
import { flagsFor, DEFAULT_CUTS } from './flags.mjs';
import { sameSwimmer, clockMin } from './parse.mjs';

export const entryKey = (event, round, swimmerId) => `${event}-${String(round || 'F')[0]}${/2$/.test(round || '') ? '2' : ''}-${swimmerId}`;

export function derive(pkg, ops, settings = {}) {
  const cuts = settings.cuts || DEFAULT_CUTS;
  const swimmers = new Map(pkg.swimmers.map((s) => [s.id, { ...s }]));
  const entries = new Map(pkg.entries.map((e) => [e.id, { ...e }]));
  const sorted = [...ops].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : String(a.id).localeCompare(String(b.id))));
  const undone = new Set(sorted.filter((o) => o.type === 'undo').map((o) => o.data && o.data.op));
  const results = new Map(), notes = new Map(), scratch = new Map(), official = new Map(), sources = [];

  for (const o of sorted) {
    if (undone.has(o.id) || o.type === 'undo') continue;
    const d = o.data || {};
    if (o.type === 'entries') applyEntries(entries, swimmers, d);
    else if (o.type === 'result') results.set(d.entry, { ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'note') (notes.get(d.entry) || notes.set(d.entry, []).get(d.entry)).push({ ...d, by: o.by, at: o.at, op: o.id });
    else if (o.type === 'scratch') scratch.set(d.entry, !!d.on);
    else if (o.type === 'official') official.set(d.session, { on: !!d.on, by: o.by, at: o.at });
    else if (o.type === 'source') sources.push({ ...d, at: o.at, by: o.by });
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
  return { rows, swimmers, official, sources, results };
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
