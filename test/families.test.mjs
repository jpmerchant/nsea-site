// Families & Roster: real migrations in in-memory SQLite, roster loaded the way roster/d1_roster.sql loads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleFamiliesAdmin, familyAccess } = await import('../worker/families.mjs');
const { handleCarpool } = await import('../worker/carpool.mjs');

function d1(extra = {}) {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO roster_swimmer VALUES ('AAA1','Ada Active','active','SU'), ('BBB2','Ben Alum','alumni',NULL), ('CCC3','Cy Gone','inactive',NULL), ('DDD4','Dee Active','active','RT');
    INSERT INTO roster_family (email, family_name, phone, source) VALUES ('active@x.com','Active Fam','555','captyn'), ('gone@x.com','Gone Fam',NULL,'captyn'), ('alum@x.com','Alum Fam',NULL,'captyn');
    INSERT INTO family_swimmer (email, usa_id, source) VALUES ('active@x.com','AAA1','captyn'), ('gone@x.com','CCC3','captyn'), ('alum@x.com','BBB2','captyn');
    INSERT INTO roster_import (source, exported_at, swimmers, families, links) VALUES ('captyn','2026-11-24',4,3,3);`);
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _run: () => db.prepare(sql).run(...b) }) });
  return { db, ...extra, DB: { prepare: (sql) => { const p = prep(sql); return { ...p, ...p.bind(), bind: p.bind, first: () => p.bind().first(), all: () => p.bind().all(), run: () => p.bind().run() }; },
    batch: async (list) => list.map((s) => s._run()) } };
}
const JP = { email: 'jp@nseaswim.com', roles: ['owner'] };
const audit = async () => {};
const adm = async (env, method, path, body = {}) => { const r = await handleFamiliesAdmin(env, JP, method, path, body, audit, 'https://x.test'); return { status: r.status, json: await r.json() }; };
const cp = async (env, method, path, body, cookie) => {
  const u = new URL('https://x.test/api/carpool' + path);
  const r = await handleCarpool(new Request(u, { method, headers: { origin: 'https://x.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, u);
  return { status: r.status, json: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const signIn = async (env, link) => (await cp(env, 'POST', '/session', { token: new URL(link).searchParams.get('k') })).cookie;

test('eligibility comes from roster status: active and alumni yes, inactive no', { skip: !DatabaseSync }, async () => {
  const env = d1();
  assert.equal((await familyAccess(env, 'ACTIVE@x.com')).eligible, true);
  const al = await familyAccess(env, 'alum@x.com'); assert.equal(al.eligible, true); assert.equal(al.alumniOnly, true);
  assert.equal((await familyAccess(env, 'gone@x.com')).eligible, false);
  assert.equal((await familyAccess(env, 'nobody@x.com')).eligible, false);
});

test('Captyn families without a sign-in: only eligible ones listed; making a link creates the account once', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const list = await adm(env, 'GET', '/families/captyn', { q: '' });
  assert.deepEqual(list.json.families.map((f) => f.email).sort(), ['active@x.com', 'alum@x.com']);
  assert.equal((await adm(env, 'POST', '/families/captyn-invite', { email: 'gone@x.com' })).status, 400);
  const inv = await adm(env, 'POST', '/families/captyn-invite', { email: 'active@x.com' });
  assert.equal(inv.status, 200); assert.match(inv.json.link, /\/families\/carpool\/\?k=/);
  const m = env.db.prepare(`SELECT family_name, status, swimmers FROM members WHERE email = 'active@x.com'`).get();
  assert.equal(m.status, 'active'); assert.equal(m.swimmers, 'Ada Active');
  assert.deepEqual((await adm(env, 'GET', '/families/captyn', { q: '' })).json.families.map((f) => f.email), ['alum@x.com']);
  const again = await adm(env, 'POST', '/families/captyn-invite', { email: 'active@x.com' });
  assert.equal(again.status, 200); // a fresh link for the same account
  assert.equal(env.db.prepare(`SELECT COUNT(*) n FROM members WHERE email = 'active@x.com'`).get().n, 1);
  const ov = await adm(env, 'GET', '/families');
  assert.equal(ov.json.unclaimed, 1); assert.equal(ov.json.roster.active, 2); assert.equal(ov.json.import.exported_at, '2026-11-24');
});

test('alum request: link by hand, approve, then eligible; Captyn links cannot be removed by hand', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const req = await cp(env, 'POST', '/request-access', { family: 'Old Alum', email: 'old@alum.com', swimmers: 'Ben Alum', relation: 'alum', gradYear: '2023' });
  assert.equal(req.status, 200);
  const m = env.db.prepare(`SELECT id, relation, grad_year, status FROM members WHERE email = 'old@alum.com'`).get();
  assert.equal(m.relation, 'alum'); assert.equal(m.grad_year, 2023); assert.equal(m.status, 'pending');
  let ov = await adm(env, 'GET', '/families');
  assert.equal(ov.json.members.find((x) => x.id === m.id).eligible, false);
  assert.deepEqual((await adm(env, 'GET', '/families/roster', { q: 'ben al' })).json.swimmers.map((s) => s.usa_id), ['BBB2']);
  assert.equal((await adm(env, 'POST', `/families/members/${m.id}/link`, { usa_id: 'BBB2' })).json.access.eligible, true);
  const ap = await adm(env, 'POST', `/families/members/${m.id}/approve`);
  assert.equal(ap.status, 200); assert.ok(ap.json.link); assert.equal(ap.json.access.eligible, true);
  ov = await adm(env, 'GET', '/families');
  assert.deepEqual(ov.json.members.find((x) => x.id === m.id).linked.map((s) => [s.name, s.status, s.source]), [['Ben Alum', 'alumni', 'manual']]);
  // A Captyn link stays put
  const inv = await adm(env, 'POST', '/families/captyn-invite', { email: 'alum@x.com' });
  const capId = env.db.prepare(`SELECT id FROM members WHERE email = 'alum@x.com'`).get().id;
  assert.ok(inv.json.link);
  assert.equal((await adm(env, 'POST', `/families/members/${capId}/unlink`, { usa_id: 'BBB2' })).status, 400);
  assert.equal((await adm(env, 'POST', `/families/members/${m.id}/unlink`, { usa_id: 'BBB2' })).json.access.eligible, false);
  // family requests default to 'family' and ignore a graduation year
  await cp(env, 'POST', '/request-access', { family: 'New Fam', email: 'new@fam.com', swimmers: 'Dee', gradYear: '2020' });
  assert.deepEqual({ ...env.db.prepare(`SELECT relation, grad_year FROM members WHERE email = 'new@fam.com'`).get() }, { relation: 'family', grad_year: null });
});

test('gate: off lets any approved family in; on blocks families with no Active or Alumni swimmer', { skip: !DatabaseSync }, async () => {
  for (const gate of ['off', 'on']) {
    const env = d1({ FAMILY_GATE: gate });
    env.db.exec(`INSERT INTO members (email, family_name, swimmers, status) VALUES ('gone@x.com','Gone Fam','Cy','active')`);
    const goneId = env.db.prepare(`SELECT id FROM members WHERE email = 'gone@x.com'`).get().id;
    const { newMemberInvite } = await import('../worker/carpool.mjs');
    const gone = await signIn(env, await newMemberInvite(env, goneId, 'https://x.test'));
    const ok = await signIn(env, (await adm(env, 'POST', '/families/captyn-invite', { email: 'active@x.com' })).json.link);
    assert.equal((await cp(env, 'GET', '/me', null, ok)).status, 200);
    assert.equal((await cp(env, 'GET', '/me', null, gone)).status, gate === 'on' ? 403 : 200);
  }
});
