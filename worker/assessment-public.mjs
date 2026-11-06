// New swimmer assessment: the family-facing request form API (/api/assessment/*).
// A family submits one or more swimmers (siblings share one contact and one family_ref). Each swimmer's answers run through
// evaluateIntake(): swimmers who should start with lessons are told so and nothing is stored; the rest become requests for staff
// to schedule (or, for Breakers, Surge and Senior, to review). Nothing here confirms a time; a coach or JP does that.
import { json, fail, clean, EMAIL, rand, readRequest } from './util.mjs';
import { evaluateIntake, findDuplicateRequests, GROUP_RULES, EXPERIENCE, COMPETITIVE, HEARD, LEARN_TO_SWIM_URL } from './assessment-intake.mjs';
import { openSlotsFor, parseDate, parseTime, addDays, todayET, NOTICE_DAYS } from './assessment-schedule.mjs';

const MAX_SWIMMERS = 6, MAX_PICKS = 3, MAX_OPEN_NEW = 200, MAX_PER_EMAIL_DAY = 12;

export async function handleAssessmentPublic(req, env, url, now = new Date()) {
  const path = url.pathname.replace('/api/assessment', '').replace(/\/$/, '') || '/';
  const rq = await readRequest(req, url);
  if (rq.error) return rq.error;
  const body = rq.body;
  const today = todayET(now);
  try {
    if (req.method === 'GET' && path === '/options') {
      const slots = await openSlotsFor(env, now);
      return json({ today, earliest: addDays(today, NOTICE_DAYS), slots, groups: GROUP_RULES.map(({ name, min, max }) => ({ name, min, max })), experience: EXPERIENCE, competitive: COMPETITIVE, heard: HEARD, learnToSwimUrl: LEARN_TO_SWIM_URL });
    }
    // Stateless check used as the family fills the form in: where would these answers lead?
    if (req.method === 'POST' && path === '/evaluate') {
      return json({ result: evaluateIntake(body.answers, { asOf: parseDate(body.asOf) || today }) });
    }
    if (req.method === 'POST' && path === '/request') return await submit(env, body, now, today);
  } catch (e) {
    return fail(500, 'Something went wrong on our side. Please email team@nseaswim.com.');
  }
  return fail(404, 'Not found');
}

// Picks are open published slots (by id) at least NOTICE_DAYS out, or requested dates the same distance out.
async function readPicks(env, s, earliest) {
  const out = [];
  for (const id of Array.isArray(s.slotIds) ? s.slotIds : []) {
    const slot = await env.DB.prepare(`SELECT slot_date, start_time, status FROM assess_slots WHERE id = ?`).bind(Number(id)).first();
    if (!slot || slot.status !== 'open' || slot.slot_date < earliest) return { error: 'One of the times you picked is no longer available. Please choose again.' };
    out.push({ date: slot.slot_date, time: slot.start_time });
  }
  for (const d of Array.isArray(s.otherDates) ? s.otherDates : []) {
    const date = parseDate(d && d.date), time = d && d.time ? parseTime(d.time) : '';
    if (!date || time === null) return { error: 'One of the dates you requested is not valid.' };
    if (date < earliest) return { error: 'We need at least a week of notice. Please request a later date.' };
    out.push({ date, time });
  }
  if (out.length > MAX_PICKS) return { error: `Please choose at most ${MAX_PICKS} times for each swimmer.` };
  return { picks: out };
}

async function submit(env, b, now, today) {
  if (clean(b.website, 50)) return json({ ok: true, outcomes: [] }); // honeypot
  const contact_name = clean(b.contact?.name, 80), contact_email = clean(b.contact?.email, 120).toLowerCase(), contact_phone = clean(b.contact?.phone, 30) || null;
  if (!contact_name) return fail(400, 'Please enter the parent or guardian’s name.');
  if (!EMAIL.test(contact_email)) return fail(400, 'Please enter a valid email address.');
  // Optional second point of contact: if anything is filled in, it needs a name and a valid email.
  const c2 = b.contact2 || {}, contact2_name = clean(c2.name, 80), contact2_email = clean(c2.email, 120).toLowerCase(), contact2_phone = clean(c2.phone, 30) || null;
  const hasC2 = !!(contact2_name || contact2_email || contact2_phone);
  if (hasC2 && !contact2_name) return fail(400, 'Second contact: please enter a name, or clear that section.');
  if (hasC2 && !EMAIL.test(contact2_email)) return fail(400, 'Second contact: please enter a valid email address, or clear that section.');
  const list = Array.isArray(b.swimmers) ? b.swimmers : [];
  if (!list.length) return fail(400, 'Please add at least one swimmer.');
  if (list.length > MAX_SWIMMERS) return fail(400, `Please send at most ${MAX_SWIMMERS} swimmers at a time. You can submit again for more.`);

  const earliest = addDays(today, NOTICE_DAYS);
  const planned = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {}, name = clean(s.name, 80), label = name || `Swimmer ${i + 1}`;
    if (!name) return fail(400, `Swimmer ${i + 1}: please enter the swimmer’s name.`);
    const pk = await readPicks(env, s, earliest);
    if (pk.error) return fail(409, `${label}: ${pk.error}`);
    const answers = { ...(s.answers || {}), heard: b.heard || (s.answers && s.answers.heard) };
    const r = evaluateIntake(answers, { asOf: pk.picks.length ? pk.picks.map((p) => p.date).sort()[0] : today });
    if (!r.ok) return json({ error: `${label}: ${r.errors[0].message}`, swimmer: i, errors: r.errors }, 400);
    const background = clean(s.background, 1500);
    if (r.path === 'background_review' && !background) return json({ error: `${label}: please tell us about the swimmer’s swimming background.`, swimmer: i, errors: [{ field: 'background' }] }, 400);
    if (r.path === 'schedule' && !pk.picks.length) return json({ error: `${label}: please choose at least one time that could work.`, swimmer: i, errors: [{ field: 'times' }] }, 400);
    planned.push({ name, r, answers, background, picks: pk.picks });
  }

  const storing = planned.filter((p) => p.r.path !== 'learn_to_swim');
  if (storing.length) {
    const open = await env.DB.prepare(`SELECT COUNT(*) n FROM assess_requests WHERE status = 'new'`).first();
    if (open.n + storing.length > MAX_OPEN_NEW) return fail(429, 'We have a lot of requests waiting. Please email team@nseaswim.com.');
    const day = await env.DB.prepare(`SELECT COUNT(*) n FROM assess_requests WHERE source = 'form' AND lower(contact_email) = ? AND created_at > datetime('now', '-1 day')`).bind(contact_email).first();
    if (day.n + storing.length > MAX_PER_EMAIL_DAY) return fail(429, 'We already have several requests from this email address. Please email team@nseaswim.com.');
  }

  const family_ref = rand(9);
  const outcomes = [];
  for (const p of planned) {
    if (p.r.path === 'learn_to_swim') { outcomes.push({ name: p.name, path: 'learn_to_swim', messages: p.r.familyMessages }); continue; }
    const flags = [...p.r.flags];
    for (const d of await findDuplicateRequests(env, { swimmerName: p.name, email: contact_email })) {
      flags.push({ code: 'duplicate_request', level: 'review', message: `Possible duplicate of request #${d.id} (${d.status}).` });
    }
    const intake = { experience: p.answers.experience, competitive: p.r.followups.map((f) => ({ type: f.type, label: f.label, ...((p.answers.details && p.answers.details[f.type]) || {}) })),
      formerNsea: !!p.answers.formerNsea, formerNseaWhen: clean(p.answers.formerNseaWhen, 80) || null, otherTeam: !!p.answers.otherTeam, otherTeamName: clean(p.answers.otherTeamName, 80) || null, heard: p.r.heard || null, unsure: !!p.answers.unsure };
    for (const f of intake.competitive) for (const k of Object.keys(f)) if (typeof f[k] === 'string') f[k] = clean(f[k], 300);
    const res = await env.DB.prepare(
      `INSERT INTO assess_requests (source, contact_name, contact_email, contact_phone, swimmer_name, swimmer_age, notes, preferred, family_ref, dob, path, assess_for, groups_asked, intake, flags, contact2_name, contact2_email, contact2_phone)
       VALUES ('form', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(contact_name, contact_email, contact_phone, p.name, p.r.age, p.background || null, p.picks.length ? JSON.stringify(p.picks) : null, family_ref, p.answers.dob,
      p.r.path, p.r.assessFor || null, JSON.stringify(p.r.groupsChosen || []), JSON.stringify(intake), JSON.stringify(flags),
      hasC2 ? contact2_name : null, hasC2 ? contact2_email : null, hasC2 ? contact2_phone : null).run();
    outcomes.push({ name: p.name, path: p.r.path, requestNumber: res.meta.last_row_id, messages: p.r.familyMessages });
  }
  return json({ ok: true, outcomes });
}
