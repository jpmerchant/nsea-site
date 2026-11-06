// New swimmer assessment scheduling (admin console: Assessments > Scheduling).
//
// Staff publish 15-minute availability slots. A request (entered by staff now, by the public form later) is scheduled into a
// slot, or onto a custom date and time. Anyone with the "assessment" role can schedule; every change is audited.
// Dates and times are Eastern (the pool's local time) stored as text, so nothing here depends on the server's time zone.
// Family-facing rules (published slots must be NOTICE_DAYS out) are in openSlotsFor(); staff can still schedule closer in.
import { json, fail, clean, EMAIL } from './util.mjs';

export const SLOT_MINUTES = 15;
export const NOTICE_DAYS = 7;
const MAX_SLOTS_PER_ADD = 200, MAX_SPAN_DAYS = 120;

export const todayET = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const utc = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)); };
export const addDays = (d, n) => { const t = utc(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const weekdayOf = (d) => utc(d).getUTCDay();

export function parseDate(s) {
  const v = String(s ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return utc(v).toISOString().slice(0, 10) === v ? v : null;
}
export function parseTime(s) {
  const v = String(s ?? '').trim();
  const m = v.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m || Number(m[2]) % 5) return null;
  return String(m[1]).padStart(2, '0') + ':' + m[2];
}

// Free-text start times as people type them: "4:00 PM", "4pm", "4:15 pm". 24-hour times with an hour of 13 or more
// ("16:00") are accepted too. A bare "4:00" is ambiguous (AM or PM?) so it is rejected rather than guessed.
export function parseClock(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] === undefined ? '00' : m[2], ap = m[3] && m[3].toLowerCase();
  if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap === 'p' ? 12 : 0); }
  else if (h < 13 || h > 23) return null;
  return parseTime(String(h).padStart(2, '0') + ':' + min);
}
const CLOCK_TOKEN = /\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/gi;
function clockList(v) {
  if (Array.isArray(v)) return v.map(parseTime);
  const s = String(v ?? '');
  const tokens = s.match(CLOCK_TOKEN) || [];
  if (s.replace(CLOCK_TOKEN, '').replace(/[\s,;]|\band\b/gi, '')) return [null]; // leftover text: not a time list
  return tokens.map(parseClock);
}

// Turn "every Tuesday and Thursday from Nov 17 to Dec 17 at 4:00 and 4:15" into dated slots.
export function expandSlots(b, today) {
  const from = parseDate(b.from), to = parseDate(b.to || b.from);
  if (!from || !to) return { error: 'Please choose a first and last date.' };
  if (to < from) return { error: 'The last date is before the first date.' };
  if (from < today) return { error: 'Slots have to start today or later.' };
  if (utc(to) - utc(from) > MAX_SPAN_DAYS * 86400000) return { error: `Add slots for at most ${MAX_SPAN_DAYS} days at a time.` };
  const weekdays = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))];
  if (!weekdays.length || weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)) return { error: 'Choose at least one day of the week.' };
  const times = [...new Set(clockList(b.times))];
  if (!times.length || times.includes(null)) return { error: 'Enter start times like 4:00 PM or 4:15 PM (on a 5-minute mark, with AM or PM).' };
  if (times.length > 12) return { error: 'Add at most 12 start times per day.' };
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d))) for (const t of times.sort()) out.push([d, t]);
  if (!out.length) return { error: 'None of those dates fall on the days you chose.' };
  if (out.length > MAX_SLOTS_PER_ADD) return { error: `That would add ${out.length} slots; the limit is ${MAX_SLOTS_PER_ADD} at a time.` };
  return { slots: out };
}

export function parseRequest(b) {
  const contact_name = clean(b.contact_name, 80), swimmer_name = clean(b.swimmer_name, 80);
  const contact_email = clean(b.contact_email, 120).toLowerCase();
  if (!swimmer_name) return { error: 'Please enter the swimmer’s name.' };
  if (!contact_name) return { error: 'Please enter the parent or guardian’s name.' };
  if (!EMAIL.test(contact_email)) return { error: 'Please enter a valid email address for the family.' };
  let swimmer_age = null;
  if (String(b.swimmer_age ?? '').trim() !== '') {
    swimmer_age = Number(b.swimmer_age);
    if (!Number.isInteger(swimmer_age) || swimmer_age < 2 || swimmer_age > 25) return { error: 'The swimmer’s age should be a whole number from 2 to 25.' };
  }
  const prefIn = Array.isArray(b.preferred) ? b.preferred : [];
  if (prefIn.length > 3) return { error: 'A family can list at most three preferred times.' };
  const preferred = [];
  for (const p of prefIn) {
    const date = parseDate(p && p.date), time = p && p.time ? parseTime(p.time) : '';
    if (!date || time === null) return { error: 'A preferred time is not a valid date and time.' };
    preferred.push({ date, time });
  }
  return { contact_name, contact_email, contact_phone: clean(b.contact_phone, 30) || null, swimmer_name, swimmer_age, notes: clean(b.notes, 1000) || null, preferred: preferred.length ? JSON.stringify(preferred) : null };
}

// What a family may book: open slots at least NOTICE_DAYS ahead.
export async function openSlotsFor(env, now = new Date()) {
  const earliest = addDays(todayET(now), NOTICE_DAYS);
  const r = await env.DB.prepare(`SELECT id, slot_date, start_time, minutes FROM assess_slots WHERE status = 'open' AND slot_date >= ? ORDER BY slot_date, start_time`).bind(earliest).all();
  return r.results;
}

const jsonOr = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const shapeRequest = (r) => ({ ...r, preferred: jsonOr(r.preferred, []), flags: jsonOr(r.flags, []), groups_asked: jsonOr(r.groups_asked, []), intake: jsonOr(r.intake, null) });

export async function handleScheduleAdmin(env, me, method, path, body, audit, now = new Date()) {
  const today = todayET(now);

  if (method === 'GET' && path === '/assessment/schedule') {
    const [slots, reqs] = await Promise.all([
      env.DB.prepare(`SELECT s.id, s.slot_date, s.start_time, s.minutes, s.status, r.id AS request_id, r.swimmer_name
                      FROM assess_slots s LEFT JOIN assess_requests r ON r.slot_id = s.id AND r.status = 'scheduled'
                      WHERE s.slot_date >= ? ORDER BY s.slot_date, s.start_time`).bind(today).all(),
      env.DB.prepare(`SELECT * FROM assess_requests ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                      CASE WHEN status = 'scheduled' THEN appt_date END, created_at DESC LIMIT 300`).all()
    ]);
    return json({ today, noticeDays: NOTICE_DAYS, minutes: SLOT_MINUTES, slots: slots.results, requests: reqs.results.map(shapeRequest) });
  }

  // Publish availability: a date range, the weekdays, and the start times.
  if (method === 'POST' && path === '/assessment/slots') {
    const x = expandSlots(body, today);
    if (x.error) return fail(400, x.error);
    const res = await env.DB.batch(x.slots.map(([d, t]) =>
      env.DB.prepare(`INSERT OR IGNORE INTO assess_slots (slot_date, start_time, minutes, created_by) VALUES (?, ?, ?, ?)`).bind(d, t, SLOT_MINUTES, me.email)));
    const added = res.reduce((n, r) => n + ((r.meta && r.meta.changes) || r.changes || 0), 0);
    await audit('assessment', 'added availability', `${added} new of ${x.slots.length} slots, ${x.slots[0][0]} to ${x.slots[x.slots.length - 1][0]}`);
    return json({ ok: true, added, skipped: x.slots.length - added });
  }

  let m = path.match(/^\/assessment\/slots\/(\d+)\/remove$/);
  if (method === 'POST' && m) {
    const s = await env.DB.prepare(`SELECT id, status, slot_date, start_time FROM assess_slots WHERE id = ?`).bind(Number(m[1])).first();
    if (!s) return fail(404, 'That slot no longer exists.');
    if (s.status !== 'open') return fail(409, 'That slot is booked. Cancel or move the assessment first.');
    await env.DB.prepare(`DELETE FROM assess_slots WHERE id = ?`).bind(s.id).run();
    await audit('assessment', 'removed slot', `${s.slot_date} ${s.start_time}`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/assessment/requests') {
    const p = parseRequest(body);
    if (p.error) return fail(400, p.error);
    const r = await env.DB.prepare(`INSERT INTO assess_requests (source, contact_name, contact_email, contact_phone, swimmer_name, swimmer_age, notes, preferred, created_by)
      VALUES ('admin', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(p.contact_name, p.contact_email, p.contact_phone, p.swimmer_name, p.swimmer_age, p.notes, p.preferred, me.email).run();
    const id = (r.meta && r.meta.last_row_id) || null;
    await audit('assessment', 'added request', `#${id}`);
    return json({ ok: true, id });
  }

  m = path.match(/^\/assessment\/requests\/(\d+)\/(schedule|decline|cancel)$/);
  if (method === 'POST' && m) {
    const id = Number(m[1]), action = m[2];
    const req = await env.DB.prepare(`SELECT * FROM assess_requests WHERE id = ?`).bind(id).first();
    if (!req) return fail(404, 'That request no longer exists.');

    if (action === 'schedule') {
      if (req.status !== 'new' && req.status !== 'scheduled') return fail(409, `A ${req.status} request can't be scheduled. Add a new request instead.`);
      let date, time, slot = null;
      if (body.slot_id) {
        slot = await env.DB.prepare(`SELECT * FROM assess_slots WHERE id = ?`).bind(Number(body.slot_id)).first();
        if (!slot) return fail(404, 'That slot no longer exists.');
        date = slot.slot_date; time = slot.start_time;
      } else {
        date = parseDate(body.date); time = parseTime(body.time);
        if (!date || !time) return fail(400, 'Choose a slot, or enter a date and a start time on a 5-minute mark.');
        slot = await env.DB.prepare(`SELECT * FROM assess_slots WHERE slot_date = ? AND start_time = ?`).bind(date, time).first();
      }
      if (date < today) return fail(400, 'That date has already passed.');
      const clash = await env.DB.prepare(`SELECT id FROM assess_requests WHERE status = 'scheduled' AND appt_date = ? AND appt_time = ? AND id != ?`).bind(date, time, id).first();
      if (clash || (slot && slot.status === 'booked' && slot.id !== req.slot_id)) return fail(409, 'Another assessment is already scheduled at that time.');
      const stmts = [];
      if (req.slot_id && (!slot || slot.id !== req.slot_id)) stmts.push(env.DB.prepare(`UPDATE assess_slots SET status = 'open' WHERE id = ?`).bind(req.slot_id));
      if (slot) stmts.push(env.DB.prepare(`UPDATE assess_slots SET status = 'booked' WHERE id = ?`).bind(slot.id));
      stmts.push(env.DB.prepare(`UPDATE assess_requests SET status = 'scheduled', slot_id = ?, appt_date = ?, appt_time = ?, confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(slot ? slot.id : null, date, time, me.email, id));
      await env.DB.batch(stmts);
      await audit('assessment', req.status === 'scheduled' ? 'rescheduled' : 'scheduled', `request #${id} for ${date} ${time}`);
      return json({ ok: true, date, time });
    }

    if (action === 'decline') {
      if (req.status !== 'new') return fail(409, 'Only a new request can be declined. Cancel a scheduled one instead.');
      await env.DB.prepare(`UPDATE assess_requests SET status = 'declined', staff_note = ?, updated_at = datetime('now') WHERE id = ?`).bind(clean(body.note, 500) || null, id).run();
      await audit('assessment', 'declined request', `#${id}`);
      return json({ ok: true });
    }

    if (req.status !== 'scheduled' && req.status !== 'new') return fail(409, 'That request is already closed.');
    const stmts = [];
    if (req.slot_id) stmts.push(env.DB.prepare(`UPDATE assess_slots SET status = 'open' WHERE id = ?`).bind(req.slot_id));
    stmts.push(env.DB.prepare(`UPDATE assess_requests SET status = 'cancelled', slot_id = NULL, staff_note = COALESCE(?, staff_note), updated_at = datetime('now') WHERE id = ?`).bind(clean(body.note, 500) || null, id));
    await env.DB.batch(stmts);
    await audit('assessment', 'cancelled', `request #${id}`);
    return json({ ok: true });
  }

  return null;
}
