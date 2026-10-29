import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulk, seasonOf, totalsOf, cleanAthlete, parseSpotlight, parseAward, handleRecognitionAdmin } from '../worker/recognition.mjs';

test('parseBulk reads names with optional counts in several formats', () => {
  const r = parseBulk('Mia x3\n- Jo, 2\n1. Ava (4)\nMary Kate\nBen - 5\nLi ×2\n\n');
  assert.deepEqual(r.entries, [
    { athlete: 'Mia', count: 3 }, { athlete: 'Jo', count: 2 }, { athlete: 'Ava', count: 4 },
    { athlete: 'Mary Kate', count: null }, { athlete: 'Ben', count: 5 }, { athlete: 'Li', count: 2 },
  ]);
  assert.deepEqual(r.bad, []);
});
test('parseBulk drops repeats and flags lines that are not names', () => {
  const r = parseBulk('Jo\njo x2\n12345\n<script>');
  assert.deepEqual(r.entries, [{ athlete: 'Jo', count: null }]);
  assert.deepEqual(r.bad, ['12345', '<script>']);
});
test('cleanAthlete keeps first names and initials, rejects digits and long strings', () => {
  assert.equal(cleanAthlete('  Mia   K. '), 'Mia K.');
  assert.equal(cleanAthlete("D'Andre"), "D'Andre");
  assert.equal(cleanAthlete('a1'), '');
  assert.equal(cleanAthlete('One Two Three Four'), '');
});
test('seasonOf: a season runs September to August', () => {
  assert.equal(seasonOf('2026-09'), '2026-27');
  assert.equal(seasonOf('2027-01'), '2026-27');
  assert.equal(seasonOf('2027-08'), '2026-27');
  assert.equal(seasonOf('2027-09'), '2027-28');
  assert.equal(seasonOf('2099-12'), '2099-00');
});
test('totalsOf counts months and sums counts, skips hidden, filters by season', () => {
  const e = [
    { award_id: 1, period: '2026-09', athlete: 'Mia', count: 3, hidden: false },
    { award_id: 1, period: '2026-10', athlete: 'mia', count: 2, hidden: false },
    { award_id: 1, period: '2026-10', athlete: 'Jo', count: null, hidden: false },
    { award_id: 1, period: '2026-10', athlete: 'Ghost', count: 9, hidden: true },
    { award_id: 1, period: '2026-05', athlete: 'Mia', count: 7, hidden: false },
  ];
  const all = totalsOf(e);
  assert.deepEqual(all.map((t) => [t.athlete.toLowerCase(), t.months, t.sum]), [['mia', 3, 12], ['jo', 1, 0]]);
  const s = totalsOf(e, '2026-27');
  assert.deepEqual(s.map((t) => [t.athlete.toLowerCase(), t.months, t.sum]), [['mia', 2, 5], ['jo', 1, 0]]);
});
test('parseSpotlight requires title, first name and text; rejects a bad photo link', () => {
  assert.match(parseSpotlight({ athlete: 'Mia', body: 'x' }).error, /title/);
  assert.match(parseSpotlight({ title: 'T', athlete: '', body: 'x' }).error, /first name/);
  assert.match(parseSpotlight({ title: 'T', athlete: 'Mia', body: '' }).error, /write/);
  assert.match(parseSpotlight({ title: 'T', athlete: 'Mia', body: 'x', photo_url: 'javascript:alert(1)' }).error, /photo link/);
  const ok = parseSpotlight({ title: 'T', athlete: 'Mia', body: 'x', group_name: 'Senior', publish_on: '2026-11-07', family_ok: true });
  assert.equal(ok.group_name, 'Senior'); assert.equal(ok.family_ok, 1); assert.equal(ok.publish_on, '2026-11-07');
});
test('parseAward needs a name', () => {
  assert.match(parseAward({}).error, /name/);
  assert.equal(parseAward({ name: ' Most Improved ', sort: '3' }).sort, 3);
});

// A minimal fake D1 that records SQL so we can check the admin rules.
function fakeEnv(rows = {}) {
  const log = [];
  const stmt = (sql) => ({ bind: (...b) => ({ sql, b,
    first: async () => (rows.first ? rows.first(sql, b) : null),
    all: async () => ({ results: rows.all ? rows.all(sql, b) : [] }),
    run: async () => { log.push({ sql, b }); return { meta: { last_row_id: 1, changes: 1 } }; } }) });
  return { log, DB: { prepare: stmt, batch: async (l) => { log.push(...l); return l.map(() => ({ meta: { changes: 1 } })); } } };
}
const me = { email: 'jp@nseaswim.com', roles: ['owner'] };
const audits = [];
const audit = async (...a) => audits.push(a);

test('a spotlight cannot be published without the family OK', async () => {
  const env = fakeEnv();
  const r = await handleRecognitionAdmin(env, me, 'POST', '/content/spotlights', { title: 'T', athlete: 'Mia', body: 'x', status: 'published', family_ok: false }, audit);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Family OK/);
  assert.equal(env.log.length, 0);
});
test('publishing from the list is refused when the family OK is missing', async () => {
  const env = fakeEnv({ first: () => ({ id: 5, title: 'T', family_ok: 0 }) });
  const r = await handleRecognitionAdmin(env, me, 'POST', '/content/spotlights/5/publish', {}, audit);
  assert.equal(r.status, 400);
});
test('a draft spotlight saves', async () => {
  const env = fakeEnv();
  const r = await handleRecognitionAdmin(env, me, 'POST', '/content/spotlights', { title: 'T', athlete: 'Mia', body: 'x', status: 'draft' }, audit);
  assert.equal(r.status, 200);
  assert.ok(env.log.some((l) => /INSERT INTO spotlights/.test(l.sql)));
});
test('recognition preview parses without writing', async () => {
  const env = fakeEnv({ first: () => ({ id: 1, name: 'Most Improved' }) });
  const r = await handleRecognitionAdmin(env, me, 'POST', '/content/recognition/entries', { award_id: 1, period: '2026-11', text: 'Mia x3\nJo', preview: true }, audit);
  const j = await r.json();
  assert.equal(j.preview, true); assert.equal(j.entries.length, 2);
  assert.equal(env.log.length, 0);
});
test('recognition rejects a bad month and an empty list', async () => {
  const env = fakeEnv({ first: () => ({ id: 1, name: 'A' }) });
  assert.equal((await handleRecognitionAdmin(env, me, 'POST', '/content/recognition/entries', { award_id: 1, period: '2026-13', text: 'Mia' }, audit)).status, 400);
  assert.equal((await handleRecognitionAdmin(env, me, 'POST', '/content/recognition/entries', { award_id: 1, period: '2026-11', text: '  ' }, audit)).status, 400);
});
test('an award with entries cannot be deleted', async () => {
  const env = fakeEnv({ first: () => ({ id: 1, name: 'A', n: 4 }) });
  const r = await handleRecognitionAdmin(env, me, 'POST', '/content/recognition/awards/1/delete', {}, audit);
  assert.equal(r.status, 400);
});
test('unrelated paths fall through', async () => {
  assert.equal(await handleRecognitionAdmin(fakeEnv(), me, 'GET', '/content/thoughts', {}, audit), null);
});
