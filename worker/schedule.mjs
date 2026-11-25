// Practice Schedule. One base schedule per season, plus dated changes on top of it.
//  - The weekly check (cron, Wednesday night; or "Run the check now") reads the events calendar, the school
//    calendars and the high school / WSL meet calendars, applies the rules below and puts suggestions in a queue.
//  - Nothing reaches families until a coach approves it. Captyn stays the families' source of truth; each change
//    has a "posted in Captyn" tick so nothing is missed there.
// Public reads: /api/content/schedule (see content.mjs). Admin: /api/admin/schedule/* (role "schedule").
import { json, fail, clean } from './util.mjs';
import { scheduleDefaults, SCHED_GROUPS, DAYS } from '../src/data/schedule-defaults.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['cancel', 'time', 'replace', 'add', 'info'];
const SESSIONS = ['AM', 'PM'];
const TIME_OK = /^[0-9:apmAPM .–-]{3,30}$|^(TBD|Off)$/;

// ---------- dates ----------
const toUTC = (d) => new Date(d + 'T12:00:00Z');
export const addDays = (d, n) => { const t = toUTC(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const dow = (d) => (toUTC(d).getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
export const mondayOf = (d) => addDays(d, -dow(d));
export function etToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function datesBetween(a, b) { const out = []; for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d); return out; }
const short = (d) => `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow(d)]} ${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

// ---------- base schedule ----------
export const seasonFor = (cfg, d) => (cfg.seasons || []).find((s) => s.start <= d && d <= s.end) || null;
// The base time for a group/session on a date: a time string, 'Off', or null when the group has no such session.
export function baseTime(cfg, d, group, session) {
  const s = seasonFor(cfg, d);
  const row = s && s.base && s.base[group] && s.base[group][session];
  if (!row) return null;
  const i = dow(d);
  return i === 6 ? 'Off' : (row[i] || 'Off');
}
const practices = (t) => !!t && t !== 'Off';
const groupsOf = (list) => (!list || !list.length || list.includes('All') ? SCHED_GROUPS : SCHED_GROUPS.filter((g) => list.includes(g)));
const sessionsOf = (cfg, d, group) => { const s = seasonFor(cfg, d); return s && s.base && s.base[group] ? SESSIONS.filter((x) => s.base[group][x]) : []; };

// ---------- iCalendar (.ics) ----------
// Enough of RFC 5545 for school and meet calendars: unfolded lines, VEVENT blocks, DATE and DATE-TIME starts.
// Recurring events (RRULE) are read as their first occurrence only.
function etDateOf(stamp) {
  // 20261119T220000Z -> ET calendar date
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return etToday(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
}
function icsDate(prop) {
  if (!prop) return null;
  const v = prop.value;
  if (/^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  if (/^\d{8}T\d{6}Z$/.test(v)) return { date: etDateOf(v), allDay: false };
  if (/^\d{8}T\d{6}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: false }; // floating or TZID (local)
  return null;
}
const unescape = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
export function parseICS(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const s = icsDate(cur.DTSTART);
        if (s && s.date && !(cur.STATUS && /CANCELLED/i.test(cur.STATUS.value))) {
          let e = icsDate(cur.DTEND);
          // all-day DTEND is exclusive
          let end = e && e.date ? (s.allDay && e.allDay ? addDays(e.date, -1) : e.date) : s.date;
          if (end < s.date) end = s.date;
          out.push({ start: s.date, end, allDay: s.allDay, summary: unescape((cur.SUMMARY && cur.SUMMARY.value) || '').trim(), description: unescape((cur.DESCRIPTION && cur.DESCRIPTION.value) || '').trim(), location: unescape((cur.LOCATION && cur.LOCATION.value) || '').trim() });
        }
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    if (!cur[name]) cur[name] = { value: line.slice(i + 1) };
  }
  return out;
}

// ---------- school calendars ----------
// 'holiday' = no school, 'workday' = teacher workday (no students). Early release has no effect, so it is not returned.
export function schoolDayKind(summary) {
  const s = String(summary || '').toLowerCase();
  if (/early (release|dismissal)|half day|interim|report card|grading period|progress report/.test(s)) return null;
  if (/workday|work day|professional development|teacher planning/.test(s)) return 'workday';
  if (/holiday|vacation|break|no school|schools closed|closed/.test(s)) return 'holiday';
  return null;
}

// ---------- high school meets ----------
// "Swim Meet @ UNCW: Ashley / Laney / New Hanover / Topsail" or a "Teams: ..." line in the description.
export function hsSchools(ev) {
  if (/all teams/i.test(ev.summary + ' ' + ev.description)) return ['*'];
  const t = (ev.description.match(/teams?:\s*([^\n.]+)/i) || [])[1] || (ev.summary.split(':').slice(1).join(':'));
  return t ? t.split(/[\/,&]| vs\.? /i).map((x) => x.replace(/\*/g, '').trim()).filter(Boolean) : [];
}
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
function counted(schools, list) {
  if (schools.includes('*')) return list.slice();
  const want = new Map(list.map((x) => [norm(x), x]));
  return [...new Set(schools.map((s) => want.get(norm(s))).filter(Boolean))];
}
const isSwimMeet = (ev) => !ev.allDay && /meet|champ|invitational|relays/i.test(ev.summary);

// ---------- Holiday Break Practice Schedules sheet ----------
// The sheet is a series of blocks: a title row ("Thanksgiving Break"), optional "Week N | ..." rows, a weekday row,
// a date row (M/D/YY in columns C..I), then one row per group (column B may say AM or PM). Cells say Normal, Off
// or a time ("6:30 – 8:30am"). A group with one row describes its whole day; a group with AM and PM rows describes
// each session. Unlabelled times go to the session the group usually practises that day, else by start hour.
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function sheetCsvUrl(link) {
  const id = (String(link || '').match(/\/spreadsheets\/d\/([\w-]{20,})/) || [])[1];
  if (!id) return '';
  const gid = (String(link).match(/[#?&]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? '&gid=' + gid : ''}`;
}
const GROUP_ALIAS = { sr: 'Senior', senior: 'Senior', 'senior surge': 'Senior' };
function sheetGroup(v) {
  const k = String(v || '').trim().toLowerCase();
  if (!k) return '';
  return GROUP_ALIAS[k] || SCHED_GROUPS.find((g) => g.toLowerCase() === k) || null;
}
function sheetDate(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
export function cleanTime(v) {
  return String(v || '').replace(/[–—]/g, '-').replace(/\s*(a\.?m\.?|p\.?m\.?)\s*$/i, '').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
}
const ampm = (v) => (/a\.?m\.?\s*$/i.test(v) ? 'AM' : /p\.?m\.?\s*$/i.test(v) ? 'PM' : '');
function guessSession(cfg, d, g, v) {
  const on = SESSIONS.filter((s) => practices(baseTime(cfg, d, g, s)));
  if (on.length === 1) return on[0];
  const h = parseInt(cleanTime(v), 10);
  return h >= 5 && h <= 10 ? 'AM' : 'PM';
}
// Returns the differences from the base schedule: [{ section, date, group, session, kind, value }].
export function parseHolidaySheet(rows, cfg) {
  const out = [];
  let section = '', dates = null, block = [];
  const flush = () => {
    if (!dates || !block.length) { block = []; return; }
    const byGroup = new Map();
    for (const b of block) { const l = byGroup.get(b.group) || []; l.push(b); byGroup.set(b.group, l); }
    for (const [g, list] of byGroup) {
      const whole = list.length === 1;
      dates.forEach((d, i) => {
        if (!d) return;
        const want = {}; // session -> 'Off' | time ; missing = no change
        for (const r of list) {
          const raw = String(r.cells[i] || '').trim();
          if (!raw || /^normal$/i.test(raw)) continue;
          if (/^off$/i.test(raw) || /^no practice$/i.test(raw)) {
            if (whole) SESSIONS.forEach((s) => { want[s] = 'Off'; }); else want[r.session || 'PM'] = 'Off';
            continue;
          }
          const s = ampm(raw) || r.session || guessSession(cfg, d, g, raw);
          want[s] = cleanTime(raw);
          if (whole) SESSIONS.forEach((x) => { if (x !== s && !want[x]) want[x] = 'Off'; });
        }
        for (const s of SESSIONS) {
          if (!(s in want)) continue;
          const base = baseTime(cfg, d, g, s);
          const cur = base || 'Off';
          if (want[s] === cur || (base === null && want[s] === 'Off')) continue;
          out.push({ section, date: d, group: g, session: s, kind: want[s] === 'Off' ? 'cancel' : 'time', value: want[s] === 'Off' ? '' : want[s] });
        }
      });
    }
    block = [];
  };
  let lastGroup = '';
  for (const r of rows) {
    const a = String(r[0] || '').trim(), rest = r.slice(1).map((x) => String(x || '').trim());
    const ds = r.slice(2, 9).map(sheetDate);
    if (ds.filter(Boolean).length >= 3) { flush(); dates = ds; lastGroup = ''; continue; }
    const g = sheetGroup(a);
    if (g || (!a && lastGroup && /^(AM|PM)$/i.test(rest[0] || ''))) {
      if (!dates) continue;
      const group = g || lastGroup;
      lastGroup = group;
      block.push({ group, session: /^(AM|PM)$/i.test(rest[0] || '') ? rest[0].toUpperCase() : '', cells: r.slice(2, 9) });
      continue;
    }
    if (a && rest.every((x) => !x)) {
      flush(); dates = null; lastGroup = '';
      if (!/^week\b/i.test(a) && !/subject to change/i.test(a)) section = a;
      continue;
    }
    if (rest.slice(1).some((x) => /day$/i.test(x))) { flush(); dates = null; }
  }
  flush();
  return out;
}
const slug = (s) => String(s || 'holiday').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'holiday';
export function sheetSuggestions(cfg, rows, from, to) {
  return parseHolidaySheet(rows, cfg).filter((x) => x.date >= from && x.date <= to).map((x) => ({
    source_ref: `sheet:${slug(x.section)}:${x.date}:${x.group}:${x.session}`, date: x.date, group_name: x.group, session: x.session,
    kind: x.kind, value: x.value, note: x.section, reason: `${x.section || 'Holiday schedule'} (Holiday Break sheet)`, source: 'sheet', confidence: 'likely',
  }));
}

// ---------- the rules ----------
// inputs: { events: [events.json events], schools: [{ name, events }], hs: [ics events], wsl: [ics events] }
// Returns suggestions: { source_ref, date, group_name, session, kind, value, reason, source, confidence }.
export function suggest(cfg, from, to, inputs, today = from) {
  const c = cfg.check || {};
  const out = new Map();
  const push = (s) => { if (s.date >= from && s.date <= to && !out.has(s.source_ref)) out.set(s.source_ref, s); };
  const events = (inputs.events || []).filter((e) => e && e.start && e.precision !== 'month' && !/cancel/i.test(e.status || ''));
  // Days already covered by a holiday practice plan (type "schedule" in the events calendar).
  const planned = new Set();

  for (const e of events) {
    const end = e.end && e.end >= e.start ? e.end : e.start;
    if (end < from || e.start > to) continue;
    const days = datesBetween(e.start, end);
    const tentative = /tentative/i.test(e.status || '');
    if (e.type === 'schedule') {
      if (days.length > 1) days.forEach((d) => planned.add(d));
      push({ source_ref: `holiday:${e.id}`, date: e.start, group_name: 'All', session: 'PM', kind: 'info', value: '',
        reason: days.length > 1 ? `${e.title} (${short(e.start)} – ${short(end)}). The times come from the Holiday Break sheet (suggestions marked “Holiday sheet”); add anything it doesn’t cover.` : `${e.title}.`,
        source: 'holiday', confidence: 'fyi' });
      continue;
    }
    if (e.type === 'meet' && !e.infoOnly) {
      // A home meet (our pool) takes the place of practice; an away meet means no practice for the groups entered.
      const home = (e.tags || []).includes('home') || e.venue === 'EJP';
      for (const d of days) for (const g of groupsOf(e.groups)) for (const ss of sessionsOf(cfg, d, g)) {
        if (!practices(baseTime(cfg, d, g, ss))) continue;
        push({ source_ref: `meet:${e.id}:${d}:${g}:${ss}`, date: d, group_name: g, session: ss, kind: home ? 'replace' : 'cancel', value: home ? e.title : '',
          reason: home ? `${e.title} (home meet) in place of practice?` : `${e.title} (${g} entered)`, source: 'meet', confidence: tentative || home ? 'maybe' : 'likely' });
      }
      // A meet over Saturday and Sunday usually means the Monday off too.
      if (days.some((d) => dow(d) === 5) && days.some((d) => dow(d) === 6)) {
        const mon = addDays(days.filter((d) => dow(d) === 6).pop(), 1);
        for (const g of groupsOf(e.groups)) for (const ss of sessionsOf(cfg, mon, g)) {
          if (!practices(baseTime(cfg, mon, g, ss))) continue;
          push({ source_ref: `meet-monday:${e.id}:${mon}:${g}:${ss}`, date: mon, group_name: g, session: ss, kind: 'cancel', value: '',
            reason: `Monday after ${e.title} (Saturday + Sunday meet)`, source: 'meet', confidence: 'maybe' });
        }
      }
      continue;
    }
    if (e.type === 'team-event') {
      if (groupsOf(e.groups).length === SCHED_GROUPS.length) {
        push({ source_ref: `team:${e.id}`, date: e.start, group_name: 'All', session: 'PM', kind: 'info', value: e.title,
          reason: `Team event for all groups: ${e.title}. Any practice change?`, source: 'team-event', confidence: 'fyi' });
        continue;
      }
      for (const d of days) for (const g of groupsOf(e.groups)) {
        const ss = sessionsOf(cfg, d, g);
        const on = ss.filter((x) => practices(baseTime(cfg, d, g, x)));
        if (on.length) for (const x of on) push({ source_ref: `team:${e.id}:${d}:${g}:${x}`, date: d, group_name: g, session: x, kind: 'replace', value: e.title,
          reason: `${e.title} replaces practice?`, source: 'team-event', confidence: 'maybe' });
        else push({ source_ref: `team:${e.id}:${d}:${g}`, date: d, group_name: g, session: ss.includes('AM') ? 'AM' : 'PM', kind: 'add', value: e.title,
          reason: `${e.title} (no practice that day)`, source: 'team-event', confidence: 'likely' });
      }
    }
  }

  // School holidays: only AM practices move. Skip days a holiday practice plan already covers.
  const off = new Map(); // date -> [{ county, kind, summary }]
  for (const sc of inputs.schools || []) for (const ev of sc.events || []) {
    const k = ev.allDay && schoolDayKind(ev.summary);
    if (!k) continue;
    for (const d of datesBetween(ev.start, ev.end)) {
      if (dow(d) > 5) continue;
      const l = off.get(d) || [];
      if (!l.some((x) => x.county === sc.name)) l.push({ county: sc.name, kind: k, summary: ev.summary });
      off.set(d, l);
    }
  }
  for (const [d, l] of off) {
    if (l.length < (c.minCounties || 1) || planned.has(d)) continue;
    const holiday = l.some((x) => x.kind === 'holiday');
    const why = l.map((x) => `${x.county.replace(/ County Schools$/, '')}: ${x.summary}`).join('; ');
    for (const g of SCHED_GROUPS) if (practices(baseTime(cfg, d, g, 'AM'))) {
      push({ source_ref: `school:${d}:${g}`, date: d, group_name: g, session: 'AM', kind: 'time', value: '',
        reason: `No school (${why}). Move the morning practice?`, source: 'school', confidence: holiday ? 'likely' : 'maybe' });
    }
  }

  // High school meet nights (and WSL meets in summer): count only schools/teams with NSEA swimmers.
  const meetNights = (evs, list, min, groups, session, source, label) => {
    const byDay = new Map();
    for (const ev of evs || []) {
      if (!isSwimMeet(ev)) continue;
      const got = counted(hsSchools(ev), list);
      const cur = byDay.get(ev.start) || new Set();
      got.forEach((x) => cur.add(x));
      byDay.set(ev.start, cur);
    }
    for (const [d, set] of byDay) {
      if (set.size < min) continue;
      const names = [...set].join(', ');
      for (const g of groups) if (practices(baseTime(cfg, d, g, session))) {
        push({ source_ref: `${source}:${d}:${g}:${session}`, date: d, group_name: g, session, kind: 'time', value: '',
          reason: `${label}: ${names}. Shift ${g} ${session}?`, source, confidence: 'likely' });
      }
      // Our own events on a busy meet night (e.g. an intersquad).
      for (const e of events) {
        if (!(e.start <= d && d <= (e.end || e.start)) || !['meet', 'team-event'].includes(e.type) || e.infoOnly) continue;
        push({ source_ref: `${source}-conflict:${d}:${e.id}`, date: d, group_name: 'All', session: 'PM', kind: 'info', value: '',
          reason: `${e.title} is on a ${label.replace(/s$/, '')} night (${names}). Rethink timing?`, source, confidence: 'fyi' });
      }
    }
  };
  meetNights(inputs.hs, c.hsSchools || [], c.hsMin || 3, c.hsGroups || [], c.hsSession || 'PM', 'hs', 'HS meets');
  if ((c.wslTeams || []).length) meetNights(inputs.wsl, c.wslTeams, 1, c.wslGroups || [], c.wslSession || 'PM', 'wsl', 'WSL meet');

  // April–May: ask which WSL teams have Senior swimmers, until that is filled in.
  const mo = today.slice(5, 7);
  if ((mo === '04' || mo === '05') && !(c.wslTeams || []).length) {
    push({ source_ref: `reminder:wsl-teams:${today.slice(0, 4)}`, date: today < from ? from : today, group_name: 'Senior', session: 'PM', kind: 'info', value: '',
      reason: 'Which WSL teams have Senior swimmers this summer? Add them in Settings so WSL meet nights are checked.', source: 'reminder', confidence: 'fyi' });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.group_name.localeCompare(b.group_name));
}

// ---------- applying approved changes ----------
// Returns one week (Mon..Sun) as rows of cells. Approved changes only.
export function weekView(cfg, monday, changes) {
  const days = datesBetween(monday, addDays(monday, 6));
  const approved = (changes || []).filter((x) => x.status === 'approved' && x.kind !== 'info' && x.date >= days[0] && x.date <= days[6]);
  const rows = [];
  for (const g of SCHED_GROUPS) {
    const ss = new Set();
    days.forEach((d) => sessionsOf(cfg, d, g).forEach((x) => ss.add(x)));
    approved.forEach((x) => { if (x.group_name === g || x.group_name === 'All') ss.add(x.session); });
    for (const s of SESSIONS) {
      if (!ss.has(s)) continue;
      rows.push({ group: g, session: s, cells: days.map((d) => {
        let text = baseTime(cfg, d, g, s) || 'Off', changed = false, note = '';
        for (const x of approved) {
          if (x.date !== d || x.session !== s || !(x.group_name === g || x.group_name === 'All')) continue;
          changed = true;
          if (x.kind === 'cancel') text = 'Off';
          else if (x.kind === 'time') text = x.value || text;
          else if (x.kind === 'replace' || x.kind === 'add') text = x.value || text;
          if (x.note) note = x.note;
        }
        return { text, changed, note };
      }) });
    }
  }
  const s = seasonFor(cfg, days[0]) || seasonFor(cfg, days[6]);
  return { start: days[0], end: days[6], days: days.map((d) => ({ date: d, label: DAYS[dow(d)], short: short(d) })), season: s ? s.label : '', note: s ? s.note || '' : '', rows };
}

// ---------- storage ----------
export async function loadConfig(env) {
  const r = await env.DB.prepare(`SELECT json FROM site_data WHERE key = 'schedule'`).first();
  const d = scheduleDefaults();
  if (!r) return d;
  try { const s = JSON.parse(r.json); return { seasons: s.seasons || d.seasons, check: { ...d.check, ...(s.check || {}) } }; } catch { return d; }
}
const publicSeasons = (cfg) => cfg.seasons.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end, base: s.base, note: s.note || '' }));

// Public: GET /api/content/schedule?start=YYYY-MM-DD&weeks=1..4 (default: this week and next)
export async function publicSchedule(env, url) {
  const cfg = await loadConfig(env);
  const today = etToday();
  const start = DATE.test(url.searchParams.get('start') || '') ? mondayOf(url.searchParams.get('start')) : mondayOf(today);
  const n = Math.max(1, Math.min(4, parseInt(url.searchParams.get('weeks'), 10) || 2));
  const end = addDays(start, n * 7 - 1);
  const { results } = await env.DB.prepare(`SELECT date, group_name, session, kind, value, note, status FROM sched_changes WHERE status = 'approved' AND date >= ? AND date <= ?`).bind(start, end).all();
  const weeks = [];
  for (let i = 0; i < n; i++) weeks.push(weekView(cfg, addDays(start, i * 7), results));
  return json({ today, weeks, seasons: publicSeasons(cfg) }, 200, { 'cache-control': 'public, max-age=60' });
}

// ---------- calendar feed (.ics) ----------
// Public: GET /api/content/schedule.ics?group=senior (or group=all). This week plus the next 4 weeks, approved changes
// applied. Families subscribe once; calendar apps re-read it on their own schedule (Google: every few hours).
// A practice keeps the same UID whether it is moved or cancelled, so a subscribed calendar updates it in place.
export const FEED_WEEKS = 5;
const SITE_HOST = 'nseaswimteam.com';
const POOL = 'Earl Jackson Pool, 750 Bess St, Wilmington, NC 28401';
const NY_TZ = ['BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE'];
// "4:30 - 6:00" in a PM session -> { start: '1630', end: '1800' }. Returns null for anything that isn't a time range.
export function parseRange(text, session) {
  const m = String(text || '').replace(/[–—]/g, '-').match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
  if (!m) return null;
  const hh = (h, suffix) => {
    h = +h;
    if (suffix) return /pm/i.test(suffix) ? (h % 12) + 12 : h % 12;
    return session === 'PM' && h < 12 ? h + 12 : h;
  };
  let a = hh(m[1], m[3]), b = hh(m[4], m[6]);
  if (b < a && session === 'AM' && !m[6]) b += 12; // e.g. AM "10:30 - 12:00"
  if (a > 23 || b > 23 || (b * 60 + +(m[5] || 0)) <= (a * 60 + +(m[2] || 0))) return null;
  const f = (h, mi) => String(h).padStart(2, '0') + String(mi || '00').padStart(2, '0');
  return { start: f(a, m[2]), end: f(b, m[5]) };
}
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function fold(line) {
  // 75 octets per line, continuation lines start with a space (RFC 5545 3.1); never split a UTF-8 character.
  const enc = new TextEncoder(), out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const w = enc.encode(ch).length;
    if (n + w > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += w;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function feedGroup(v) {
  const k = String(v || 'all').trim().toLowerCase();
  if (k === 'all' || k === '') return 'All';
  return SCHED_GROUPS.find((g) => g.toLowerCase() === k) || null;
}
// weeks: weekView() results. group: one of SCHED_GROUPS or 'All'.
export function practiceICS(cfg, weeks, group, now = new Date()) {
  const name = group === 'All' ? 'NSEA Swim Practices' : `NSEA Swim ${group} Practices`;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NSEA Swim//Practice Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:America/New_York',
    `X-WR-CALDESC:${icsText('Practice times from the NSEA Swim practice schedule. Captyn is the source of truth for practice times.')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...NY_TZ];
  const ts = stamp(now);
  for (const w of weeks) for (const r of w.rows) {
    if (group !== 'All' && r.group !== group) continue;
    r.cells.forEach((c, i) => {
      const d = w.days[i].date, ymd = d.replace(/-/g, '');
      const base = baseTime(cfg, d, r.group, r.session);
      const cancelled = c.changed && c.text === 'Off' && practices(base);
      const text = cancelled ? base : c.text;
      if (!text || text === 'Off' || text === 'TBD') return;
      const uid = `practice-${ymd}-${r.group.toLowerCase()}-${r.session.toLowerCase()}@${SITE_HOST}`;
      const t = parseRange(text, r.session);
      const label = `${r.group} practice` + (r.session === 'AM' && group !== 'All' ? ' (AM)' : r.session === 'AM' ? ' AM' : '');
      const desc = [];
      if (cancelled) desc.push('Cancelled.');
      else if (c.changed) desc.push('Changed from the usual schedule.');
      if (c.note) desc.push(c.note);
      desc.push('Captyn is the source of truth for practice times. If this calendar and Captyn disagree, go with Captyn.');
      desc.push(`Practice schedule: https://www.${SITE_HOST}/programs/schedule/`);
      L.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${ts}`);
      if (t) L.push(`DTSTART;TZID=America/New_York:${ymd}T${t.start}00`, `DTEND;TZID=America/New_York:${ymd}T${t.end}00`);
      else L.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${addDays(d, 1).replace(/-/g, '')}`);
      const summary = cancelled ? `Cancelled: ${label}` : t ? label + (c.changed ? ' (changed)' : '') : `${r.group}: ${text}`;
      L.push(`SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(desc.join('\n'))}`);
      if (t) L.push(`LOCATION:${icsText(POOL)}`, 'TRANSP:OPAQUE');
      else L.push('TRANSP:TRANSPARENT');
      L.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
    });
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
export async function publicScheduleICS(env, url) {
  const group = feedGroup(url.searchParams.get('group'));
  if (!group) return new Response('Unknown group. Use one of: all, ' + SCHED_GROUPS.map((g) => g.toLowerCase()).join(', '), { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const cfg = await loadConfig(env);
  const start = mondayOf(etToday());
  const end = addDays(start, FEED_WEEKS * 7 - 1);
  const { results } = await env.DB.prepare(`SELECT date, group_name, session, kind, value, note, status FROM sched_changes WHERE status = 'approved' AND date >= ? AND date <= ?`).bind(start, end).all();
  const weeks = [];
  for (let i = 0; i < FEED_WEEKS; i++) weeks.push(weekView(cfg, addDays(start, i * 7), results));
  const file = group === 'All' ? 'nsea-practices' : `nsea-${group.toLowerCase()}-practices`;
  return new Response(practiceICS(cfg, weeks, group), { status: 200, headers: {
    'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `inline; filename="${file}.ics"`,
    'cache-control': 'public, max-age=900', 'access-control-allow-origin': '*' } });
}

// ---------- the weekly check ----------
async function getText(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'user-agent': 'nsea-site-schedule-check', accept: 'text/calendar, application/json, */*' }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
export async function gather(cfg, fetchImpl = fetch) {
  const c = cfg.check, problems = [];
  const inputs = { events: [], schools: [], hs: [], wsl: [], sheet: null };
  try { inputs.events = (JSON.parse(await getText(c.eventsUrl, fetchImpl)).events) || []; } catch (e) { problems.push(`Events calendar: ${e.message}`); }
  for (const s of c.schools || []) {
    if (!s.on || !s.url) continue;
    try { inputs.schools.push({ name: s.name, events: parseICS(await getText(s.url, fetchImpl)) }); } catch (e) { problems.push(`${s.name}: ${e.message}`); }
  }
  if (c.hsUrl) {
    try {
      inputs.hs = parseICS(await getText(c.hsUrl, fetchImpl));
      if (c.hsSchoolDays) inputs.schools.push({ name: c.hsSchoolDays, events: inputs.hs.filter((e) => e.allDay) });
    } catch (e) { problems.push(`High school meets: ${e.message}`); }
  } else problems.push('High school meets calendar link not set (Settings).');
  const csv = sheetCsvUrl(c.holidaySheet);
  if (csv) { try { inputs.sheet = parseCSV(await getText(csv, fetchImpl)); if (!inputs.sheet.length || /<html/i.test(inputs.sheet[0].join(''))) throw new Error('not a sheet (is it shared "anyone with the link"?)'); } catch (e) { inputs.sheet = null; problems.push(`Holiday Break sheet: ${e.message}`); } }
  if ((c.wslTeams || []).length) {
    if (c.wslUrl) { try { inputs.wsl = parseICS(await getText(c.wslUrl, fetchImpl)); } catch (e) { problems.push(`WSL meets: ${e.message}`); } } else problems.push('WSL meets calendar link not set (Settings).');
  }
  return { inputs, problems };
}

// Saves suggestions: new ones are added; an undecided one whose details changed is updated; one that is already
// decided is left alone; and nothing is suggested when an approved or rejected change already says the same thing.
export async function saveSuggestions(env, list) {
  let added = 0, updated = 0, same = 0;
  for (const s of list) {
    const ex = await env.DB.prepare(`SELECT id, status, kind, value, reason FROM sched_changes WHERE source_ref = ?`).bind(s.source_ref).first();
    if (ex) {
      if (ex.status === 'suggested' && (ex.kind !== s.kind || ex.value !== s.value || ex.reason !== s.reason)) {
        await env.DB.prepare(`UPDATE sched_changes SET kind = ?, value = ?, reason = ?, note = ? WHERE id = ?`).bind(s.kind, s.value, s.reason, s.note || '', ex.id).run();
        updated++;
      }
      continue;
    }
    const dup = await env.DB.prepare(`SELECT 1 x FROM sched_changes WHERE status != 'suggested' AND date = ? AND group_name = ? AND session = ? AND kind = ? AND value = ?`)
      .bind(s.date, s.group_name, s.session, s.kind, s.value).first();
    if (dup) { same++; continue; }
    await env.DB.prepare(`INSERT INTO sched_changes (source_ref, date, group_name, session, kind, value, note, reason, source, confidence, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', 'weekly check')`).bind(s.source_ref, s.date, s.group_name, s.session, s.kind, s.value, s.note || '', s.reason, s.source, s.confidence).run();
    added++;
  }
  return { added, updated, same };
}

// Adds new suggestions (never re-adding one already decided), drops undecided ones that no longer apply.
export async function runCheck(env, by = 'cron', fetchImpl = fetch, now = new Date()) {
  const cfg = await loadConfig(env);
  const today = etToday(now);
  const from = addDays(today, 1), to = addDays(today, cfg.check.lookaheadDays || 21);
  const { inputs, problems } = await gather(cfg, fetchImpl);
  const list = suggest(cfg, from, to, inputs, today);
  if (inputs.sheet) list.push(...sheetSuggestions(cfg, inputs.sheet, from, to));
  const { added } = await saveSuggestions(env, list);
  let removed = 0;
  // Only clear stale suggestions from sources that were actually read this time.
  const okSources = new Set(['reminder']);
  if (!problems.some((p) => p.startsWith('Events calendar'))) ['meet', 'team-event', 'holiday'].forEach((x) => okSources.add(x));
  if (inputs.schools.length) okSources.add('school');
  if (cfg.check.hsUrl && !problems.some((p) => p.startsWith('High school'))) okSources.add('hs');
  if (inputs.wsl.length) okSources.add('wsl');
  if (inputs.sheet) okSources.add('sheet');
  const keep = new Set(list.map((s) => s.source_ref));
  const { results } = await env.DB.prepare(`SELECT id, source_ref, source FROM sched_changes WHERE status = 'suggested' AND source_ref IS NOT NULL AND date >= ? AND date <= ?`).bind(from, to).all();
  for (const r of results) {
    if (keep.has(r.source_ref) || !okSources.has(r.source)) continue;
    await env.DB.prepare(`DELETE FROM sched_changes WHERE id = ?`).bind(r.id).run();
    removed++;
  }
  await env.DB.prepare(`INSERT INTO sched_runs (window_start, window_end, added, removed, problems, by) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(from, to, added, removed, problems.join('\n'), by).run();
  return { from, to, added, removed, problems };
}

// ---------- admin ----------
function parseChange(b) {
  const date = clean(b.date, 10);
  if (!DATE.test(date)) return { error: 'Please choose a date.' };
  const group_name = b.group_name === 'All' || SCHED_GROUPS.includes(b.group_name) ? b.group_name : '';
  if (!group_name) return { error: 'Please choose a group (or All).' };
  const session = SESSIONS.includes(b.session) ? b.session : 'PM';
  const kind = KINDS.includes(b.kind) ? b.kind : '';
  if (!kind) return { error: 'Please choose what changes.' };
  const value = clean(b.value, 60);
  if (kind === 'time' && !value) return { error: 'Please enter the new time (for example 4:30 - 6:00).' };
  if (kind === 'time' && !TIME_OK.test(value)) return { error: 'Times look like 4:30 - 6:00.' };
  if ((kind === 'replace' || kind === 'add') && !value) return { error: 'Please say what replaces practice (for example Rock Gym).' };
  return { date, group_name, session, kind, value, note: clean(b.note, 140), reason: clean(b.reason, 300) };
}
function parseSettings(b, cur) {
  const seasons = (Array.isArray(b.seasons) ? b.seasons : []).slice(0, 6).map((s, i) => {
    const base = {};
    for (const g of SCHED_GROUPS) {
      const row = s && s.base && s.base[g];
      if (!row) continue;
      for (const ss of SESSIONS) {
        if (!Array.isArray(row[ss])) continue;
        (base[g] = base[g] || {})[ss] = [0, 1, 2, 3, 4, 5].map((k) => clean(row[ss][k], 30) || 'Off');
      }
    }
    return { id: clean(s.id, 40) || 'season-' + (i + 1), label: clean(s.label, 60) || 'Season ' + (i + 1), start: clean(s.start, 10), end: clean(s.end, 10), base, note: clean(s.note, 300) };
  });
  if (!seasons.length) return { error: 'Keep at least one season.' };
  for (const s of seasons) if (!DATE.test(s.start) || !DATE.test(s.end) || s.end < s.start) return { error: `Check the dates for “${s.label}”.` };
  const k = b.check || {};
  const list = (v, n) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((x) => clean(x, 60)).filter(Boolean))].slice(0, n);
  const url = (v) => { const u = clean(v, 500); return /^https:\/\/[^\s]+$/.test(u) ? u : ''; };
  const check = {
    ...cur.check,
    schools: (Array.isArray(k.schools) ? k.schools : cur.check.schools).slice(0, 6).map((s) => ({ name: clean(s.name, 60) || 'School calendar', url: url(s.url), on: !!s.on })),
    minCounties: Math.max(1, Math.min(6, parseInt(k.minCounties, 10) || 1)),
    hsUrl: url(k.hsUrl), hsSchoolDays: clean(k.hsSchoolDays, 60), hsSchools: list(k.hsSchools, 30), hsMin: Math.max(1, Math.min(20, parseInt(k.hsMin, 10) || 3)),
    hsGroups: list(k.hsGroups, 6).filter((g) => SCHED_GROUPS.includes(g)), hsSession: SESSIONS.includes(k.hsSession) ? k.hsSession : 'PM',
    wslUrl: url(k.wslUrl), wslTeams: list(k.wslTeams, 30),
    wslGroups: list(k.wslGroups, 6).filter((g) => SCHED_GROUPS.includes(g)), wslSession: SESSIONS.includes(k.wslSession) ? k.wslSession : 'PM',
    holidaySheet: /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(clean(k.holidaySheet, 500)) ? clean(k.holidaySheet, 500) : '',
    lookaheadDays: Math.max(7, Math.min(60, parseInt(k.lookaheadDays, 10) || 21)),
  };
  return { data: { seasons, check } };
}

// One practice (date + group + session) has one approved change: approving a new one retires the older one.
async function replaceOlder(env, id, c) {
  await env.DB.prepare(`UPDATE sched_changes SET status = 'rejected', reason = reason || ' (replaced by a newer change)' WHERE id != ? AND status = 'approved' AND kind != 'info' AND date = ? AND group_name = ? AND session = ?`)
    .bind(id, c.date, c.group_name, c.session).run();
}

// Returns a Response, or null if the path is not a schedule path.
export async function handleScheduleAdmin(env, me, method, path, body, audit, fetchImpl = fetch) {
  if (method === 'GET' && path === '/schedule') {
    const cfg = await loadConfig(env);
    const today = etToday();
    const [queue, decided, runs] = await Promise.all([
      env.DB.prepare(`SELECT * FROM sched_changes WHERE status = 'suggested' AND date >= ? ORDER BY date, group_name, session`).bind(today).all(),
      env.DB.prepare(`SELECT * FROM sched_changes WHERE status != 'suggested' AND date >= ? ORDER BY date, group_name, session LIMIT 300`).bind(addDays(today, -7)).all(),
      env.DB.prepare(`SELECT * FROM sched_runs ORDER BY id DESC LIMIT 5`).all(),
    ]);
    const thisMon = mondayOf(today), nextMon = addDays(thisMon, 7);
    const all = [...queue.results, ...decided.results];
    return json({ today, config: cfg, groups: SCHED_GROUPS, queue: queue.results, decided: decided.results, runs: runs.results,
      weeks: [weekView(cfg, thisMon, all), weekView(cfg, nextMon, all)] });
  }
  if (method === 'POST' && path === '/schedule/run') {
    const r = await runCheck(env, me.email, fetchImpl);
    await audit('schedule', 'run check', `${r.added} new, ${r.removed} cleared`);
    return json({ ok: true, ...r });
  }
  if (method === 'POST' && path === '/schedule/holiday-import') {
    const cfg = await loadConfig(env);
    const csv = sheetCsvUrl(cfg.check.holidaySheet);
    if (!csv) return fail(400, 'Add the Holiday Break sheet link in Settings first.');
    let rows;
    try { rows = parseCSV(await getText(csv, fetchImpl)); } catch (e) { return fail(502, `Could not read the sheet (${e.message}). Is it shared “anyone with the link can view”?`); }
    if (!rows.length || /<html/i.test(rows[0].join(''))) return fail(502, 'That link did not return a sheet. Check it is shared “anyone with the link can view”.');
    const today = etToday();
    const list = sheetSuggestions(cfg, rows, addDays(today, 1), addDays(today, 400));
    const r = await saveSuggestions(env, list);
    const sections = [...new Set(list.map((x) => x.note).filter(Boolean))];
    await audit('schedule', 'import holiday sheet', `${r.added} new, ${r.updated} updated`);
    return json({ ok: true, ...r, found: list.length, sections });
  }
  if (method === 'POST' && path === '/schedule/settings') {
    const cur = await loadConfig(env);
    const r = parseSettings(body, cur);
    if (r.error) return fail(400, r.error);
    await env.DB.prepare(`INSERT INTO site_data (key, json, updated_by) VALUES ('schedule', ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = datetime('now'), updated_by = excluded.updated_by`)
      .bind(JSON.stringify(r.data), me.email).run();
    await audit('schedule', 'edit settings', '');
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/schedule/settings/reset') {
    await env.DB.prepare(`DELETE FROM site_data WHERE key = 'schedule'`).run();
    await audit('schedule', 'reset settings', '');
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/schedule/changes') {
    const c = parseChange(body);
    if (c.error) return fail(400, c.error);
    const r = await env.DB.prepare(`INSERT INTO sched_changes (date, group_name, session, kind, value, note, reason, source, confidence, status, created_by, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'likely', 'approved', ?, ?, datetime('now'))`)
      .bind(c.date, c.group_name, c.session, c.kind, c.value, c.note, c.reason, me.email, me.email).run();
    await replaceOlder(env, r.meta.last_row_id, c);
    await audit('schedule', 'add change', `${c.date} ${c.group_name} ${c.session} ${c.kind} ${c.value}`);
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (method === 'POST' && path === '/schedule/approve-likely') {
    const r = await env.DB.prepare(`UPDATE sched_changes SET status = 'approved', decided_by = ?, decided_at = datetime('now')
      WHERE status = 'suggested' AND confidence = 'likely' AND (kind IN ('cancel', 'add', 'replace') OR (kind = 'time' AND value != '')) AND date >= ?`).bind(me.email, etToday()).run();
    await audit('schedule', 'approve all likely', `${r.meta.changes} changes`);
    return json({ ok: true, approved: r.meta.changes });
  }
  const m = path.match(/^\/schedule\/changes\/(\d+)\/(approve|reject|reopen|edit|captyn|delete)$/);
  if (method === 'POST' && m) {
    const id = +m[1], act = m[2];
    const cur = await env.DB.prepare(`SELECT * FROM sched_changes WHERE id = ?`).bind(id).first();
    if (!cur) return fail(404, 'Change not found');
    const label = `${cur.date} ${cur.group_name} ${cur.session}`;
    if (act === 'approve' || act === 'edit') {
      const c = parseChange({ ...cur, ...body });
      if (c.error && !(act === 'approve' && cur.kind === 'info')) return fail(400, c.error);
      const v = c.error ? cur : c;
      await env.DB.prepare(`UPDATE sched_changes SET date = ?, group_name = ?, session = ?, kind = ?, value = ?, note = ?, status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
        .bind(v.date, v.group_name, v.session, v.kind, v.value, v.note || '', act === 'approve' ? 'approved' : (cur.status === 'suggested' ? 'suggested' : cur.status), me.email, id).run();
      if (act === 'approve' && v.kind !== 'info') await replaceOlder(env, id, v);
      await audit('schedule', act === 'approve' ? 'approve change' : 'edit change', label);
      return json({ ok: true });
    }
    if (act === 'reject') { await env.DB.prepare(`UPDATE sched_changes SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE id = ?`).bind(me.email, id).run(); }
    if (act === 'reopen') { await env.DB.prepare(`UPDATE sched_changes SET status = 'suggested', decided_by = NULL, decided_at = NULL WHERE id = ?`).bind(id).run(); }
    if (act === 'captyn') { await env.DB.prepare(`UPDATE sched_changes SET captyn = ? WHERE id = ?`).bind(body.on ? 1 : 0, id).run(); }
    if (act === 'delete') {
      if (cur.source_ref) return fail(400, 'Suggestions are rejected, not deleted (so they are not suggested again).');
      await env.DB.prepare(`DELETE FROM sched_changes WHERE id = ?`).bind(id).run();
    }
    await audit('schedule', act + ' change', label);
    return json({ ok: true });
  }
  return null;
}
