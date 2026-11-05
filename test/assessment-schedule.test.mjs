// Drives the on-demand assessment scheduling (availability slots, requests, scheduling) against the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const S = await import('../worker/assessment-schedule.mjs');
const { handleAssessmentAdmin } = await import('../worker/assessment.mjs');

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
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._run()) } };
}
const me = { email: 'coach@nseaswim.com', roles: ['assessment'] };
const log = [];
const audit = async (m, a, d) => { log.push([m, a, d]); };
// "Now" is Mon Nov 9 2026, 10:00 Eastern. Slots are created for later dates.
const NOW = new Date('2026-11-09T15:00:00Z');
const call = async (env, method, path, body = {}) => { const r = await S.handleScheduleAdmin(env, me, method, path, body, audit, NOW); return { status: r.status, json: await r.json() }; };
const fam = (o = {}) => ({ swimmer_name: 'Ava', swimmer_age: 7, contact_name: 'Pat Lee', contact_email: 'pat@example.com', ...o });

test('date and time parsing', () => {
  assert.equal(S.parseDate('2026-11-17'), '2026-11-17');
  for (const bad of ['2026-02-30', '11/17/2026', '', null, '2026-13-01']) assert.equal(S.parseDate(bad), null, String(bad));
  assert.equal(S.parseTime('4:00'), '04:00'); assert.equal(S.parseTime('16:15'), '16:15');
  for (const bad of ['16:07', '24:00', '9', 'abc', '']) assert.equal(S.parseTime(bad), null, bad);
  assert.equal(S.todayET(NOW), '2026-11-09');
  assert.equal(S.todayET(new Date('2026-11-10T03:30:00Z')), '2026-11-09'); // still the 9th in Eastern
  assert.equal(S.addDays('2026-11-30', 1), '2026-12-01');
});

test('expandSlots: weekdays, times and limits', () => {
  const ok = S.expandSlots({ from: '2026-11-16', to: '2026-11-27', weekdays: [2, 4], times: '16:00, 16:15' }, '2026-11-09');
  assert.deepEqual(ok.slots.map((s) => s.join(' ')), ['2026-11-17 16:00', '2026-11-17 16:15', '2026-11-19 16:00', '2026-11-19 16:15', '2026-11-24 16:00', '2026-11-24 16:15', '2026-11-26 16:00', '2026-11-26 16:15']);
  assert.match(S.expandSlots({ from: '2026-11-01', to: '2026-11-30', weekdays: [1], times: '16:00' }, '2026-11-09').error, /today or later/);
  assert.match(S.expandSlots({ from: '2026-11-20', to: '2026-11-10', weekdays: [1], times: '16:00' }, '2026-11-09').error, /before/);
  assert.match(S.expandSlots({ from: '2026-11-16', to: '2026-11-17', weekdays: [], times: '16:00' }, '2026-11-09').error, /day of the week/);
  assert.match(S.expandSlots({ from: '2026-11-16', to: '2026-11-17', weekdays: [1], times: '16:07' }, '2026-11-09').error, /start times/);
  assert.match(S.expandSlots({ from: '2026-11-16', to: '2026-11-18', weekdays: [4], times: '16:00' }, '2026-11-09').error, /None of those dates/);
  assert.match(S.expandSlots({ from: '2026-11-16', to: '2027-06-01', weekdays: [1], times: '16:00' }, '2026-11-09').error, /at most 120/);
});

test('request parsing', () => {
  const ok = S.parseRequest({ ...fam(), preferred: [{ date: '2026-11-20', time: '16:00' }, { date: '2026-11-21' }] });
  assert.equal(ok.contact_email, 'pat@example.com'); assert.equal(JSON.parse(ok.preferred).length, 2);
  assert.match(S.parseRequest(fam({ swimmer_name: '' })).error, /swimmer/);
  assert.match(S.parseRequest(fam({ contact_email: 'nope' })).error, /email/);
  assert.match(S.parseRequest(fam({ swimmer_age: 'x' })).error, /age/);
  assert.match(S.parseRequest(fam({ preferred: [1, 2, 3, 4].map(() => ({ date: '2026-11-20' })) })).error, /three/);
  assert.match(S.parseRequest(fam({ preferred: [{ date: 'soon' }] })).error, /valid date/);
});

test('availability, requests, scheduling, rescheduling and cancelling', { skip: !DatabaseSync }, async () => {
  const env = d1();
  let r = await call(env, 'POST', '/assessment/slots', { from: '2026-11-16', to: '2026-11-27', weekdays: [2, 4], times: '16:00,16:15' });
  assert.equal(r.json.added, 8);
  r = await call(env, 'POST', '/assessment/slots', { from: '2026-11-16', to: '2026-11-18', weekdays: [2], times: '16:00,16:30' });
  assert.deepEqual([r.json.added, r.json.skipped], [1, 1], 'existing slots are not duplicated');

  // Families only see slots a week out or more: today is Mon Nov 9, so Nov 16 is the first bookable day.
  assert.equal((await S.openSlotsFor(env, NOW)).length, 9);
  assert.equal((await S.openSlotsFor(env, new Date('2026-11-17T15:00:00Z'))).filter((s) => s.slot_date < '2026-11-24').length, 0);

  r = await call(env, 'POST', '/assessment/requests', fam({ preferred: [{ date: '2026-11-17', time: '16:00' }] }));
  assert.equal(r.status, 200); const a = r.json.id;
  r = await call(env, 'POST', '/assessment/requests', fam({ swimmer_name: 'Ben', contact_email: 'sam@example.com' }));
  const b = r.json.id;
  assert.equal((await call(env, 'POST', '/assessment/requests', fam({ contact_email: 'bad' }))).status, 400);

  let sched = (await call(env, 'GET', '/assessment/schedule')).json;
  assert.equal(sched.requests.filter((x) => x.status === 'new').length, 2);
  assert.deepEqual(sched.requests.find((x) => x.id === a).preferred, [{ date: '2026-11-17', time: '16:00' }]);
  const slot1 = sched.slots.find((s) => s.slot_date === '2026-11-17' && s.start_time === '16:00');

  // Schedule A into a published slot.
  r = await call(env, 'POST', `/assessment/requests/${a}/schedule`, { slot_id: slot1.id });
  assert.equal(r.status, 200);
  sched = (await call(env, 'GET', '/assessment/schedule')).json;
  const booked = sched.slots.find((s) => s.id === slot1.id);
  assert.deepEqual([booked.status, booked.swimmer_name], ['booked', 'Ava']);
  const ra = sched.requests.find((x) => x.id === a);
  assert.deepEqual([ra.status, ra.appt_date, ra.appt_time, ra.confirmed_by], ['scheduled', '2026-11-17', '16:00', 'coach@nseaswim.com']);

  // One swimmer per time: B cannot take A's slot, by slot or by typing the same date and time.
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/schedule`, { slot_id: slot1.id })).status, 409);
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/schedule`, { date: '2026-11-17', time: '16:00' })).status, 409);

  // A custom time that matches an open slot books that slot; one that matches none is allowed and slot-less.
  r = await call(env, 'POST', `/assessment/requests/${b}/schedule`, { date: '2026-11-17', time: '16:15' });
  assert.equal(r.status, 200);
  sched = (await call(env, 'GET', '/assessment/schedule')).json;
  assert.equal(sched.slots.find((s) => s.slot_date === '2026-11-17' && s.start_time === '16:15').status, 'booked');
  r = await call(env, 'POST', `/assessment/requests/${b}/schedule`, { date: '2026-12-02', time: '17:45' });
  assert.equal(r.status, 200);
  sched = (await call(env, 'GET', '/assessment/schedule')).json;
  assert.equal(sched.slots.find((s) => s.slot_date === '2026-11-17' && s.start_time === '16:15').status, 'open', 'rescheduling frees the old slot');
  assert.equal(sched.requests.find((x) => x.id === b).slot_id, null);

  // Validation: past dates, bad times, unknown slot.
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/schedule`, { date: '2026-11-02', time: '16:00' })).status, 400);
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/schedule`, { date: '2026-12-02', time: '17:47' })).status, 400);
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/schedule`, { slot_id: 99999 })).status, 404);

  // A booked slot cannot be removed; an open one can.
  assert.equal((await call(env, 'POST', `/assessment/slots/${slot1.id}/remove`)).status, 409);
  const open = sched.slots.find((s) => s.status === 'open');
  assert.equal((await call(env, 'POST', `/assessment/slots/${open.id}/remove`)).status, 200);

  // Cancel frees the slot; closed requests can't be scheduled again.
  assert.equal((await call(env, 'POST', `/assessment/requests/${a}/cancel`, { note: 'Family moved' })).status, 200);
  sched = (await call(env, 'GET', '/assessment/schedule')).json;
  assert.equal(sched.slots.find((s) => s.id === slot1.id).status, 'open');
  assert.equal(sched.requests.find((x) => x.id === a).status, 'cancelled');
  assert.equal((await call(env, 'POST', `/assessment/requests/${a}/schedule`, { slot_id: slot1.id })).status, 409);

  // Decline only applies to new requests.
  r = await call(env, 'POST', '/assessment/requests', fam({ swimmer_name: 'Cy' }));
  assert.equal((await call(env, 'POST', `/assessment/requests/${r.json.id}/decline`, { note: 'Over 18' })).status, 200);
  assert.equal((await call(env, 'POST', `/assessment/requests/${b}/decline`)).status, 409);
  assert.equal((await call(env, 'POST', '/assessment/requests/9999/cancel')).status, 404);

  // The audit log never carries the swimmer's name.
  assert.ok(log.length > 5);
  assert.ok(!JSON.stringify(log).includes('Ava') && !JSON.stringify(log).includes('Ben'));
});

test('the assessment router sends scheduling paths here and still falls through', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const res = await handleAssessmentAdmin(env, me, 'GET', '/assessment/schedule', {}, audit);
  assert.equal(res.status, 200);
  assert.equal(await handleAssessmentAdmin(env, me, 'GET', '/assessment/nothing', {}, audit), null);
});
