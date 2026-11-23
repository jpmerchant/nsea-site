// Meet Coaching: real migrations in in-memory SQLite, driving the coaching API end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleCoachingAdmin, daysBetween, exportCoaching } = await import('../worker/coaching.mjs');

function env() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }) });
  return { db, DB: { prepare: (sql) => { const p = prep(sql); return { bind: p.bind, first: () => p.bind().first(), all: () => p.bind().all(), run: () => p.bind().run() }; } } };
}
const JP = { email: 'jp@nseaswim.com', roles: ['owner'] };
const RACHEL = { email: 'rachel@nseaswim.com', roles: ['coach'] };
const PARENT = { email: 'parent@example.com', roles: ['carpool'] };
const call = async (e, me, method, path, body = {}) => { const r = await handleCoachingAdmin(e, me, method, path, body, async () => {}); return { status: r.status, json: await r.json() }; };
const idOf = (e, email) => e.db.prepare('SELECT id FROM coach_authors WHERE email = ?').get(email).id;

test('daysBetween covers the meet', () => {
  assert.deepEqual(daysBetween('2026-12-11', '2026-12-13'), ['2026-12-11', '2026-12-12', '2026-12-13']);
});

test('JP adds a meet, coaches answer by session with hotel nights, JP assigns and exports coaching.json', { skip: !DatabaseSync }, async () => {
  const e = env(), rid = idOf(e, 'rachel@nseaswim.com'), jid = idOf(e, 'jp@nseaswim.com');
  assert.equal((await call(e, PARENT, 'GET', '/coaching')).status, 403);
  assert.equal((await call(e, RACHEL, 'POST', '/coaching', { name: 'X', start_on: '2026-12-11', end_on: '2026-12-13' })).status, 403);
  const bad = await call(e, JP, 'POST', '/coaching', { name: 'STAR', start_on: '2026-12-11', end_on: '2026-12-13', sessions: [{ day: '2026-12-20', label: 'Prelims' }] });
  assert.equal(bad.status, 400);
  const add = await call(e, JP, 'POST', '/coaching', { name: '2026 STAR Triad Tropic', start_on: '2026-12-11', end_on: '2026-12-13', event_id: 'star-triad-tropic',
    sessions: [{ day: '2026-12-11', label: 'Distance' }, { day: '2026-12-12', label: 'Prelims' }, { day: '2026-12-12', label: 'Finals' }, { day: '2026-12-13', label: 'Prelims' }, { day: '2026-12-13', label: 'Finals' }] });
  const id = add.json.id;
  let d = (await call(e, RACHEL, 'GET', `/coaching/${id}`)).json;
  assert.equal(d.sessions.length, 5); assert.equal(d.manager, false); assert.equal(d.mineId, rid);
  const [fri, satP, satF] = d.sessions;
  // Rachel answers for herself only, even if she names another coach
  const r = await call(e, RACHEL, 'POST', `/coaching/${id}/answers`, { coach_id: jid, answers: { [fri.id]: 'no', [satP.id]: 'yes', [satF.id]: 'maybe' }, hotel: 'yes', nights: ['2026-12-11', '2026-12-12', '2026-12-13'] });
  assert.equal(r.status, 200);
  d = (await call(e, JP, 'GET', `/coaching/${id}`)).json;
  assert.equal(d.avail.filter((a) => a.coach_id === rid).length, 3); assert.equal(d.avail.filter((a) => a.coach_id === jid).length, 0);
  assert.deepEqual(d.info.find((i) => i.coach_id === rid).nights, ['2026-12-11', '2026-12-12']); // no room the night the meet ends
  // list shows she answered
  assert.equal((await call(e, RACHEL, 'GET', '/coaching')).json.meets[0].mine_answered, true);
  // only managers assign / export
  assert.equal((await call(e, RACHEL, 'POST', `/coaching/${id}/assign`, { assign: {} })).status, 403);
  assert.equal((await call(e, RACHEL, 'GET', `/coaching/${id}/export`)).status, 403);
  await call(e, JP, 'POST', `/coaching/${id}/assign`, { assign: { [satP.id]: [rid, jid], [satF.id]: [rid], [fri.id]: [jid] }, status: 'preliminary' });
  const x = (await call(e, JP, 'GET', `/coaching/${id}/export`)).json;
  assert.equal(x.status, 'preliminary');
  const rach = x.coaches.find((c) => c.name === 'Rachel'), jp = x.coaches.find((c) => c.name === 'JP');
  assert.deepEqual(rach.days, ['2026-12-12']); assert.equal(rach.sessions, 2); assert.equal(rach.hotel, true); assert.equal(rach.mileage, true);
  assert.deepEqual(jp.days, ['2026-12-11', '2026-12-12']); assert.equal(jp.sessions, 2); assert.equal(jp.hotel, false);
  assert.equal(x.coaches.find((c) => c.name === 'Devin').sessions, 0);
  // closing the meet stops coach answers; JP can still answer for anyone
  await call(e, JP, 'POST', `/coaching/${id}`, { open: false });
  assert.equal((await call(e, RACHEL, 'POST', `/coaching/${id}/answers`, { answers: { [fri.id]: 'yes' } })).status, 400);
  assert.equal((await call(e, JP, 'POST', `/coaching/${id}/answers`, { coach_id: rid, answers: { [fri.id]: 'yes' } })).status, 200);
  // removing a session hides it and its assignments from the export
  await call(e, JP, 'POST', `/coaching/${id}/sessions`, { sessions: d.sessions.filter((s) => s.id !== satF.id) });
  const y = (await call(e, JP, 'GET', `/coaching/${id}/export`)).json;
  assert.equal(y.coaches.find((c) => c.name === 'Rachel').sessions, 1);
});

test('home meets claim no mileage', () => {
  const d = { meet: { name: 'Intersquad', event_id: '', status: 'confirmed', travel: 0 }, sessions: [{ id: 1, day: '2027-01-10', label: 'AM' }],
    coaches: [{ id: 7, name: 'JP Merchant' }], assign: [{ session_id: 1, coach_id: 7 }], info: [] };
  const c = exportCoaching(d).coaches[0];
  assert.equal(c.name, 'JP'); assert.equal(c.mileage, false); assert.equal(c.sessions, 1);
});
