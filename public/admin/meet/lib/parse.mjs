// Meet Day parsers. Shared by the browser app and the Node build script, so one parser reads
// Hy-Tek heat sheets / results whether they come from a PDF, a phone photo (OCR) or a live results page.
//
// Layer 1: PDF text items -> ordered lines (handles Hy-Tek's two-column programs).
// Layer 2: lines -> events / heats / entries (heat sheets) or swims (results).
// Layer 3: name-anchored matching for messy sources (Meet Mobile screenshots, photos).

export const STROKES = { free: 'Free', freestyle: 'Free', back: 'Back', backstroke: 'Back', breast: 'Breast', breaststroke: 'Breast', fly: 'Fly', butterfly: 'Fly', im: 'IM', 'individual medley': 'IM' };
const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}\.\d{2}`;
const TIME_RE = new RegExp(`^${TIME}$`);

export function toCs(t) {
  if (t == null) return null;
  const s = String(t).trim().replace(/[A-Za-z*#]+$/, '');
  if (!/^(?:\d{1,2}:)?\d{1,2}\.\d{2}$/.test(s)) return null;
  const [a, b] = s.includes(':') ? s.split(':') : ['0', s];
  return Math.round((+a * 60 + +b) * 100);
}
export function fmt(cs) {
  if (cs == null || !isFinite(cs)) return 'NT';
  const m = Math.floor(cs / 6000), s = (cs % 6000) / 100;
  return m ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z, ]/g, '').replace(/\s+/g, ' ').trim();
// "Witmer, Gentry" -> { last: 'witmer', first: 'gentry' } (middle initials and nicknames dropped)
export function nameKey(name) {
  const n = norm(name);
  const [last, rest = ''] = n.includes(',') ? n.split(',') : [n.split(' ').slice(-1)[0], n.split(' ').slice(0, -1).join(' ')];
  return { last: last.trim(), first: rest.trim().split(' ')[0] || '' };
}
export const sameSwimmer = (a, b) => { const x = nameKey(a), y = nameKey(b); return x.last === y.last && (x.first === y.first || x.first.startsWith(y.first) || y.first.startsWith(x.first)); };

// ---------- Layer 1: PDF ----------
// pages: [{ width, height, items: [{ x, y, w, str }] }]  (pdf.js getTextContent, y = baseline from the bottom)
export function pdfLines(pages) {
  const out = [];
  for (const pg of pages) {
    const W = pg.width, H = pg.height;
    const items = pg.items.filter((it) => it.str && it.str.trim());
    // Page header (venue / meet name / "Meet Program - Friday PM") is the top ~70pt.
    const head = items.filter((it) => it.y > H - 72).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const l of rows(head)) out.push({ text: l, header: true });
    const body = items.filter((it) => it.y <= H - 72);
    const twoCol = body.some((it) => it.x > W * 0.5 + 4 && /^Event\b|^Heat\b|^\d{1,2}$/.test(it.str.trim()));
    const cols = twoCol ? [body.filter((it) => it.x < W / 2), body.filter((it) => it.x >= W / 2)] : [body];
    for (const c of cols) for (const l of rows(c)) out.push({ text: l });
  }
  return out;
}
function rows(items) {
  const s = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const it of s) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.y - it.y) <= 3.2) g.items.push(it); else groups.push({ y: it.y, items: [it] });
  }
  return groups.map((g) => g.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join('  '));
}

// ---------- Layer 2: heat sheets ----------
const EVENT_RE = /^(?:#\s*)?Event\s+(\d+)\s+(Girls|Boys|Women|Men|Mixed|Female|Male)\s+(.+?)\s+(\d{2,4})\s+(Yard|Meter|LC Meter|SC Meter)s?\s+(Freestyle Relay|Medley Relay|Freestyle|Backstroke|Breaststroke|Butterfly|IM|Individual Medley)/i;
const HEAT_RE = /^Heat\s+(\d+)\s+of\s+(\d+)\s*(Prelims|Finals|Timed Finals|Swim-?off)?\s*(?:Starts at\s+(\d{1,2}:\d{2}\s*[AP]M))?/i;
const HEAT_CONT_RE = /^Heat\s+(\d+)\s+(Prelims|Finals|Timed Finals)?\s*\(#(\d+)\s/i;
const LANE_RE = new RegExp(String.raw`^(\d{1,2})\s+([A-Za-zÀ-ÿ'’.\- ]+?,\s*[A-Za-zÀ-ÿ'’.\- ]+?)\s+(\d{1,2})\s+(.+?)\s+(NT|NS|${TIME})\s*[A-Za-z]?$`);

export function parseEventTitle(t) {
  const m = t.match(EVENT_RE);
  if (!m) return null;
  const sex = /girl|wom|fem/i.test(m[2]) ? 'F' : /boy|men|male/i.test(m[2]) ? 'M' : 'X';
  const strokeWord = m[6].toLowerCase().replace(' relay', '');
  return {
    num: +m[1], sex, ageLabel: m[3].trim(), dist: +m[4], course: /meter/i.test(m[5]) ? 'LCM' : 'SCY',
    stroke: STROKES[strokeWord] || m[6], relay: /relay/i.test(m[6]),
    title: `${m[2]} ${m[3].trim()} ${m[4]} ${m[6]}`,
  };
}

// lines: [{ text, header? }] or plain strings. Returns { session, events: [{ ...event, heats: [{ heat, of, round, start, lanes: [...] }] }] }
export function parseHeatSheet(lines) {
  const L = lines.map((l) => (typeof l === 'string' ? { text: l } : l));
  const events = new Map();
  let ev = null, heat = null, session = null, meet = null;
  for (const { text, header } of L) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (header) {
      const m = t.match(/Meet Program\s*-\s*(.+)$/i); if (m) session = m[1].trim();
      const mm = t.match(/^(.+?)\s+-\s+(\d{1,2}\/\d{1,2}\/\d{4})/); if (mm && !/HY-TEK/.test(t)) meet = mm[1].trim();
      continue;
    }
    if (!session) { const m = t.match(/Meet Program\s*-\s*(.+)$/i); if (m) { session = m[1].trim(); continue; } }
    const e = parseEventTitle(t);
    if (e) { ev = events.get(e.num) || { ...e, heats: [] }; events.set(e.num, ev); heat = null; continue; }
    const hc = t.match(HEAT_CONT_RE);
    if (hc) {
      ev = events.get(+hc[3]) || ev;
      if (!ev) continue;
      heat = ev.heats.find((h) => h.heat === +hc[1]);
      if (!heat) { heat = { heat: +hc[1], of: null, round: (hc[2] || 'Finals'), start: null, lanes: [] }; ev.heats.push(heat); }
      continue;
    }
    const h = t.match(HEAT_RE);
    if (h && ev) {
      heat = { heat: +h[1], of: +h[2], round: (h[3] || 'Finals').replace(/-/, ''), start: h[4] ? h[4].replace(/\s+/g, ' ').toUpperCase() : null, lanes: [] };
      const old = ev.heats.findIndex((x) => x.heat === heat.heat);
      if (old >= 0) ev.heats[old] = heat; else ev.heats.push(heat);
      continue;
    }
    const ln = parseLaneLine(t);
    if (ln && heat) heat.lanes.push(ln);
  }
  const list = [...events.values()].map((e) => ({ ...e, heats: fillHeats(e.heats.sort((a, b) => a.heat - b.heat)) })).sort((a, b) => a.num - b.num);
  return { meet, session, events: list };
}
// A heat that starts at the bottom of one column and continues in the next loses its "of N" and start time.
function fillHeats(hs) {
  const of = Math.max(0, ...hs.map((h) => h.of || 0)) || hs.length;
  hs.forEach((h, i) => {
    h.of = h.of || of;
    if (!h.start) {
      const p = hs[i - 1] && hs[i - 1].start, n = hs[i + 1] && hs[i + 1].start;
      if (p && n) { const a = clockMin(p), b = clockMin(n); h.start = minClock(Math.round((a + b) / 2)); h.estStart = true; }
      else if (p) { h.start = p; h.estStart = true; }
    }
  });
  return hs;
}
export function clockMin(s) { const m = String(s).match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if (!m) return null; let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + +m[2]; }
export function minClock(n) { const h = Math.floor(n / 60), m = n % 60; return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; }

export function parseLaneLine(t) {
  const m = t.replace(/\s+/g, ' ').trim().match(LANE_RE);
  if (!m || +m[1] < 1 || +m[1] > 12) return null;
  return { lane: +m[1], name: m[2].replace(/\s+/g, ' ').trim(), age: +m[3], team: m[4].trim(), seed: m[5] === 'NT' || m[5] === 'NS' ? null : toCs(m[5]) };
}

// Keep only one team's swimmers. teamMatch: RegExp tested against the team column.
export function teamEntries(parsed, teamMatch) {
  const out = [];
  for (const e of parsed.events) for (const h of e.heats) for (const l of h.lanes)
    if (teamMatch.test(l.team)) out.push({ event: e.num, heat: h.heat, heats: h.of, round: h.round, start: h.start, lane: l.lane, name: l.name, age: l.age, team: l.team, seed: l.seed });
  return out;
}

// ---------- Layer 2: results (Hy-Tek results pages, results PDFs, live results) ----------
// Returns [{ event, name, age, team, place, time, status, round }] for every swim found.
const RES_RE = new RegExp(String.raw`^(\*?\d{1,3}|---|--)\s+([A-Za-zÀ-ÿ'’.\- ]+?,\s*[A-Za-zÀ-ÿ'’.\- ]+?)\s+(\d{1,2})\s+(.+?)\s+((?:NT|${TIME})[A-Za-z]?)\s+((?:${TIME})[A-Za-z]?|DQ|DFS|NS|SCR|DNF|X${TIME})(.*)$`);
export function parseResults(lines) {
  const out = [];
  let ev = null, round = 'Finals';
  for (const raw of lines) {
    const t = (typeof raw === 'string' ? raw : raw.text).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const e = parseEventTitle(t);
    if (e) { ev = e; round = 'Finals'; continue; }
    if (/^(Preliminaries|Prelims)\b/i.test(t)) { round = 'Prelims'; continue; }
    if (/^(Finals|[A-D] - Final|Championship Final|Consolation Final|Bonus Final)\b/i.test(t)) { round = 'Finals'; continue; }
    const m = t.match(RES_RE);
    if (!m || !ev) continue;
    const res = m[6].replace(/^X/, '');
    const time = toCs(res);
    out.push({
      event: ev.num, name: m[2].trim(), age: +m[3], team: m[4].trim(),
      place: /^\*?\d+$/.test(m[1]) ? +m[1].replace('*', '') : null,
      seed: toCs(m[5]), time, status: time != null ? 'OK' : res.toUpperCase(), round,
      qualified: time != null && /[qQ]\s*$/.test(m[6]),
    });
  }
  return out;
}

// ---------- Layer 3: name-anchored extraction (Meet Mobile screenshots, photos of result sheets) ----------
// Finds each known swimmer's name in OCR text and takes the nearest time on that line or the next two.
// swimmers: [{ id, name }]. Returns [{ id, name, time, status, line }]
export function extractByName(text, swimmers) {
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const nl = lines.map((l) => norm(l.replace(/[|]/g, ' ')));
  const found = [];
  for (const s of swimmers) {
    const k = nameKey(s.name);
    if (!k.last) continue;
    const forms = [`${k.last}, ${k.first}`, `${k.last} ${k.first}`, `${k.first} ${k.last}`].filter((f) => f.trim().length > 3);
    for (let i = 0; i < lines.length; i++) {
      if (!forms.some((f) => nl[i].replace(/,(?! )/g, ', ').includes(f))) continue;
      const near = [lines[i], lines[i + 1] || '', lines[i + 2] || ''];
      let hit = null;
      for (let j = 0; j < near.length && !hit; j++) {
        const after = j === 0 ? near[0].slice(Math.max(0, near[0].toLowerCase().lastIndexOf(k.first ? k.first.slice(0, 3) : k.last.slice(0, 3)))) : near[j];
        const st = after.match(/\b(DQ|DFS|NS|SCR|DNF)\b/);
        const times = [...after.matchAll(new RegExp(`(?<![\\d.:])${TIME}(?![\\d])`, 'g'))].map((x) => x[0]);
        if (times.length) hit = { time: toCs(times[times.length - 1]), status: 'OK', times };
        else if (st) hit = { time: null, status: st[1] };
      }
      if (hit) { found.push({ id: s.id, name: s.name, ...hit, line: lines[i] }); break; }
    }
  }
  return found;
}

// OCR text -> heat sheet lines (photos of re-seeds). Same layer-2 parser; lines missing an event header
// can be pinned to an event by the caller (defaultEvent).
export function parseHeatSheetText(text, defaultEvent) {
  const lines = String(text).split(/\r?\n/).map((x) => x.replace(/[|_]/g, ' ').replace(/(\d+?)\s*[0oO]f\s*(\d+)/g, '$1 of $2').replace(/Startsat/gi, 'Starts at').replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map((l) => l.replace(/^[Il](?=\s+[A-Z])/, '1').replace(/(\d)[,](\d{2})\b/g, '$1.$2').replace(/\bO(?=\d)|(?<=\d)O\b/g, '0'));
  if (defaultEvent && !lines.some((l) => EVENT_RE.test(l))) lines.unshift(`Event ${defaultEvent.num} ${defaultEvent.title}`);
  return parseHeatSheet(lines);
}

export async function readPdf(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    pages.push({ width: vp.width, height: vp.height, items: tc.items.map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, str: it.str })) });
  }
  return pages;
}

// ---------- Hy-Tek HY3 entry file (team entries exported from Team Manager / Captyn) ----------
// Returns { meet: { name, start, end }, swimmers: [{ id, last, first, sex, birth, age, usaId }], entries: [{ swimmerId, event, dist, stroke, seed }] }
const HY3_STROKE = { A: 'Free', B: 'Back', C: 'Breast', D: 'Fly', E: 'IM' };
export function parseHy3(text) {
  const out = { meet: null, swimmers: [], entries: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.replace(/\s+$/, '');
    if (l.startsWith('B1')) {
      const d = l.slice(47).match(/(\d{8})(\d{8})/);
      if (d) out.meet = { name: l.slice(2, 47).trim(), start: mdy(d[1]), end: mdy(d[2]) };
    } else if (l.startsWith('D1')) {
      const m = l.match(/^D1([MF])\s*(\d+)(.{20})(.{20})(.{20})?\s*([0-9A-Z*]{14})?\s+(\d{8})\s+(\d{1,2})/);
      if (m) out.swimmers.push({ id: +m[2], sex: m[1], last: m[3].trim(), first: (m[5] && m[5].trim()) || m[4].trim(), usaId: m[6] || null, birth: mdy(m[7]), age: +m[8] });
    } else if (l.startsWith('E1')) {
      // fixed columns: sex 2, athlete 3-7, distance 15-20, stroke 21; then fee, event number, seed time + course
      const id = parseInt(l.slice(3, 8), 10), dist = parseInt(l.slice(15, 21), 10), st = HY3_STROKE[l[21]];
      const m = l.slice(22).match(/^\s*\d+\s+[\d.]+\s+(\d+)\s+\S+\s+([\d.]+)([YLS])/);
      if (id && dist && st && m) out.entries.push({ swimmerId: id, dist, stroke: st, event: +m[1], seed: +m[2] > 0 ? Math.round(+m[2] * 100) : null, seedCourse: m[3] });
    }
  }
  return out;
}
const mdy = (s) => `${s.slice(4, 8)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
