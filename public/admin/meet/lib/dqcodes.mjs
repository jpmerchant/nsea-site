// USA Swimming disqualification codes, as on the July 2019 DQ slip and in Meet Manager's USA DQ code file
// (dqcodesUSA.txt). `code` is the Meet Manager code, `slip` the infraction number on the DQ slip.
// A DQ is stored with the code AND its description, so a saved call reads the same even if this list changes.
const T = (stroke, rows) => rows.map(([code, slip, desc, alias]) => ({ code, slip, desc, stroke, alias: alias || [] }));

export const DQ_CODES = [
  ...T('Fly', [
    ['1A', '20', 'Alternating kick'], ['1B', '20', 'Breaststroke kick', ['kick breaststroke type']], ['1C', '20', 'Scissors kick'],
    ['1D', '21', 'Non-simultaneous arms'], ['1E', '21', 'Underwater recovery', ['arms underwater recovery', 'arms not over water']],
    ['1F', '23', 'One hand touch'], ['1G', '23', 'Non-simultaneous touch'],
    ['1H', '24', 'Shoulders not at or past vertical toward breast off the wall', ['not on breast off wall']],
    ['1I', '25', 'Head did not break the surface by 15 meters', ['past 15 m']],
    ['1J', '29', 'Completely submerged during the swim'], ['1K', '29', 'Completely submerged prior to turn or finish'],
    ['1S', '29', 'Hands not separated at touch'],
  ]),
  ...T('Back', [
    ['2A', '30', 'Toes curled over gutter after the start'], ['2B', '31', 'Head did not break the surface by 15 meters', ['past 15 m']],
    ['2C', '32', 'Shoulders not at or past vertical toward back off the wall', ['not on back off wall', 'not on back off the wall']],
    ['2D', '33', 'No touch at turn', ['no touch on turn']], ['2E', '34', 'Delay initiating arm pull'], ['2F', '34', 'Delay initiating turn', ['non-continuous turn', 'delay initiating turn after past vertical']],
    ['2G', '34', 'Multiple strokes', ['multiple strokes past vertical at turn']], ['2H', '35', 'Shoulders past vertical toward breast during swim', ['shoulders past vertical toward breast', 'shoulders past vertical']],
    ['2I', '36', 'Shoulders past vertical at finish', ['finish not on back']],
    ['2J', '39', 'Completely submerged during the swim'], ['2K', '39', 'Completely submerged prior to turn or finish'],
  ]),
  ...T('Breast', [
    ['3A', '10', 'Alternating kick'], ['3B', '10', 'Downward butterfly kick', ['downward fly kick']], ['3C', '10', 'Scissors kick'],
    ['3D', '11', 'Non-simultaneous arms'], ['3E', '11', 'Two strokes underwater', ['two strokes under water']],
    ['3F', '11', 'Arms not in same horizontal plane'], ['3G', '11', 'Hands beyond the hipline during stroke', ['hands brought beyond the hipline during stroke', 'hands past hips']],
    ['3H', '12', 'Elbows recovered over the water'],
    ['3I', '14', 'Head not up during cycle of pull and kick', ['head not up each cycle', 'incomplete stroke cycle other than one pull followed by one kick', 'incomplete stroke cycle', 'head under for 2 or more strokes']],
    ['3J', '14', 'Double pulls or kicks', ['double pull', 'double kick']],
    ['3K', '15', 'One hand touch'], ['3L', '15', 'Non-simultaneous touch'],
    ['3M', '16', 'Shoulders not at or past vertical toward breast off the wall', ['not on breast off wall']],
    ['3N', '19', 'Multiple butterfly kicks on pull out', ['multiple fly kicks']], ['3O', '19', 'Non-simultaneous kick'],
    ['3P', '19', 'Fly kick prior to pull'], ['3Q', '19', 'Legs not in the same horizontal plane'],
    ['3R', '19', 'Feet not pointed outward during propulsive part of kick'], ['3S', '19', 'Hands not separated at touch'],
  ]),
  ...T('IM', [['5P', '42', 'Strokes out of sequence', ['out of order', 'strokes out of order']]]),
  ...T('Free', [
    ['4K', '50', 'No touch on turn', ['no touch at turn']], ['4N', '51', 'Head did not break the surface by 15 meters', ['past 15 m']],
    ['4M', '52', 'Completely submerged during the swim'], ['4O', '52', 'Completely submerged prior to turn or finish'],
  ]),
  ...T('Misc', [
    ['7A', '60', 'False start'], ['7B', '61', 'Delay of meet'], ['7C', '62', 'Did not finish'], ['7D', '63', 'Declared false start'],
    ['7E', '69', 'Entered water without permission'], ['7F', '69', 'Interfered with another swimmer'],
    ['7G', '69', 'Walking on or springing from bottom', ['walked on the bottom']], ['7H', '69', 'Standing on bottom'],
    ['7I', '69', 'Pulling on lane line', ['pulled on the lane line']], ['7J', '69', 'Finished in wrong lane'],
    ['7K', '69', 'Unsportsmanlike conduct'], ['7L', '69', 'No show prelim event'], ['7M', '69', 'No show final event'],
  ]),
  ...T('Relay', [
    ['61', '70', 'Stroke infraction swimmer #1'], ['62', '70', 'Stroke infraction swimmer #2'],
    ['63', '70', 'Stroke infraction swimmer #3'], ['64', '70', 'Stroke infraction swimmer #4'],
    ['66', '71', 'Early take-off swimmer #2', ['early takeoff']], ['67', '71', 'Early take-off swimmer #3'], ['68', '71', 'Early take-off swimmer #4'],
    ['6P', '72', 'Changed order of swimmers', ['out of order']], ['6Q', '79', 'Not enough swimmers'], ['6R', '79', 'Ineligible swimmer(s)'],
  ]),
];
export const DQ_BY_CODE = new Map(DQ_CODES.map((c) => [c.code, c]));
export const DQ_GROUP_NAMES = { Fly: 'Butterfly', Back: 'Backstroke', Breast: 'Breaststroke', Free: 'Freestyle', IM: 'IM', Relay: 'Relay', Misc: 'Start, finish & general' };

export const strokeKey = (s) => { const st = String(s || ''); return /IM|Medley/i.test(st) ? 'IM' : /Back/i.test(st) ? 'Back' : /Breast/i.test(st) ? 'Breast' : /Fly|Butter/i.test(st) ? 'Fly' : 'Free'; };

// The groups of codes to offer for a swim, most likely first. IM and medley relays get every stroke
// in IM order; Misc (false start, DNF, lane line…) comes last.
export function dqGroups(stroke, relay = false) {
  const k = strokeKey(stroke);
  const strokes = k === 'IM' ? (relay ? ['Back', 'Breast', 'Fly', 'Free'] : ['Fly', 'Back', 'Breast', 'Free']) : [k];
  const keys = [...(relay ? ['Relay'] : []), ...(k === 'IM' && !relay ? ['IM'] : []), ...strokes, 'Misc'];
  return keys.map((g) => ({ group: g, name: DQ_GROUP_NAMES[g], codes: DQ_CODES.filter((c) => c.stroke === g) }));
}

// One call as it's stored: { code, slip, desc }. `label` is how it reads on screen and in summaries.
export const dqCall = (c) => ({ code: c.code, slip: c.slip, desc: c.desc });
export const dqCallLabel = (c) => (c.code ? `${c.code} ${c.desc}` : c.desc);

const norm = (s) => String(s || '').toLowerCase().replace(/\s+-\s+(fly|back|breast|free|im|ly)\s*$/, '').replace(/[^a-z0-9#]+/g, ' ').trim();
const toks = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !['the', 'of', 'at', 'or', 'to', 'on', 'during', 'by'].includes(w)));
// Match a written reason ("Shoulders past vertical toward breast - back", an older label like "Hands past hips")
// to a code. The event's stroke breaks ties (scissors kick is 3C in breast, 1C in fly). Null when unsure.
export function matchDq(text, stroke = '', relay = false) {
  const n = norm(text);
  if (!n) return null;
  const tail = String(text).match(/-\s*(fly|ly|back|breast|free)\s*$/i);
  const sk = tail ? strokeKey(tail[1] === 'ly' ? 'fly' : tail[1]) : strokeKey(stroke);
  const pref = new Set([...dqGroups(sk === 'IM' ? 'IM' : sk, relay).map((g) => g.group), ...(strokeKey(stroke) === 'IM' ? ['IM'] : [])]);
  const T1 = toks(text);
  let best = null, bestScore = 0;
  for (const c of DQ_CODES) {
    for (const d of [c.desc, ...c.alias]) {
      let s;
      if (norm(d) === n) s = 10;
      else { const T2 = toks(d); const hit = [...T1].filter((w) => T2.has(w)).length; s = hit / Math.max(T1.size, T2.size); }
      if (pref.has(c.stroke)) s += 0.25;
      if (s > bestScore) { bestScore = s; best = c; }
    }
  }
  return bestScore >= 0.85 ? best : null;
}

// Normalize a stored DQ record (new `calls`, or the older label-only `codes`) to a list of calls.
export function dqCalls(q, stroke = '', relay = false) {
  if (!q) return [];
  if (Array.isArray(q.calls) && q.calls.length) return q.calls.map((c) => ({ code: c.code || '', slip: c.slip || '', desc: c.desc || '' }));
  return (q.codes || []).map((x) => {
    const byCode = DQ_BY_CODE.get(String(x).toUpperCase());
    const c = byCode || matchDq(x, stroke, relay);
    return c ? dqCall(c) : { code: '', slip: '', desc: String(x) };
  });
}
