// Drives the family-facing assessment request API against the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleAssessmentPublic } = await import('../worker/assessment-public.mjs');
const { handleScheduleAdmin } = await import('../worker/assessment-schedule.mjs');

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const stmt = (sql, b = []) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _run: () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    bind: (...nb) => stmt(sql, nb)
  });
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s._run()) } };
}
const NOW = new Date('2026-11-09T15:00:00Z'); // Mon Nov 9 2026, 10:00 Eastern
const call = async (env, method, path, body) => {
  const req = new Request('https://x.test/api/assessment' + path, { method, headers: { origin: 'https://x.test', 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  const r = await handleAssessmentPublic(req, env, new URL(req.url), NOW);
  return { status: r.status, json: await r.json() };
};
const addSlot = (db, date, time, status = 'open') => Number(db.prepare(`INSERT INTO assess_slots (slot_date, start_time, status) VALUES (?, ?, ?)`).run(date, time, status).lastInsertRowid);
const contact = { name: 'Pat Lee', email: 'Pat@Example.com', phone: '555-1212' };
const kid = (o = {}) => ({ name: 'Ava', answers: { dob: '2018-03-01', experience: 'lessons', groups: ['Splash'] }, ...o });
const T = { skip: !DatabaseSync };

test('options list only slots a week or more out', T, async () => {
  const { db, DB } = d1();
  addSlot(db, '2026-11-12', '16:00'); const ok = addSlot(db, '2026-11-17', '16:00'); addSlot(db, '2026-11-18', '16:00', 'booked');
  const r = await call({ DB }, 'GET', '/options');
  assert.deepEqual(r.json.slots.map((s) => s.id), [ok]);
  assert.equal(r.json.earliest, '2026-11-16');
  assert.ok(r.json.groups.length === 6 && r.json.learnToSwimUrl);
});

test('evaluate is stateless and returns the intake result', T, async () => {
  const { db, DB } = d1();
  const r = await call({ DB }, 'POST', '/evaluate', { answers: { dob: '2018-03-01', experience: 'none', groups: [] } });
  assert.equal(r.json.result.path, 'learn_to_swim');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM assess_requests').get().n, 0);
});

test('a swimmer is stored with intake details and the chosen slot', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  const r = await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id] })], heard: 'friend' });
  assert.equal(r.status, 200);
  assert.equal(r.json.outcomes[0].path, 'schedule');
  const row = db.prepare('SELECT * FROM assess_requests').get();
  assert.equal(row.source, 'form'); assert.equal(row.status, 'new'); assert.equal(row.contact_email, 'pat@example.com');
  assert.equal(row.dob, '2018-03-01'); assert.equal(row.assess_for, 'Splash'); assert.equal(row.swimmer_age, 8);
  assert.deepEqual(JSON.parse(row.preferred), [{ date: '2026-11-17', time: '16:00' }]);
  assert.equal(JSON.parse(row.intake).heard, 'friend');
  assert.equal(db.prepare("SELECT status FROM assess_slots WHERE id = ?").get(id).status, 'open'); // a request does not book the slot
});

test('siblings share a family ref and may ask for different times', T, async () => {
  const { db, DB } = d1(); const a = addSlot(db, '2026-11-17', '16:00'), b = addSlot(db, '2026-11-17', '16:15');
  const r = await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [a] }), kid({ name: 'Ben', slotIds: [b] })] });
  assert.equal(r.json.outcomes.length, 2);
  const rows = db.prepare('SELECT family_ref, preferred FROM assess_requests ORDER BY id').all();
  assert.equal(rows[0].family_ref, rows[1].family_ref); assert.notEqual(rows[0].preferred, rows[1].preferred);
});

test('a swimmer who should start with lessons is not stored', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  const r = await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ name: 'New', answers: { dob: '2018-03-01', experience: 'none', groups: [] } }), kid({ slotIds: [id] })] });
  assert.deepEqual(r.json.outcomes.map((o) => o.path), ['learn_to_swim', 'schedule']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM assess_requests').get().n, 1);
});

test('Breakers and up need a background note and take no times', T, async () => {
  const { db, DB } = d1();
  const answers = { dob: '2011-03-01', experience: 'lessons', groups: ['Breakers'] };
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ answers })] })).status, 400);
  const r = await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ answers, background: 'Swam two seasons of summer league.' })] });
  assert.equal(r.json.outcomes[0].path, 'background_review');
  const row = db.prepare('SELECT * FROM assess_requests').get();
  assert.equal(row.path, 'background_review'); assert.equal(row.preferred, null); assert.match(row.notes, /summer league/);
});

test('times: slot must be open and a week out; other dates need a week of notice', T, async () => {
  const { db, DB } = d1(); const soon = addSlot(db, '2026-11-12', '16:00'), booked = addSlot(db, '2026-11-20', '16:00', 'booked'), ok = addSlot(db, '2026-11-20', '16:15');
  for (const slotIds of [[soon], [booked], [99999]]) assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds })] })).status, 409);
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ otherDates: [{ date: '2026-11-12' }] })] })).status, 409);
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid()] })).status, 400); // no time at all
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [ok], otherDates: [{ date: '2026-11-30', time: '16:00' }] })] })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM assess_requests').get().n, 1);
});

test('validation: contact, names, answers, honeypot', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  assert.equal((await call({ DB }, 'POST', '/request', { contact: { name: '', email: 'a@b.co' }, swimmers: [kid({ slotIds: [id] })] })).status, 400);
  assert.equal((await call({ DB }, 'POST', '/request', { contact: { name: 'P', email: 'nope' }, swimmers: [kid({ slotIds: [id] })] })).status, 400);
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [] })).status, 400);
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ name: '', slotIds: [id] })] })).status, 400);
  const bad = await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id], answers: { experience: 'lessons' } })] });
  assert.equal(bad.status, 400); assert.equal(bad.json.swimmer, 0);
  const spam = await call({ DB }, 'POST', '/request', { website: 'http://spam', contact, swimmers: [kid({ slotIds: [id] })] });
  assert.equal(spam.status, 200); assert.equal(db.prepare('SELECT COUNT(*) n FROM assess_requests').get().n, 0);
});

test('a repeat submission is stored but flagged as a possible duplicate', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id] })] });
  await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id] })] });
  const second = JSON.parse(db.prepare('SELECT flags FROM assess_requests WHERE id = 2').get().flags);
  assert.ok(second.some((f) => f.code === 'duplicate_request' && /#1/.test(f.message)));
});

test('limits: swimmers per submission and requests per email per day', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: Array.from({ length: 7 }, (_, i) => kid({ name: 'S' + i, slotIds: [id] })) })).status, 400);
  for (let i = 0; i < 12; i++) db.prepare(`INSERT INTO assess_requests (source, contact_name, contact_email, swimmer_name) VALUES ('form','P','pat@example.com','K${i}')`).run();
  assert.equal((await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id] })] })).status, 429);
});

test('the staff queue sees flags, groups and intake details', T, async () => {
  const { db, DB } = d1(); const id = addSlot(db, '2026-11-17', '16:00');
  await call({ DB }, 'POST', '/request', { contact, swimmers: [kid({ slotIds: [id], answers: { dob: '2018-03-01', experience: 'competitive', recentTeam: 'Waves', competitive: ['summer_league'], details: { summer_league: { team: 'Waves', years: 2 } }, groups: ['Splash', 'Tidepool'] } })] });
  const r = await handleScheduleAdmin({ DB }, { email: 'c@x' }, 'GET', '/assessment/schedule', {}, async () => {}, NOW);
  const req = (await r.json()).requests[0];
  assert.deepEqual(req.flags.map((f) => f.code), ['competitive_experience', 'multiple_groups']);
  assert.deepEqual(req.groups_asked, ['Splash', 'Tidepool']); assert.equal(req.assess_for, 'Tidepool'); assert.equal(req.intake.competitive[0].team, 'Waves'); assert.equal(req.intake.recentTeam, 'Waves');
});

test('an optional second contact is stored on every sibling, and validated if given', T, async () => {
  const { db, DB } = d1(); const a = addSlot(db, '2026-11-17', '16:00'), b = addSlot(db, '2026-11-17', '16:15');
  const two = { name: 'Sam Lee', email: 'Sam@Example.com', phone: '555-0000' };
  const send = (c2, kids = [kid({ slotIds: [a] })]) => call({ DB }, 'POST', '/request', { contact, contact2: c2, swimmers: kids });
  assert.equal((await send({ name: 'Sam' })).status, 400);                   // name without email
  assert.equal((await send({ name: 'Sam', email: 'nope' })).status, 400);
  assert.equal((await send({ email: 'sam@example.com' })).status, 400);      // email without name
  assert.equal((await send({ name: '', email: '', phone: '' })).status, 200); // blank section is fine
  assert.equal(db.prepare('SELECT contact2_email e FROM assess_requests').get().e, null);
  db.exec('DELETE FROM assess_requests');
  assert.equal((await send(two, [kid({ slotIds: [a] }), kid({ name: 'Ben', slotIds: [b] })])).status, 200);
  const rows = db.prepare('SELECT contact2_name n, contact2_email e, contact2_phone p FROM assess_requests').all();
  assert.deepEqual(rows.map((r) => [r.n, r.e, r.p]), [['Sam Lee', 'sam@example.com', '555-0000'], ['Sam Lee', 'sam@example.com', '555-0000']]);
});
