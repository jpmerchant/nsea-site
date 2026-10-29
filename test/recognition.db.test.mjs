// Runs the real migrations against an in-memory SQLite (same engine family as D1) and drives the Worker end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleContent } = await import('../worker/content.mjs');
const { handleRecognitionAdmin } = await import('../worker/recognition.mjs');

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _run: () => db.prepare(sql).run(...b) }) });
  return { db, DB: { prepare: (sql) => { const p = prep(sql); return { ...p, ...p.bind(), bind: p.bind, first: () => p.bind().first(), all: () => p.bind().all(), run: () => p.bind().run() }; },
    batch: async (list) => list.map((s) => s._run()) } };
}
const me = { email: 'jp@nseaswim.com', roles: ['owner'] };
const audit = async () => {};
const admin = async (env, method, path, body = {}) => { const r = await handleRecognitionAdmin(env, me, method, path, body, audit); return { status: r.status, json: await r.json() }; };
const pub = async (env, path) => { const r = await handleContent(new Request('https://x.test/api/content' + path), env, new URL('https://x.test/api/content' + path)); return r.json(); };

test('spotlights: draft is private, publish needs family OK, published shows publicly and tracks newsletter use', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const mk = await admin(env, 'POST', '/content/spotlights', { title: 'Big swim', athlete: 'Mia K.', group_name: 'Senior', body: 'Great **work**.', publish_on: '2020-01-01', family_ok: true, status: 'draft' });
  assert.equal(mk.status, 200);
  assert.deepEqual((await pub(env, '/spotlights')).spotlights, []);
  const id = mk.json.id;
  assert.equal((await admin(env, 'POST', `/content/spotlights/${id}/publish`)).status, 200);
  const list = (await pub(env, '/spotlights')).spotlights;
  assert.equal(list.length, 1); assert.equal(list[0].athlete, 'Mia K.'); assert.equal(list[0].newsletter_on, null);
  await admin(env, 'POST', `/content/spotlights/${id}/used`, { date: '2026-10-31' });
  assert.equal((await pub(env, '/spotlights')).spotlights[0].newsletter_on, '2026-10-31');
  await admin(env, 'POST', `/content/spotlights/${id}/unused`);
  assert.equal((await pub(env, '/spotlights')).spotlights[0].newsletter_on, null);
  // future-dated spotlights stay hidden
  await admin(env, 'POST', '/content/spotlights', { id, title: 'Big swim', athlete: 'Mia K.', body: 'x', publish_on: '2999-01-01', family_ok: true, status: 'published' });
  assert.deepEqual((await pub(env, '/spotlights')).spotlights, []);
  // unticking family OK hides it even if still marked published
  await admin(env, 'POST', '/content/spotlights', { id, title: 'Big swim', athlete: 'Mia K.', body: 'x', publish_on: '2020-01-01', family_ok: false, status: 'draft' });
  assert.deepEqual((await pub(env, '/spotlights')).spotlights, []);
  assert.equal((await admin(env, 'POST', `/content/spotlights/${id}/publish`)).status, 400);
});

test('recognition: awards, monthly paste (add + update), hide, running data', { skip: !DatabaseSync }, async () => {
  const env = d1();
  assert.equal((await admin(env, 'POST', '/content/recognition/awards', { name: 'Most Improved', description: 'Chosen by coaches' })).status, 200);
  assert.equal((await admin(env, 'POST', '/content/recognition/awards', { name: 'most improved' })).status, 400); // duplicate, case-insensitive
  const award = (await admin(env, 'GET', '/content/recognition')).json.awards[0];
  const r1 = await admin(env, 'POST', '/content/recognition/entries', { award_id: award.id, period: '2026-09', text: 'Mia x3\nJo\nAva, 2', group_name: 'Senior' });
  assert.deepEqual([r1.json.added, r1.json.updated], [3, 0]);
  const r2 = await admin(env, 'POST', '/content/recognition/entries', { award_id: award.id, period: '2026-09', text: 'mia x4\nBen' });
  assert.deepEqual([r2.json.added, r2.json.updated], [1, 1]);
  await admin(env, 'POST', '/content/recognition/entries', { award_id: award.id, period: '2026-10', text: 'Mia x2' });
  const all = (await admin(env, 'GET', '/content/recognition')).json.entries;
  const mia = all.filter((e) => e.athlete.toLowerCase() === 'mia');
  assert.deepEqual(mia.map((e) => [e.period, e.count]).sort(), [['2026-09', 4], ['2026-10', 2]]);
  assert.equal(all.find((e) => e.athlete === 'Mia' && e.period === '2026-09').group_name, 'Senior'); // group kept on update
  // hide Jo: gone from the public feed, kept in admin
  const jo = all.find((e) => e.athlete === 'Jo');
  await admin(env, 'POST', `/content/recognition/entries/${jo.id}/hide`);
  const p = await pub(env, '/recognition');
  assert.ok(!p.entries.some((e) => e.athlete === 'Jo'));
  assert.deepEqual(p.seasons, ['2026-27']);
  assert.equal(p.entries.filter((e) => e.athlete.toLowerCase() === 'mia').length, 2);
  // inactive award disappears from the public feed; award with entries can't be deleted
  assert.equal((await admin(env, 'POST', `/content/recognition/awards/${award.id}/delete`)).status, 400);
  await admin(env, 'POST', '/content/recognition/awards', { id: award.id, name: 'Most Improved', active: false });
  assert.deepEqual((await pub(env, '/recognition')).entries, []);
});
