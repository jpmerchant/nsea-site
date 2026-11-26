// Meet Day family view: what one family may see of a meet. Pure (tested in test/meetday-family.test.mjs).
// Built on the server from the same package + ops the coaches use, so nothing private ever reaches a family's phone.
//
// Decisions (JP, Nov 26 2026):
//  * Their own swimmer(s): every swim with heat, lane, seed, estimated start, results and time dropped.
//  * Teammates: names in a team heat/lane list, never their times.
//  * Results show live, labeled unofficial until the session is official.
//  * New cuts show live; team records and Top 10 only once official.
//  * Never: coach notes and tags, stars, coach DQ calls (only the official DQ reason), pre-race "close to a cut" flags,
//    check-in / absence details, admin tools.
import { blocksOf, blockFlow, poolName } from '../public/admin/meet/lib/model.mjs';
import { sameSwimmer } from '../public/admin/meet/lib/parse.mjs';
import { familyInfo } from '../public/admin/meet/lib/familyinfo.mjs';
export { familyInfo, familyViewOn, parseInfoText, infoText } from '../public/admin/meet/lib/familyinfo.mjs';

// The family's swimmers in this meet: by USA Swimming ID, else by name ("First Last" on the roster, "Last, First" in a meet).
export function findSwimmers(pkg, roster) {
  const out = new Set();
  for (const s of pkg.swimmers || []) {
    const hit = roster.find((r) => (r.usa_id && s.usaId && r.usa_id === s.usaId) || (!s.usaId && r.name && sameSwimmer(s.name, r.name)));
    if (hit) out.add(s.id);
  }
  return out;
}

const first = (s) => (s ? `${s.first || ''} ${s.last || ''}`.trim() || s.name : '');

export function familyView(pkg, model, mine, ops = []) {
  const P = { ...pkg, sessions: model.sessions, events: model.events };
  const blocks = blocksOf(model.sessions);
  const swimmerName = (id) => first(model.swimmers.get(id));
  // Estimated heat start (and pool) for every swim, from the same event flow the coaches see.
  const when = new Map();
  for (const B of blocks) for (const it of blockFlow(P, B, model.rows)) for (const h of it.heatGroups) for (const r of h.rows) when.set(r.id, { start: h.start || it.start || null, est: !!h.est || !h.start, pool: it.pool || '', eventStart: it.start || null, of: h.of || it.heats || null });

  const isMine = (r) => (r.relay ? (r.legs || []).some((x) => mine.has(x)) : mine.has(r.swimmerId));
  const sessionOf = new Map(model.sessions.map((s) => [s.n, s]));
  const swims = [], team = [];
  for (const r of model.rows) {
    const s = sessionOf.get(r.session);
    if (!s || s.nsea === false) continue;
    const w = when.get(r.id) || {};
    const base = {
      id: r.id, session: r.session, day: s.day, pool: w.pool || (s.pool ? poolName(s) : ''), event: r.event, title: (r.ev && r.ev.title) || '', round: r.round || 'Finals',
      heat: r.heat ?? null, of: r.heats || w.of || null, lane: r.lane ?? null, start: w.start || null, est: w.start ? w.est : true,
      relay: r.relay || null, legs: r.relay ? (r.legs || []).map((x) => (typeof x === 'number' ? swimmerName(x) : String(x))) : null,
    };
    if (isMine(r)) {
      const res = r.result && !r.scratched ? r.result : null;
      const time = res && res.time != null ? res.time : null;
      const off = !!r.official;
      const hits = time != null ? (r.post || []).filter((f) => f.tier === 'hit') : [];
      swims.push({
        ...base, swimmer: r.relay ? null : r.swimmerId, name: r.relay ? `${pkg.teamName || 'NSEA'} ${r.relay} relay` : swimmerName(r.swimmerId),
        seed: r.seed ?? null, entryTime: r.entryTime ?? null, scratched: !!r.scratched,
        result: res ? { time, status: res.status || null, official: off } : null,
        dEntry: off || time != null ? r.dEntry ?? null : null, best: !!r.best, isFinal: !!r.isFinal, prelim: r.prelim || null, dPrelim: r.dPrelim ?? null,
        cuts: hits.filter((f) => f.kind === 'cut').map((f) => ({ label: f.label, sub: f.sub })),
        honors: off ? hits.filter((f) => f.kind === 'record' || f.kind === 'top10').map((f) => ({ kind: f.kind, label: f.label, sub: f.kind === 'top10' ? f.sub : '' })) : [],
        dqWhy: res && res.status === 'DQ' && r.dqOfficial ? r.dqOfficial.desc : null,
      });
    }
    if (!r.scratched) team.push({ ...base, name: r.relay ? `${pkg.teamName || 'NSEA'} ${r.relay} relay` : swimmerName(r.swimmerId), mine: isMine(r) });
  }
  const days = [];
  for (const B of blocks) {
    if (!B.nsea) continue;
    let d = days.find((x) => x.day === B.day);
    if (!d) days.push(d = { day: B.day, blocks: [] });
    d.blocks.push({
      n: B.n, name: B.name, label: B.label || '', start: B.start || null, finish: B.finish || null,
      warmup: B.warmup ? { group: B.warmup.group || '', time: B.warmup.time || '', pool: B.warmup.pool || '', lanes: B.warmup.lanes || '' } : null,
      pools: B.sessions.map((s) => ({ n: s.n, pool: B.multi ? poolName(s) : '', start: s.start || null, finish: s.finish || null, official: !!(model.official.get(s.n) || {}).on })),
    });
  }
  return {
    meet: { id: pkg.id, name: pkg.name, short: pkg.short || pkg.name, venue: pkg.venue || '', host: pkg.host || '', start: pkg.start, end: pkg.end, course: pkg.course || 'SCY', team: pkg.teamName || 'NSEA' },
    info: familyInfo(pkg, ops),
    swimmers: [...mine].map((id) => model.swimmers.get(id)).filter(Boolean).map((s) => ({ id: s.id, name: first(s), age: s.age ?? null })),
    days, swims, team,
  };
}
