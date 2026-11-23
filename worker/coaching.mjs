// Meet coaching (/api/admin/coaching/*): availability by session, hotel rooms, and JP's assignments.
// Who does what:
//   * any coach linked to a coach_authors row: sees open meets, answers yes / maybe / no for each session and
//     whether they need a hotel room (and which nights) for themselves;
//   * managers (owner or the "staff" role): add meets and their sessions, answer for any coach, assign coaches
//     to sessions, set the schedule's status (preliminary / confirmed) and export coaching.json for meet.py.
import { json, fail, clean } from './util.mjs';
import { isManager, linkedCoach } from './staff.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ANSWERS = ['yes', 'maybe', 'no'];
const STATUS = ['none', 'preliminary', 'confirmed'];
export const canCoaching = async (env, me) => isManager(me) || !!(await linkedCoach(env, me));

export function daysBetween(start, end) {
  const out = [], d = new Date(start + 'T12:00:00Z'), e = new Date(end + 'T12:00:00Z');
  while (d <= e && out.length < 14) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || n;

function parseSessions(list, start, end) {
  const days = daysBetween(start, end), out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const day = clean(s.day, 10), label = clean(s.label, 60);
    if (!label) continue;
    if (!days.includes(day)) return { error: `Session “${label}” is not on a day of the meet.` };
    out.push({ id: Number.isInteger(+s.id) && +s.id > 0 ? +s.id : null, day, label });
  }
  return { sessions: out };
}

async function loadMeet(env, id) {
  const meet = await env.DB.prepare(`SELECT * FROM mc_meets WHERE id = ?`).bind(id).first();
  if (!meet) return null;
  const sessions = (await env.DB.prepare(`SELECT id, day, label, sort FROM mc_sessions WHERE meet_id = ? AND removed = 0 ORDER BY day, sort, id`).bind(id).all()).results;
  const coaches = (await env.DB.prepare(`SELECT id, name FROM coach_authors WHERE active = 1 OR id IN (SELECT coach_id FROM mc_coach WHERE meet_id = ?) ORDER BY sort, name`).bind(id).all()).results;
  const avail = (await env.DB.prepare(`SELECT a.session_id, a.coach_id, a.answer FROM mc_avail a JOIN mc_sessions s ON s.id = a.session_id WHERE s.meet_id = ? AND s.removed = 0`).bind(id).all()).results;
  const assign = (await env.DB.prepare(`SELECT a.session_id, a.coach_id FROM mc_assign a JOIN mc_sessions s ON s.id = a.session_id WHERE s.meet_id = ? AND s.removed = 0`).bind(id).all()).results;
  const info = (await env.DB.prepare(`SELECT coach_id, hotel, nights, note FROM mc_coach WHERE meet_id = ?`).bind(id).all()).results
    .map((r) => ({ ...r, nights: r.nights ? r.nights.split(',') : [] }));
  return { meet, sessions, coaches, avail, assign, info, days: daysBetween(meet.start_on, meet.end_on) };
}

// coaching.json for nsea-ops scripts/meet/meet.py: days worked, sessions, mileage, hotel per coach.
export function exportCoaching(d) {
  const byId = Object.fromEntries(d.sessions.map((s) => [s.id, s]));
  return {
    meet: d.meet.name, event_id: d.meet.event_id, status: d.meet.status, exported_at: new Date().toISOString(),
    coaches: d.coaches.map((c) => {
      const mine = d.assign.filter((a) => a.coach_id === c.id && byId[a.session_id]).map((a) => byId[a.session_id]);
      const info = d.info.find((i) => i.coach_id === c.id) || { hotel: '', nights: [] };
      const days = [...new Set(mine.map((s) => s.day))].sort();
      return { name: firstName(c.name), full_name: c.name, days, sessions: mine.length,
        mileage: !!(d.meet.travel && mine.length), hotel: !!(mine.length && info.hotel === 'yes'), hotel_nights: info.hotel === 'yes' ? info.nights : [] };
    }),
  };
}

export async function handleCoachingAdmin(env, me, method, path, body, audit) {
  const manager = isManager(me);
  const mine = await linkedCoach(env, me);
  const myId = mine ? mine.id : null;
  if (!manager && !myId) return fail(403, 'Meet coaching is for coaches with a staff record.');
  const log = (action, detail) => audit('coaching', action, detail);

  if (method === 'GET' && path === '/coaching') {
    const meets = (await env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mc_sessions s WHERE s.meet_id = m.id AND s.removed = 0) sessions,
        (SELECT COUNT(DISTINCT a.coach_id) FROM mc_avail a JOIN mc_sessions s ON s.id = a.session_id WHERE s.meet_id = m.id AND s.removed = 0) answered
      FROM mc_meets m ${manager ? '' : 'WHERE m.open = 1 OR m.end_on >= date(\'now\', \'-30 days\')'} ORDER BY m.start_on DESC LIMIT 60`).all()).results;
    let mineAnswered = [];
    if (myId) mineAnswered = (await env.DB.prepare(`SELECT DISTINCT s.meet_id FROM mc_avail a JOIN mc_sessions s ON s.id = a.session_id WHERE a.coach_id = ?`).bind(myId).all()).results.map((r) => r.meet_id);
    return json({ manager, mineId: myId, meets: meets.map((m) => ({ ...m, mine_answered: mineAnswered.includes(m.id) })) });
  }

  if (method === 'POST' && path === '/coaching') {
    if (!manager) return fail(403, 'Only an owner or the Staff records role can add a meet.');
    const name = clean(body.name, 100), start = clean(body.start_on, 10), end = clean(body.end_on, 10) || start;
    if (!name) return fail(400, 'Please give the meet a name.');
    if (!DATE.test(start) || !DATE.test(end) || end < start) return fail(400, 'Please give the meet’s first and last day.');
    if (daysBetween(start, end).length > 10) return fail(400, 'A meet can be at most 10 days long.');
    const p = parseSessions(body.sessions, start, end);
    if (p.error) return fail(400, p.error);
    const r = await env.DB.prepare(`INSERT INTO mc_meets (name, start_on, end_on, event_id, travel, note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(name, start, end, clean(body.event_id, 80), body.travel === false ? 0 : 1, clean(body.note, 500), me.email, me.email).run();
    const id = r.meta.last_row_id;
    let i = 0;
    for (const s of p.sessions) await env.DB.prepare(`INSERT INTO mc_sessions (meet_id, day, label, sort) VALUES (?, ?, ?, ?)`).bind(id, s.day, s.label, i++).run();
    await log('add meet', name);
    return json({ ok: true, id });
  }

  const m = path.match(/^\/coaching\/(\d+)(?:\/(answers|sessions|assign|export))?$/);
  if (!m) return null;
  const id = +m[1], what = m[2] || '';
  const d = await loadMeet(env, id);
  if (!d) return fail(404, 'That meet is not in Meet Coaching.');

  if (method === 'GET' && !what) return json({ manager, mineId: myId, ...d });
  if (method === 'GET' && what === 'export') {
    if (!manager) return fail(403, 'Only an owner or the Staff records role can export.');
    return json(exportCoaching(d));
  }
  if (method !== 'POST') return null;

  if (!what) { // meet details (manager)
    if (!manager) return fail(403, 'Only an owner or the Staff records role can change a meet.');
    const v = { name: clean(body.name ?? d.meet.name, 100), note: clean(body.note ?? d.meet.note, 500), event_id: clean(body.event_id ?? d.meet.event_id, 80),
      travel: body.travel == null ? d.meet.travel : body.travel ? 1 : 0, open: body.open == null ? d.meet.open : body.open ? 1 : 0,
      status: body.status == null ? d.meet.status : String(body.status) };
    if (!v.name) return fail(400, 'Please give the meet a name.');
    if (!STATUS.includes(v.status)) return fail(400, 'Unknown status.');
    await env.DB.prepare(`UPDATE mc_meets SET name = ?, note = ?, event_id = ?, travel = ?, open = ?, status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(v.name, v.note, v.event_id, v.travel, v.open, v.status, me.email, id).run();
    await log(v.status !== d.meet.status ? `coaching ${v.status}` : 'edit meet', d.meet.name);
    return json({ ok: true });
  }

  if (what === 'sessions') { // replace the session list (manager); sessions taken out keep their answers but disappear
    if (!manager) return fail(403, 'Only an owner or the Staff records role can change sessions.');
    const p = parseSessions(body.sessions, d.meet.start_on, d.meet.end_on);
    if (p.error) return fail(400, p.error);
    const keep = new Set(p.sessions.map((s) => s.id).filter(Boolean));
    for (const s of d.sessions) if (!keep.has(s.id)) await env.DB.prepare(`UPDATE mc_sessions SET removed = 1 WHERE id = ?`).bind(s.id).run();
    let i = 0;
    for (const s of p.sessions) {
      if (s.id && d.sessions.some((x) => x.id === s.id)) await env.DB.prepare(`UPDATE mc_sessions SET day = ?, label = ?, sort = ? WHERE id = ?`).bind(s.day, s.label, i++, s.id).run();
      else await env.DB.prepare(`INSERT INTO mc_sessions (meet_id, day, label, sort) VALUES (?, ?, ?, ?)`).bind(id, s.day, s.label, i++).run();
    }
    await log('edit sessions', d.meet.name);
    return json({ ok: true });
  }

  if (what === 'answers') { // a coach's availability + hotel; managers may answer for anyone
    const coachId = manager && body.coach_id ? +body.coach_id : myId;
    if (!coachId || !d.coaches.some((c) => c.id === coachId)) return fail(400, 'Choose a coach.');
    if (!manager && !d.meet.open) return fail(400, 'This meet is closed for answers. Ask JP to change yours.');
    const sids = new Set(d.sessions.map((s) => s.id));
    for (const [sid, ans] of Object.entries(body.answers || {})) {
      if (!sids.has(+sid)) continue;
      if (ans === '' || ans == null) await env.DB.prepare(`DELETE FROM mc_avail WHERE session_id = ? AND coach_id = ?`).bind(+sid, coachId).run();
      else if (ANSWERS.includes(ans)) await env.DB.prepare(`INSERT INTO mc_avail (session_id, coach_id, answer, by_email) VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id, coach_id) DO UPDATE SET answer = excluded.answer, by_email = excluded.by_email, at = datetime('now')`).bind(+sid, coachId, ans, me.email).run();
    }
    if (body.hotel != null || body.nights != null || body.note != null) {
      const cur = d.info.find((i) => i.coach_id === coachId) || { hotel: '', nights: [], note: '' };
      const hotel = body.hotel == null ? cur.hotel : ['yes', 'no', ''].includes(body.hotel) ? body.hotel : cur.hotel;
      const nights = hotel === 'yes' ? (Array.isArray(body.nights) ? body.nights : cur.nights).filter((n) => d.days.includes(n) && n < d.meet.end_on) : [];
      await env.DB.prepare(`INSERT INTO mc_coach (meet_id, coach_id, hotel, nights, note, by_email) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(meet_id, coach_id) DO UPDATE SET hotel = excluded.hotel, nights = excluded.nights, note = excluded.note, by_email = excluded.by_email, at = datetime('now')`)
        .bind(id, coachId, hotel, nights.join(','), clean(body.note ?? cur.note, 300), me.email).run();
    }
    await log('availability', `${d.meet.name}: ${(d.coaches.find((c) => c.id === coachId) || {}).name}`);
    return json({ ok: true });
  }

  if (what === 'assign') { // JP's assignments: { assign: { sessionId: [coachIds] }, status? }
    if (!manager) return fail(403, 'Only an owner or the Staff records role can assign coaches.');
    const sids = new Set(d.sessions.map((s) => s.id)), cids = new Set(d.coaches.map((c) => c.id));
    for (const [sid, list] of Object.entries(body.assign || {})) {
      if (!sids.has(+sid)) continue;
      await env.DB.prepare(`DELETE FROM mc_assign WHERE session_id = ?`).bind(+sid).run();
      for (const c of (Array.isArray(list) ? list : []).map(Number).filter((c) => cids.has(c)))
        await env.DB.prepare(`INSERT INTO mc_assign (session_id, coach_id, by_email) VALUES (?, ?, ?)`).bind(+sid, c, me.email).run();
    }
    if (body.status != null) {
      if (!STATUS.includes(body.status)) return fail(400, 'Unknown status.');
      await env.DB.prepare(`UPDATE mc_meets SET status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(body.status, me.email, id).run();
    }
    await log('assign coaches', `${d.meet.name}${body.status ? ' (' + body.status + ')' : ''}`);
    return json({ ok: true });
  }
  return null;
}
