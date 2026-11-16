// Turning outside material (heat sheet PDFs, photos, live results pages, Meet Mobile screenshots) into
// proposed changes the coach confirms. Pure functions; the app does the file reading / OCR / fetching.
import { parseHeatSheet, parseHeatSheetText, teamEntries, parseResults, extractByName, parseEventTitle, parseLaneLine, sameSwimmer, toCs, lineHasSwimmer, ocrTime } from './parse.mjs';
import { heatInfoOf } from './model.mjs';

const teamRe = (pkg) => { const re = new RegExp(pkg.teamMatch || 'nsea', 'i'); return { test: (t) => re.test(String(t || '')) || re.test(String(t || '').replace(/[\s.\-]+/g, '')) }; };

// Which session a parsed heat sheet belongs to: header name first ("Saturday finals"), then by its events/rounds.
export function guessSession(pkg, parsed) {
  const nm = (parsed.session || '').toLowerCase();
  const byName = pkg.sessions.find((s) => s.name.toLowerCase() === nm) || pkg.sessions.find((s) => nm && s.name.toLowerCase().includes(nm.split(' ').slice(-1)[0]) && s.name.toLowerCase().startsWith(nm.split(' ')[0]));
  if (byName) return byName.n;
  const nums = parsed.events.map((e) => e.num);
  let best = null, score = 0;
  for (const s of pkg.sessions) {
    const k = s.events.filter((e) => nums.includes(e.num)).length;
    if (k > score) { best = s.n; score = k; }
  }
  return best;
}
const roundFor = (pkg, session, event, fallback) => {
  const s = pkg.sessions.find((x) => x.n === session);
  const e = s && s.events.find((x) => x.num === event);
  return (e && e.round) || fallback || 'Finals';
};

// Full heat sheet -> 'entries' op data (mode replace: swimmers not on it for those events are dropped).
export function heatSheetRows(pkg, model, parsed, session, mode = 'replace') {
  const mine = teamEntries(parsed, teamRe(pkg));
  const rows = mine.map((x) => {
    const s = [...model.swimmers.values()].find((y) => sameSwimmer(y.name, x.name));
    const ev = parsed.events.find((e) => e.num === x.event) || {};
    return { event: x.event, round: roundFor(pkg, session, x.event, x.round), swimmerId: s ? s.id : null, name: x.name, age: x.age, sex: ev.sex, heat: x.heat, heats: x.heats, lane: x.lane, seed: x.seed, start: x.start, isNew: !s };
  });
  const events = [...new Set(parsed.events.map((e) => e.num))];
  return { session, mode, rows, events, heatInfo: heatInfoOf(parsed), newEvents: parsed.events.filter((e) => !pkg.events[e.num]).map(({ heats, ...m }) => m), source: `heat sheet: ${parsed.session || 'unnamed'}` };
}

// OCR text of a photographed heat sheet (usually one re-seeded event) -> 'entries' op data (mode merge).
// Name-anchored: we only look for our own swimmers, so OCR noise elsewhere on the page doesn't matter.
export function photoHeatRows(pkg, model, text, session, defaultEvent) {
  const lines = String(text).split(/\r?\n/).map(ocrFix).filter(Boolean);
  const parsed = parseHeatSheetText(text, defaultEvent ? { num: defaultEvent, title: titleOf(pkg, defaultEvent) } : null);
  const viaParser = teamEntries(parsed, teamRe(pkg));
  const team = [...model.swimmers.values()];
  const page = lines.join(' ').toLowerCase();
  const hint = { dists: [...page.matchAll(/\b(50|100|200|400|500|1000|1650)\b/g)].map((m) => +m[1]), strokes: STROKE_WORDS.filter(([, re]) => re.test(page)).map(([k]) => k) };
  const rows = [];
  let heat = null, ev = defaultEvent || null, pair = null;
  const leadLane = (l) => { const m = l.match(/^\W{0,3}(\d{1,2})\b/); return m && +m[1] >= 1 && +m[1] <= 10 ? +m[1] : null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Combined deck-seeded events: "Event 19 / 20 Girls / Boys 13&O 500 Free"
    const comb = l.match(/Event\s*(\d{1,3})\s*\/\s*(\d{1,3})\s+(?:Girls|Women)\s*\/\s*(?:Boys|Men)/i);
    if (comb) { pair = { F: +comb[1], M: +comb[2] }; ev = null; continue; }
    const e = parseEventTitle(l); if (e) { ev = e.num; pair = null; continue; }
    const h = l.match(/^\W{0,3}Heat\s*(\d{1,2})/i);
    if (h) {
      heat = +h[1];
      const sx = /\bgirls|women\b/i.test(l) ? 'F' : /\bboys|men\b/i.test(l) ? 'M' : null;
      if (pair && sx) ev = pair[sx];
      const c = l.match(/\(#\s*(\d+)\s*(?:\/\s*(\d+))?/);
      if (c && c[2]) { pair = { F: +c[1], M: +c[2] }; if (sx) ev = pair[sx]; } else if (c) ev = +c[1];
      continue;
    }
    const s = team.find((sw) => lineHasSwimmer(l, sw.name));
    if (!s) continue;
    // Which of the swimmer's swims this is: the event on the page, else the pair by sex, else their one swim
    // in this session that matches the page's distance/stroke, else their one swim still without a heat (deck seeding).
    const mine = model.rows.filter((r) => r.swimmerId === s.id && (session == null || r.session === session));
    let evNum = ev && mine.some((r) => r.event === ev) ? ev : null;
    if (!evNum && pair) evNum = pair[s.sex] || null;
    const fits = (r) => hint.dists.includes(r.ev.dist) && (!hint.strokes.length || hint.strokes.includes(r.ev.stroke));
    if (!evNum) { const open = mine.filter((r) => !r.heat), m = open.filter(fits); if (m.length === 1) evNum = m[0].event; else if (!m.length && open.length === 1) evNum = open[0].event; }
    if (!evNum) { const m = mine.filter(fits); if (m.length === 1) evNum = m[0].event; }
    if (!evNum) evNum = ev;
    if (!evNum) continue;
    const p = parseLaneLine(l);
    let lane = p ? p.lane : leadLane(l);
    // Circled or smudged lane number: count swimmer rows to the nearest readable lane above or below
    // (lanes run 1–10 in order; stray OCR fragments between rows are skipped).
    if (!lane) {
      const rowLike = (x) => /[A-Za-z]{2,},\s*[A-Za-z]/.test(x || '') || /\b1?\d\s+[A-Za-z.\-]*[A-Z]{2,}[A-Za-z.\-]*\s+\S*\d/.test(x || '');
      const walk = (dir) => { let k = 0; for (let d = 1; d <= 8; d++) { const x = lines[i + dir * d]; if (x == null || /^\W{0,3}Heat/i.test(x)) return null; if (!rowLike(x)) continue; k++; const n = leadLane(x); if (n) return { lane: n - dir * k, k }; } return null; };
      const up = walk(-1), dn = walk(1);
      const c = [up, dn].filter((x) => x && x.lane >= 1 && x.lane <= 10).sort((a, b) => a.k - b.k)[0];
      if (c) lane = c.lane;
    }
    const last = l.split(/\s+/).reverse().find((t) => /^(NT|\d[\d:.,]{3,7})$/i.test(t.replace(/[_\-—|]+$/, '')));
    const seed = p ? p.seed : last && !/^NT$/i.test(last) ? ocrTime(last.replace(/,/g, '.')) : null;
    rows.push({ event: evNum, round: roundFor(pkg, session, evNum), swimmerId: s.id, name: s.name, age: s.age, sex: s.sex, heat, lane, seed, start: null, guessed: !p });
  }
  for (const v of viaParser) if (!rows.some((r) => r.event === v.event && sameSwimmer(r.name, v.name))) {
    const s = team.find((sw) => sameSwimmer(sw.name, v.name));
    rows.push({ event: v.event, round: roundFor(pkg, session, v.event, v.round), swimmerId: s ? s.id : null, name: v.name, age: v.age, heat: v.heat, heats: v.heats, lane: v.lane, seed: v.seed, start: v.start });
  }
  return { session, mode: 'merge', rows, source: 'photo of heat sheet (OCR)' };
}
// Common OCR slips on Hy-Tek sheets: "110f13" -> "11 of 13", "Startsat", pipes for I/l.
export const ocrFix = (l) => l.replace(/[|_]/g, ' ').replace(/(\d+?)\s*[0oO]f\s*(\d+)/g, '$1 of $2').replace(/Startsat/gi, 'Starts at').replace(/\s+/g, ' ').trim();
function titleOf(pkg, n) { const e = pkg.events[n]; return e ? e.title.replace(/(\d+) (Free|Back|Breast|Fly|IM)\w*$/, (m, d, s) => `${d} Yard ${({ Free: 'Freestyle', Back: 'Backstroke', Breast: 'Breaststroke', Fly: 'Butterfly', IM: 'IM' })[s]}`) : ''; }
export function lineHasName(line, name) { return lineHasSwimmer(line, name); }

// Parsed results (live page, results PDF) -> result op data for our swimmers.
export function resultOps(pkg, model, swims, { source, official = false, session = null } = {}) {
  const out = [];
  const team = teamRe(pkg);
  for (const w of swims) {
    if (!team.test(w.team)) continue;
    let cands = model.rows.filter((r) => r.event === w.event && sameSwimmer(r.swimmer.name, w.name) && (session == null || r.session === session));
    if (!cands.length) cands = model.rows.filter((r) => r.event === w.event && lineHasSwimmer(w.name, r.swimmer.name) && (session == null || r.session === session));
    if (!cands.length) continue;
    const r = cands.find((c) => roundMatch(c.round, w.round)) || cands[0];
    const prev = r.result;
    if (prev && prev.time === w.time && prev.status === w.status && (prev.official || !official)) continue;
    if (prev && prev.official && !official) continue;
    out.push({ entry: r.id, time: w.time, status: w.status, place: w.place, source, official, swimmer: r.swimmer.name, event: r.event });
  }
  return out;
}
const roundMatch = (a, b) => (a || 'Finals').startsWith('Prelim') === (b || 'Finals').startsWith('Prelim');

export function resultsFromText(pkg, model, text, opts) {
  return resultOps(pkg, model, parseResults(String(text).split(/\r?\n/)), opts);
}

// Screenshot of Meet Mobile (or any results screen): find our swimmers by name in one event.
export function screenshotResults(pkg, model, text, { event, session }) {
  const lines = String(text).split(/\r?\n/);
  const t = lines.map(parseEventTitle).find(Boolean);
  const evNum = (t && t.num) || detectEvent(pkg, model, text, session) || event || null;
  if (!evNum) return { event: null, results: [] };
  const rows = model.rows.filter((r) => r.event === evNum && (session == null || r.session === session));
  const hits = extractByName(text, rows.map((r) => ({ id: r.id, name: r.swimmer.name })), { team: teamRe(pkg) });
  return { event: evNum, results: hits.map((h) => ({ entry: h.id, time: h.time, status: h.status, line: h.line, swimmer: rows.find((r) => r.id === h.id).swimmer.name, fuzzy: h.fuzzy, source: 'screenshot (OCR)', official: false })) };
}

// Which event a results screenshot shows, from whatever title text the app prints ("#3 Girls 11 & Over 100 Free",
// "E3 W 100 Freestyle", "Event 3 ...") plus which of our swimmers appear on it. Returns null unless one event wins.
const STROKE_WORDS = [['Free', /\bfree(style)?\b|\bfr\b/], ['Back', /\bback(stroke)?\b|\bbk\b/], ['Breast', /\bbreast(stroke)?\b|\bbr\b/], ['Fly', /\bfly\b|\bbutterfly\b|\bfl\b/], ['IM', /\bim\b|\bmedley\b/]];
export function detectEvent(pkg, model, text, session) {
  const head = String(text).toLowerCase().split(/\r?\n/).slice(0, 8).join(' ');
  const all = String(text).toLowerCase();
  const sess = pkg.sessions.find((s) => s.n === session);
  const nums = sess ? sess.events.map((e) => e.num) : Object.keys(pkg.events).map(Number);
  const numHit = (head.match(/(?:#|\bevent\s*|\be)\s*(\d{1,3})\b/) || [])[1];
  if (numHit && nums.includes(+numHit)) return +numHit;
  const dists = [...head.matchAll(/\b(25|50|100|200|400|500|800|1000|1500|1650)\b/g)].map((m) => +m[1]);
  const strokes = STROKE_WORDS.filter(([, re]) => re.test(head)).map(([k]) => k);
  const sex = /\b(girls?|women|female|w)\b/.test(head) ? 'F' : /\b(boys?|men|male|m)\b/.test(head) ? 'M' : null;
  let best = null, bestScore = 0, tie = false;
  for (const n of nums) {
    const e = pkg.events[n];
    if (!e) continue;
    let sc = 0;
    if (dists.includes(e.dist)) sc += 2;
    if (strokes.includes(e.stroke)) sc += 2;
    if (sex && e.sex === sex) sc += 1; else if (sex && e.sex && e.sex !== sex) sc -= 3;
    const ours = model.rows.filter((r) => r.event === n && (session == null || r.session === session));
    sc += Math.min(3, ours.filter((r) => all.includes(r.swimmer.name.split(',')[0].trim().toLowerCase())).length) * 0.5;
    if (sc > bestScore) { best = n; bestScore = sc; tie = false; } else if (sc === bestScore) tie = true;
  }
  return bestScore >= 4 && !tie ? best : null;
}

// HTML (Hy-Tek real-time results, or any page with <pre> results) -> plain lines + links to other result pages.
export function htmlToText(html) {
  const pre = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => m[1]);
  const body = pre.length ? pre.join('\n') : html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, '  ');
  return decode(body.replace(/<[^>]+>/g, ''));
}
export function resultLinks(html, baseUrl) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decode(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    let href; try { href = new URL(m[1], baseUrl).toString(); } catch { continue; }
    const num = (text.match(/(?:#|Event\s*)(\d{1,3})\b/i) || [])[1];
    if (num && /\.(htm|html|pdf)(\?|$)/i.test(href)) out.push({ href, text, event: +num });
  }
  return out;
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));

export { parseHeatSheet };
