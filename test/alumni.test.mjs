import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster, findRosterLink, syncAlumnus, text } from '../worker/alumni.mjs';

// Mirrors the structure of a real Sidearm roster page (checked against rolltide.com, Oct 2026), including an <h2> with no list after it.
const PAGE = `<html><body><h2>Bio</h2><div>NIL Opportunities</div>
<h2>Summer 2026</h2>

<ul>
\t<li>Secured a place in the 200 LCM Backstroke B-Final &amp; more</li>
\t<li>Recorded a personal best time of 26.16 in the 50 LCM Backstroke</li>
</ul>
<h2>2025-26</h2><ul><li>Clocked a 1:39.64 in the 200 backstroke</li></ul>
<h2>2024-25</h2><ul><li>Competed in the 100 back</li></ul>
<h2>2023-24</h2><ul><li>Older year</li></ul>
<h2>Prep Highlights</h2><ul><li>Won the state title</li></ul>
<h2>Top Marks</h2><ul><li>50 Free - 20.26</li><li>200 Back - 1:39.64</li><li>Not a mark</li></ul>
<p>Cole Witmer</p></body></html>`;

test('parseRoster reads Top Marks and season sections, skips prep highlights', () => {
  const p = parseRoster(PAGE);
  assert.deepEqual(p.marks, [{ event: '50 Free', time: '20.26' }, { event: '200 Back', time: '1:39.64' }]);
  assert.deepEqual(p.seasons.map((s) => s.label), ['Summer 2026', '2025-26', '2024-25', '2023-24']);
  assert.equal(p.seasons[0].items[0], 'Secured a place in the 200 LCM Backstroke B-Final & more');
});
test('an <h2> without a list does not swallow the next section', () => {
  assert.equal(parseRoster(PAGE).seasons[0].label, 'Summer 2026');
});
test('text decodes entities and strips tags', () => assert.equal(text('<b>A&nbsp;&amp;&nbsp;B</b> &#8217;'), 'A & B ’'));

const A = { id: 1, slug: 'cole-witmer', name: 'Cole Witmer', base_url: 'https://rolltide.com', sport_path: 'swimming-and-diving', roster_url: 'https://rolltide.com/sports/swimming-and-diving/roster/cole-witmer/111' };
test('findRosterLink picks the newest id on the roster list', () => {
  const list = '<a href="/sports/swimming-and-diving/roster/cole-witmer/111">x</a><a href="/sports/swimming-and-diving/roster/cole-witmer/222">y</a><a href="/sports/swimming-and-diving/roster/someone-else/999">z</a>';
  assert.equal(findRosterLink(list, A), 'https://rolltide.com/sports/swimming-and-diving/roster/cole-witmer/222');
});

function fakeEnv() {
  const log = [];
  const stmt = (sql) => ({ bind: (...b) => ({ sql, b, run: async () => ({ meta: { changes: 1 } }) }) });
  return { log, DB: { prepare: stmt, batch: async (list) => { log.push(...list); return list.map(() => ({ meta: { changes: 1 } })); } } };
}
const resp = (body, ok = true, status = 200) => ({ ok, status, text: async () => body });

test('sync imports marks and only the newest two seasons', async () => {
  const env = fakeEnv();
  const r = await syncAlumnus(env, A, async () => resp(PAGE));
  assert.equal(r.ok, true); assert.equal(r.marks, 2); assert.equal(r.added, 3);
  const inserts = env.log.filter((s) => /INSERT OR IGNORE/.test(s.sql));
  assert.equal(inserts.length, 3); // Summer 2026 (2 items) + 2025-26 (1 item)
  assert.ok(inserts.every((s) => s.b[1] !== '2024-25'));
});
test('sync rediscovers the roster link when last season’s page is gone', async () => {
  const env = fakeEnv(); const seen = [];
  const f = async (u) => { seen.push(u); if (u.endsWith('/111')) return resp('', false, 404); if (u.endsWith('/roster')) return resp('<a href="/sports/swimming-and-diving/roster/cole-witmer/222">c</a>'); return resp(PAGE); };
  const r = await syncAlumnus(env, A, f);
  assert.equal(r.ok, true);
  const upd = env.log.find((s) => /UPDATE alumni SET roster_url/.test(s.sql));
  assert.ok(upd.b[0].endsWith('/222'));
});
test('sync refuses links that leave the school site and reports unreadable pages', async () => {
  const env = fakeEnv();
  const r = await syncAlumnus(env, { ...A, roster_url: 'https://evil.example/x' }, async () => resp('<html>nothing</html>'));
  assert.equal(r.ok, false);
});
