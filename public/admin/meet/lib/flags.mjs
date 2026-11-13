// Meet Day flag engine: which swims could set a team record, make a Top 10 board, or earn a championship cut.
// Tiers (before the race, from the seed): 'under' = seed already faster than the target, '1' = within 1%, '3' = within 3%.
// After a result: 'hit' = the swim got there (shown as UNOFFICIAL until official results are loaded).
import { sameSwimmer, fmt } from './parse.mjs';

export const DEFAULT_CUTS = ['NC AG', 'NC Senior', 'Futures 18&U', 'Winter Jrs 18&U', 'Sectionals (max)'];
export const ev = (dist, stroke) => `${dist} ${stroke}`;

export function recordGroup(age) { return age <= 10 ? '10 & U' : age <= 12 ? '11-12' : age <= 14 ? '13-14' : age <= 16 ? '15-16' : age <= 18 ? '17-18' : null; }
export function top10Group(age) { return age <= 10 ? '10 & Under' : age <= 12 ? '11-12' : age <= 14 ? '13-14' : age <= 16 ? '15-16' : age <= 18 ? '17-18' : null; }
export function cutGroup(age) { return age <= 10 ? '10&U' : age <= 12 ? '11-12' : age <= 14 ? '13-14' : age <= 16 ? '15-16' : age <= 18 ? '17-18' : 'Open'; }

function tier(seed, target) {
  if (seed == null || target == null) return null;
  if (seed <= target) return 'under';
  if (seed <= target * 1.01) return '1';
  if (seed <= target * 1.03) return '3';
  return null;
}
const pct = (seed, target) => seed == null || target == null ? null : Math.round(((seed - target) / target) * 1000) / 10;

// swim: { sex: 'F'|'M', age, dist, stroke, name, seed (cs|null), time (cs|null) }
// refs: built by scripts/meetday/build-meet.mjs ({ records, top10, cuts })
export function flagsFor(swim, refs, opts = {}) {
  const cuts = opts.cuts || DEFAULT_CUTS;
  const out = [];
  const e = ev(swim.dist, swim.stroke);
  const sx = swim.sex;
  const t = swim.time;
  const push = (f) => {
    const hit = t != null && f.target != null && t <= f.target;
    if (t != null) { if (hit) out.push({ ...f, tier: 'hit', gap: t - f.target }); }
    else if (f.tier) out.push(f);
  };

  // Team records: own age group + Open
  for (const g of [recordGroup(swim.age), 'Open'].filter(Boolean)) {
    const r = refs.records?.[sx]?.[g]?.[e];
    if (!r) continue;
    if (r.cs == null) { push({ kind: 'record', label: `Team record ${g}`, sub: 'no record yet', target: Infinity, tier: 'under', open: true }); continue; }
    push({ kind: 'record', label: `Team record ${g}`, sub: `${fmt(r.cs)} ${r.holder || ''}`.trim(), target: r.cs, tier: tier(swim.seed, r.cs), pct: pct(swim.seed, r.cs) });
  }

  // Top 10 performers: own age group + 18 & Under
  for (const g of [top10Group(swim.age), swim.age <= 18 ? '18 & Under' : null].filter(Boolean)) {
    const b = refs.top10?.[sx]?.[g]?.[e];
    if (!b) continue;
    const mine = b.list.findIndex((x) => sameSwimmer(x.n, swim.name));
    if (mine >= 0) {
      // Already on the board: flag only a move up (beat own board time)
      const own = b.list[mine].cs;
      if (t != null && t < own) {
        const newRank = b.list.filter((x, i) => i !== mine && x.cs <= t).length + 1;
        out.push({ kind: 'top10', label: `Top 10 ${g}`, sub: `moves #${mine + 1} → #${newRank}`, target: own, tier: 'hit', gap: t - own, improve: true });
      } else if (t == null && swim.seed != null && swim.seed < own) {
        out.push({ kind: 'top10', label: `Top 10 ${g}`, sub: `on board #${mine + 1} (${fmt(own)}); seed faster`, target: own, tier: 'under', improve: true });
      }
      continue;
    }
    if (b.list.length < 10) { push({ kind: 'top10', label: `Top 10 ${g}`, sub: `open spot (${b.list.length} on board)`, target: Infinity, tier: 'under', open: true }); continue; }
    const tenth = b.list[9].cs;
    push({ kind: 'top10', label: `Top 10 ${g}`, sub: `10th ${fmt(tenth)}`, target: tenth, tier: tier(swim.seed, tenth), pct: pct(swim.seed, tenth) });
  }

  // Championship cuts: only the ones the swimmer does not already have (seed slower than the cut)
  const cg = cutGroup(swim.age);
  for (const c of refs.cuts?.[sx]?.[cg]?.[e] || []) {
    if (!cuts.includes(c.name)) continue;
    if (swim.seed != null && swim.seed <= c.cs) continue; // already has it
    const tr = tier(swim.seed, c.cs);
    push({ kind: 'cut', label: c.name, sub: fmt(c.cs), target: c.cs, tier: tr === 'under' ? null : tr, pct: pct(swim.seed, c.cs), seedless: swim.seed == null });
  }
  return out.sort((a, b) => rank(a) - rank(b));
}
const KIND = { record: 0, top10: 1, cut: 2 };
const TIER = { hit: 0, under: 1, '1': 2, '3': 3 };
const rank = (f) => TIER[f.tier] * 10 + KIND[f.kind] + (f.open ? 5 : 0) + (f.improve ? 3 : 0);

// Best (most important) flag tier for a swim, for colouring the row.
export function topTier(flags) { return flags.length ? flags[0].tier : null; }
