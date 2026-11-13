// Compact reference data for flags: team records, Top 10 performer boards and time standards.
// Inputs are the live board JSON (nsea-swim-boards/data/*.json, the gold standard) and standards.json.
import { toCs } from './parse.mjs';

const SX = { Female: 'F', Male: 'M', W: 'F', M: 'M' };
const STD_STROKE = { FR: 'Free', BK: 'Back', BR: 'Breast', FL: 'Fly', IM: 'IM' };

export function buildRefs({ records, top10, standards, sexes, events }) {
  const keep = (sx, e) => (!sexes || sexes.has(sx)) && (!events || events.has(e));
  const refs = { records: {}, top10: {}, cuts: {}, cutNames: [], asOf: { records: records?.season_label || null, top10: top10?.season_label || null } };

  for (const [g, gd] of Object.entries(records?.genders || {})) {
    const sx = SX[g];
    for (const ag of gd.ageGroups || []) for (const r of ag.events || []) {
      if (!keep(sx, r.event)) continue;
      ((refs.records[sx] ||= {})[ag.age] ||= {})[r.event] = r.noRecord ? { cs: null } : { cs: toCs(r.time), holder: r.holder || '', date: r.date || '' };
    }
  }
  for (const [ag, bySex] of Object.entries(top10?.data || {})) for (const [g, byEv] of Object.entries(bySex)) {
    const sx = SX[g];
    for (const [e, list] of Object.entries(byEv)) {
      if (!keep(sx, e)) continue;
      ((refs.top10[sx] ||= {})[ag] ||= {})[e] = { list: list.slice(0, 10).map((x) => ({ n: `${x.last}, ${x.first}`, cs: toCs(x.time) })) };
    }
  }
  const names = new Set();
  for (const [g, groups] of Object.entries(standards || {})) {
    const sx = SX[g];
    for (const [ag, byEv] of Object.entries(groups)) for (const [k, rows] of Object.entries(byEv)) {
      const [d, s] = k.split(' ');
      const e = `${d} ${STD_STROKE[s] || s}`;
      if (!keep(sx, e)) continue;
      const cuts = rows.filter((r) => r[2] !== 'rec').map((r) => ({ name: r[0], cs: toCs(r[1]), color: r[2] })).filter((r) => r.cs != null);
      cuts.forEach((c) => names.add(c.name));
      ((refs.cuts[sx] ||= {})[ag] ||= {})[e] = cuts.sort((a, b) => a.cs - b.cs);
    }
  }
  refs.cutNames = [...names];
  return refs;
}
