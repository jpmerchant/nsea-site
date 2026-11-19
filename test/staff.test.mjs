// Staff Records: runs the real migrations in in-memory SQLite and drives the staff API end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleStaffAdmin, yearsWith } = await import('../worker/staff.mjs');
const { handleContent } = await import('../worker/content.mjs');
const { handleCoachAdmin } = await import('../worker/coach.mjs');

function env() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }) });
  const store = new Map();
  const REPORTS = {
    put: async (k, v, o) => { store.set(k, { v, type: o.httpMetadata.contentType }); },
    get: async (k) => (store.has(k) ? { body: store.get(k).v, httpMetadata: { contentType: store.get(k).type } } : null),
  };
  return { db, store, REPORTS, DB: { prepare: (sql) => { const p = prep(sql); return { bind: p.bind, first: () => p.bind().first(), all: () => p.bind().all(), run: () => p.bind().run() }; } } };
}
const JP = { email: 'jp@nseaswim.com', roles: ['owner'] };
const RACHEL = { email: 'rachel@nseaswim.com', roles: ['coach'] };
const CARPOOL = { email: 'parent@example.com', roles: ['carpool'] };
const call = async (e, me, method, path, body = {}) => { const r = await handleStaffAdmin(e, me, method, path, body, async () => {}); return { status: r.status, json: r.headers.get('content-type') === 'application/json' ? await r.json() : null, res: r }; };
const pub = async (e, path = '/staff') => { const u = new URL('https://x.test/api/content' + path); return handleContent(new Request(u), e, u); };
const idOf = (e, email) => e.db.prepare('SELECT id FROM coach_authors WHERE email = ?').get(email).id;
const PNG = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');

test('seeded from the old Coaching Staff page; public page shows only published fields', { skip: !DatabaseSync }, async () => {
  const e = env();
  const d = await (await pub(e)).json();
  assert.deepEqual(d.coaches.map((c) => c.name), ['JP Merchant', 'Devin Lessard', 'Andy Harrison', 'Genny Hauser', 'Rachel Soubier']);
  const jp = d.coaches[0];
  assert.equal(jp.phone, '910-338-9455'); assert.deepEqual(jp.groups, ['Tidepool', 'Surge', 'Senior']);
  assert.match(jp.bio, /Southeast Michigan/); assert.equal(jp.dob, undefined); assert.equal(jp.notes, undefined);
  assert.equal(d.coaches[4].photo_alt, 'Coach Rachel Soubier on the pool deck at Earl Jackson Pool');
});

test('a coach edits their own record: private fields save, public-facing ones wait for an OK', { skip: !DatabaseSync }, async () => {
  const e = env(), rid = idOf(e, 'rachel@nseaswim.com'), jid = idOf(e, 'jp@nseaswim.com');
  assert.equal((await call(e, RACHEL, 'GET', `/staff/${jid}`)).status, 403);
  assert.equal((await call(e, CARPOOL, 'GET', `/staff/${rid}`)).status, 403);
  const list = await call(e, RACHEL, 'GET', '/staff');
  assert.equal(list.json.coaches.length, 1); assert.equal(list.json.manager, false);
  // notes are hidden from the coach
  await call(e, JP, 'POST', `/staff/${rid}`, { notes: 'Contract renews in May' });
  assert.equal((await call(e, RACHEL, 'GET', `/staff/${rid}`)).json.coach.notes, undefined);
  assert.equal((await call(e, JP, 'GET', `/staff/${rid}`)).json.coach.notes, 'Contract renews in May');
  // coach cannot change manager-only fields
  const r = await call(e, RACHEL, 'POST', `/staff/${rid}`, { dob: '2003-04-05', bio: 'New bio.', role: 'Head Coach', phone: '910-555-0100' });
  assert.equal(r.json.queued, true);
  const row = e.db.prepare('SELECT dob, bio, role, phone FROM coach_authors WHERE id = ?').get(rid);
  assert.equal(row.dob, '2003-04-05'); assert.equal(row.phone, '910-555-0100'); // phone is not published for Rachel, so it saves now
  assert.equal(row.role, 'Assistant Coach'); assert.notEqual(row.bio, 'New bio.');
  const q = (await call(e, JP, 'GET', '/staff')).json.queue;
  assert.equal(q.changes.length, 1); assert.deepEqual(q.changes[0].json, { bio: 'New bio.' });
  // a second edit folds into the same pending change
  await call(e, RACHEL, 'POST', `/staff/${rid}`, { subtitle: 'Distance' });
  const q2 = (await call(e, JP, 'GET', '/staff')).json.queue;
  assert.equal(q2.changes.length, 1); assert.deepEqual(q2.changes[0].json, { bio: 'New bio.', subtitle: 'Distance' });
  assert.equal((await call(e, RACHEL, 'POST', `/staff/changes/${q2.changes[0].id}/approve`)).status, 403);
  assert.equal((await call(e, JP, 'POST', `/staff/changes/${q2.changes[0].id}/approve`)).status, 200);
  const live = (await (await pub(e)).json()).coaches.find((c) => c.name === 'Rachel Soubier');
  assert.equal(live.bio, 'New bio.'); assert.equal(live.subtitle, 'Distance'); assert.equal(live.dob, undefined);
  const hist = (await call(e, JP, 'GET', `/staff/${rid}/history`)).json.history.map((h) => h.action);
  assert.ok(hist.includes('approve profile change') && hist.includes('edit own record (private)'));
  assert.ok(!JSON.stringify((await call(e, JP, 'GET', `/staff/${rid}/history`)).json).includes('2003-04-05'), 'date of birth is not written into the history');
});

test('record items: private by default, a coach’s published item waits, nothing is hard-deleted', { skip: !DatabaseSync }, async () => {
  const e = env(), rid = idOf(e, 'rachel@nseaswim.com');
  assert.equal((await call(e, RACHEL, 'POST', `/staff/${rid}/items`, { kind: 'bogus', title: 'x' })).status, 400);
  await call(e, RACHEL, 'POST', `/staff/${rid}/items`, { kind: 'certification', title: 'Water Safety Instructor', org: 'American Red Cross', year: 2024 });
  const w = await call(e, RACHEL, 'POST', `/staff/${rid}/items`, { kind: 'membership', title: 'Member', org: 'ASCA', rank: 'Level 2', level: 'national', year: 2025, publish: true });
  assert.equal(w.json.waiting, true);
  let d = (await (await pub(e)).json()).coaches.find((c) => c.name === 'Rachel Soubier');
  assert.equal(d.items.length, 0);
  const q = (await call(e, JP, 'GET', '/staff')).json.queue;
  assert.equal(q.items.length, 1);
  await call(e, JP, 'POST', `/staff/items/${q.items[0].id}/approve`);
  d = (await (await pub(e)).json()).coaches.find((c) => c.name === 'Rachel Soubier');
  assert.deepEqual(d.items.map((i) => [i.title, i.org, i.rank]), [['Member', 'ASCA', 'Level 2']]);
  // an owner's item publishes straight away; a season record keeps its year
  await call(e, JP, 'POST', `/staff/${rid}/items`, { kind: 'season', title: '2026–27', detail: 'Breakers and Surge', year: 2026, publish: true });
  d = (await (await pub(e)).json()).coaches.find((c) => c.name === 'Rachel Soubier');
  assert.equal(d.items.length, 2);
  // remove keeps the row for the record and an owner can restore it
  const item = (await call(e, JP, 'GET', `/staff/${rid}`)).json.items.find((i) => i.kind === 'season');
  await call(e, RACHEL, 'POST', `/staff/${rid}/items/${item.id}/remove`);
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM staff_items WHERE id = ?').get(item.id).n, 1);
  assert.equal((await call(e, RACHEL, 'POST', `/staff/${rid}/items/${item.id}/restore`)).status, 403);
  assert.equal((await call(e, JP, 'GET', `/staff/${rid}`)).json.removed.length, 1);
  await call(e, JP, 'POST', `/staff/${rid}/items/${item.id}/restore`);
  assert.equal((await call(e, JP, 'GET', `/staff/${rid}`)).json.items.length, 3);
});

test('years with the team, start/end dates, and leaving the staff page', { skip: !DatabaseSync }, async () => {
  assert.equal(yearsWith({ started_on: '2019-09-01' }, '2026-11-19'), 7);
  assert.equal(yearsWith({ started_on: '2019-12-01' }, '2026-11-19'), 6);
  assert.equal(yearsWith({ started_on: '2025-01-15', ended_on: '2026-11-30' }, '2027-03-01'), 1);
  const e = env(), gid = idOf(e, 'genny@nseaswim.com'), aid = idOf(e, 'andy@nseaswim.com');
  assert.equal((await call(e, JP, 'POST', `/staff/${aid}`, { started_on: '2019-09-01', publish: ['photo', 'role', 'years', 'bio'] })).status, 200);
  assert.equal((await call(e, JP, 'POST', `/staff/${gid}`, { started_on: '2026-01-01', ended_on: '2025-01-01' })).status, 400);
  await call(e, JP, 'POST', `/staff/${gid}`, { ended_on: '2026-11-01' });
  const d = (await (await pub(e)).json()).coaches;
  assert.ok(!d.some((c) => c.name === 'Genny Hauser'), 'a coach whose last day has passed leaves the public page');
  const andy = d.find((c) => c.name === 'Andy Harrison');
  assert.equal(andy.since, 2019); assert.equal(andy.email, undefined);
  assert.equal((await call(e, JP, 'GET', `/staff/${gid}`)).status, 200, 'their record is kept');
});

test('photos: an owner upload goes live, a coach upload waits; the public photo needs "photo" published', { skip: !DatabaseSync }, async () => {
  const e = env(), rid = idOf(e, 'rachel@nseaswim.com');
  assert.equal((await call(e, JP, 'POST', `/staff/${rid}/photo`, { data: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await call(e, RACHEL, 'POST', `/staff/${rid}/photo`, { data: PNG })).json.queued, true);
  assert.equal((await pub(e, `/staff/photo/${rid}`)).status, 404);
  const ch = (await call(e, JP, 'GET', '/staff')).json.queue.changes[0];
  assert.equal(ch.has_photo, true);
  assert.equal((await call(e, JP, 'GET', `/staff/changes/${ch.id}/photo`)).res.status, 200);
  await call(e, JP, 'POST', `/staff/changes/${ch.id}/approve`);
  const r = await pub(e, `/staff/photo/${rid}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
  const live = (await (await pub(e)).json()).coaches.find((c) => c.name === 'Rachel Soubier');
  assert.match(live.photo, new RegExp(`^/api/content/staff/photo/${rid}\\?v=`));
  await call(e, JP, 'POST', `/staff/${rid}`, { publish: ['role', 'bio'] });
  assert.equal((await pub(e, `/staff/photo/${rid}`)).status, 404);
  assert.equal((await call(e, JP, 'GET', `/staff/${rid}/photo`)).res.status, 200, 'admins can still see an unpublished photo');
});

test('owners and the staff role manage everyone; Coach’s Corner author edits no longer touch the bio', { skip: !DatabaseSync }, async () => {
  const e = env();
  const staffRole = { email: 'board@example.com', roles: ['staff'] };
  const l = await call(e, staffRole, 'GET', '/staff');
  assert.equal(l.json.manager, true); assert.equal(l.json.coaches.length, 5);
  assert.equal((await call(e, RACHEL, 'POST', '/staff', { name: 'New Coach' })).status, 403);
  const add = await call(e, staffRole, 'POST', '/staff', { name: 'New Coach', email: 'new@nseaswim.com', on_staff_page: false });
  assert.equal(add.status, 200);
  assert.ok(!(await (await pub(e)).json()).coaches.some((c) => c.name === 'New Coach'));
  const jid = idOf(e, 'jp@nseaswim.com');
  const bio = e.db.prepare('SELECT bio FROM coach_authors WHERE id = ?').get(jid).bio;
  await handleCoachAdmin(e, JP, 'POST', '/coach/authors', { id: jid, name: 'JP Merchant', role: 'Head Coach', email: 'jp@nseaswim.com', active: true }, async () => {});
  assert.equal(e.db.prepare('SELECT bio FROM coach_authors WHERE id = ?').get(jid).bio, bio);
});
