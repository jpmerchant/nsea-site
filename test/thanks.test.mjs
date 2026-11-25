// Family Thanks: public form → approval queue → public wall, plus phone alerts and limits. Runs against the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleThanksPublic, handleThanksAdmin, cleanNote, MAX_NOTE } = await import('../worker/thanks.mjs');
const { handleContent } = await import('../worker/content.mjs');

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const stmt = (sql, b = []) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _run: () => db.prepare(sql).run(...b),
    bind: (...nb) => stmt(sql, nb),
  });
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s._run()) } };
}
const T = { skip: !DatabaseSync };
const me = { email: 'jp@nseaswim.com', roles: ['owner'] };
function fakeFetch() {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  f.calls = calls; return f;
}
const send = async (env, body, { ip = '1.2.3.4', origin = 'https://x.test', fetchImpl = fakeFetch() } = {}) => {
  const req = new Request('https://x.test/api/thanks/submit', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
  const r = await handleThanksPublic(req, env, new URL(req.url), fetchImpl);
  return { status: r.status, json: await r.json(), fetchImpl };
};
const admin = async (env, method, path, body = {}, fetchImpl = fakeFetch()) => {
  const r = await handleThanksAdmin(env, me, method, path, body, async () => {}, 'https://x.test', fetchImpl);
  return { status: r.status, json: await r.json() };
};
const wall = async (env) => { const u = 'https://x.test/api/content/thanks'; return (await (await handleContent(new Request(u), env, new URL(u))).json()).notes; };

test('cleanNote keeps paragraphs, trims and caps', () => {
  assert.equal(cleanNote('  Thank   you!\r\n\r\n\r\n\nCoach  Andy\u0007 rocks  '), 'Thank you!\n\nCoach Andy rocks');
  assert.equal(cleanNote('x'.repeat(MAX_NOTE + 50)).length, MAX_NOTE);
});

test('a note waits for approval, then shows on the wall without the private email', T, async () => {
  const env = d1();
  // the console makes an alert topic on first open
  const first = await admin(env, 'GET', '/content/thanks');
  assert.match(first.json.settings.ntfy_topic, /^nsea-thanks-[a-z0-9]{6,}$/);
  const r = await send(env, { note: 'Thank you coaches!', signed: 'The Rivera family', email: 'Pat@Example.com' });
  assert.equal(r.status, 200);
  // phone alert went to the topic, with only the signature
  assert.equal(r.fetchImpl.calls.length, 1);
  assert.equal(r.fetchImpl.calls[0].url, 'https://ntfy.sh/' + first.json.settings.ntfy_topic);
  assert.match(r.fetchImpl.calls[0].init.body, /The Rivera family/);
  assert.doesNotMatch(r.fetchImpl.calls[0].init.body, /Thank you coaches/);
  assert.equal(r.fetchImpl.calls[0].init.headers.Click, 'https://x.test/admin/');
  assert.deepEqual(await wall(env), []);
  const list = (await admin(env, 'GET', '/content/thanks')).json.notes;
  assert.equal(list.length, 1); assert.equal(list[0].status, 'pending'); assert.equal(list[0].email, 'pat@example.com');
  assert.equal((await admin(env, 'POST', `/content/thanks/${list[0].id}/approve`)).status, 200);
  const shown = await wall(env);
  assert.equal(shown.length, 1);
  assert.deepEqual(Object.keys(shown[0]).sort(), ['body', 'featured', 'id', 'posted_on', 'signed']);
  assert.equal(shown[0].body, 'Thank you coaches!');
});

test('edit keeps the original, feature pins, take down and reject hide it', T, async () => {
  const env = d1();
  await send(env, { note: 'Thanks to Coach Devin for helping Ava Smith!', signed: 'A Riptide mom' });
  await send(env, { note: 'Second note', signed: 'B' });
  const [b, a] = (await admin(env, 'GET', '/content/thanks')).json.notes; // newest first
  assert.equal((await admin(env, 'POST', `/content/thanks/${a.id}/edit`, { note: 'Thanks to Coach Devin for helping Ava!', signed: 'A Riptide mom' })).status, 200);
  const edited = (await admin(env, 'GET', '/content/thanks')).json.notes.find((n) => n.id === a.id);
  assert.equal(edited.edited, true); assert.match(edited.original, /Ava Smith/);
  await admin(env, 'POST', `/content/thanks/${a.id}/approve`);
  await admin(env, 'POST', `/content/thanks/${b.id}/approve`);
  await admin(env, 'POST', `/content/thanks/${a.id}/feature`);
  let shown = await wall(env);
  assert.equal(shown[0].id, a.id); assert.equal(shown[0].featured, true); assert.equal(shown[0].body, 'Thanks to Coach Devin for helping Ava!');
  await admin(env, 'POST', `/content/thanks/${a.id}/pending`);
  await admin(env, 'POST', `/content/thanks/${b.id}/reject`);
  assert.deepEqual(await wall(env), []);
  assert.equal((await admin(env, 'POST', `/content/thanks/${b.id}/delete`)).status, 200);
  assert.equal((await admin(env, 'POST', `/content/thanks/${b.id}/approve`)).status, 404);
  assert.equal((await admin(env, 'POST', `/content/thanks/${a.id}/edit`, { note: '', signed: 'x' })).status, 400);
});

test('validation, honeypot, bad origin, closed form and daily limit', T, async () => {
  const env = d1();
  assert.equal((await send(env, { note: '', signed: 'x' })).status, 400);
  assert.equal((await send(env, { note: 'Thanks!', signed: '' })).status, 400);
  assert.equal((await send(env, { note: 'Thanks!', signed: 'x', email: 'nope' })).status, 400);
  assert.equal((await send(env, { note: 'Thanks!', signed: 'x' }, { origin: 'https://evil.test' })).status, 403);
  const bot = await send(env, { note: 'spam', signed: 'bot', website: 'http://spam' });
  assert.equal(bot.status, 200); assert.equal(bot.fetchImpl.calls.length, 0);
  assert.equal((await admin(env, 'GET', '/content/thanks')).json.notes.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await send(env, { note: 'Thanks ' + i, signed: 'x' })).status, 200);
  assert.equal((await send(env, { note: 'one more', signed: 'x' })).status, 429);
  assert.equal((await send(env, { note: 'other family', signed: 'y' }, { ip: '5.6.7.8' })).status, 200);
  await admin(env, 'POST', '/content/thanks/settings', { open: false });
  const st = await handleThanksPublic(new Request('https://x.test/api/thanks/status'), env, new URL('https://x.test/api/thanks/status'));
  assert.equal((await st.json()).open, false);
  assert.equal((await send(env, { note: 'closed', signed: 'z' }, { ip: '9.9.9.9' })).status, 403);
});

test('alerts can be turned off, tested, and moved to a new topic', T, async () => {
  const env = d1();
  const t1 = (await admin(env, 'GET', '/content/thanks')).json.settings.ntfy_topic;
  const f = fakeFetch();
  assert.equal((await admin(env, 'POST', '/content/thanks/test', {}, f)).status, 200);
  assert.equal(f.calls[0].url, 'https://ntfy.sh/' + t1);
  await admin(env, 'POST', '/content/thanks/settings', { notify: false });
  assert.equal((await send(env, { note: 'Quiet', signed: 'q' })).fetchImpl.calls.length, 0);
  const t2 = (await admin(env, 'POST', '/content/thanks/settings', { notify: true, newTopic: true })).json.settings.ntfy_topic;
  assert.notEqual(t2, t1);
  // a failing alert service never blocks the note
  const broken = async () => { throw new Error('down'); };
  const r = await send(env, { note: 'Still saved', signed: 'r' }, { ip: '2.2.2.2', fetchImpl: broken });
  assert.equal(r.status, 200);
  assert.equal((await admin(env, 'GET', '/content/thanks')).json.notes.filter((n) => n.status === 'pending').length, 2);
});
