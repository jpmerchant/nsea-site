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

// ---- Plain-text bios. Line lists captured from the real pages (Oct 2026), rebuilt as one <p> per line. ----
import { parseBioText, sameName } from '../worker/alumni.mjs';
const page = (name, ls) => `<h2>Main</h2><h2>${name}</h2><div>${ls.map((l) => `<p>${l}</p>`).join('')}</div><h2>Footer</h2>`;

test('FSU: TOP TIMES block become marks; seasons keep their labels; high school and personal are skipped', () => {
  const html = page('Clem Camacho', ['Position:', 'IM', 'Year:', 'Sophomore', 'Other College:', 'Virginia Tech', 'Bio Media', 'Bio', 'Bio', 'Media', 'TOP TIMES', '200 Fly - 1:48.20', '200 IM - 1:43.84', '2026-27',
    'Made FSU debut with second place finish in the 500 free (4:28.23) vs. Purdue on October 9-10.', '2025-26 (Virginia Tech)', 'Collegiate debut at George Washington with sixth place finish in 200 free… advanced to the C-Final in 400 IM at the ACC Championships',
    'HIGH SCHOOL/CLUB', 'North Carolina 2025 4A High School State Champion… 2025 Coastal Preps Swimmer of the Year', 'PERSONAL', 'Born August 9, 2007… son of Dan and Lori Camacho', 'Skip Ad']);
  const p = parseBioText(html, { name: 'Clem Camacho' });
  assert.deepEqual(p.marks, [{ event: '200 Fly', time: '1:48.20' }, { event: '200 IM', time: '1:43.84' }]);
  assert.deepEqual(p.seasons.map((s) => s.label), ['2026-27', '2025-26 (Virginia Tech)']);
  assert.equal(p.seasons[1].items.length, 2);
  assert.ok(!JSON.stringify(p).includes('Coastal') && !JSON.stringify(p).includes('Born August'));
});
test('Mount St. Mary’s: "SEASON TOP TIMES" blocks become season items with the meet; SwimCloud link is captured', () => {
  const html = page('Abby Forbes', ['Height', '5-6', 'Bio', 'Related', 'Historical', 'Biography', 'SWIMCLOUD PROFILE', '2025-26 SEASON TOP TIMES:', '50 Free - 26.14 - MAAC Championships', '100 Fly - 1:02.15 - MAAC Championships', '2024-25 SEASON TOP TIMES:', '100 Free - 1:01.08 - VMI', 'Related Content', 'There is no related content available.'])
    + '<a href="https://www.swimcloud.com/swimmer/1445978">SwimCloud</a>';
  const p = parseBioText(html, { name: 'Abby Forbes' });
  assert.equal(p.marks.length, 0);
  assert.deepEqual(p.seasons[0], { label: '2025-26', items: ['50 Free: 26.14 (MAAC Championships)', '100 Fly: 1:02.15 (MAAC Championships)'] });
  assert.equal(p.seasons[1].items[0], '100 Free: 1:01.08 (VMI)');
  assert.equal(p.swimcloud, 'https://www.swimcloud.com/swimmer/1445978');
});
test('NKU: one prose line split on ellipses', () => {
  const html = page('Laith Ausband', ['Position', 'Sprint Freestyle', 'Bio', 'Related', 'Historical', 'Biography', '2025-26: Clocked a 21.25 in the 50 free at the 21st House of Champions Invitational…recorded a 46.99 in the 100 free at the Horizon League Championships…added a 1:03.55 in the 100 breast', 'Related Content', 'Historical Player Information', '2025-26 Freshman']);
  const p = parseBioText(html, { name: 'Laith Ausband' });
  assert.equal(p.seasons.length, 1); assert.equal(p.seasons[0].items.length, 3);
  assert.ok(p.seasons[0].items[0].startsWith('Clocked a 21.25'));
});
test('W&L: honors are kept, high school and personal (family) lines are not', () => {
  const html = page('Keener Witmer', ['Class', 'Junior', 'Bio', 'Related', 'Historical', 'Biography', '2025-26:', 'W&L Scholar Athlete (Fall)', '2024-25:', 'W&L Scholar Athlete (Fall)', 'Academic All-ODAC', 'High School: Four year letter winner in swimming at John T. Hoggard...Helped lead the team', 'Personal : Father played basketball...Twin brother swims at the University of Alabama', 'Related Content']);
  const p = parseBioText(html, { name: 'Keener Witmer' });
  assert.deepEqual(p.seasons.map((s) => [s.label, s.items.length]), [['2025-26', 1], ['2024-25', 2]]);
  assert.ok(!JSON.stringify(p).includes('Twin brother'));
});
test('nickname matches the roster page name (Madi / Madison); other people do not', () => {
  assert.ok(sameName('Madison Joy', 'Madi Joy')); assert.ok(!sameName('Maddy Joy', 'Abby Joy')); assert.ok(!sameName('Madison Smith', 'Madi Joy'));
  const A = { name: 'Madi Joy', base_url: 'https://ecupirates.com', sport_path: 'womens-swimming-and-diving', roster_slug: '' };
  const list = '<a href="/sports/womens-swimming-and-diving/roster/madison-joy/14436">x</a><a href="/sports/womens-swimming-and-diving/roster/maddie-joy/1">y</a>';
  assert.equal(findRosterLink(list, A), 'https://ecupirates.com/sports/womens-swimming-and-diving/roster/madison-joy/14436');
  assert.equal(findRosterLink(list, { ...A, roster_slug: 'maddie-joy' }), 'https://ecupirates.com/sports/womens-swimming-and-diving/roster/maddie-joy/1');
});

import { publicAlumni } from '../worker/alumni.mjs';
test('public list keeps featured alumni even before they have results (the page shows a "coming soon" note)', async () => {
  const people = [{ id: 1, slug: 'a', name: 'A', school: 'S', class_year: 2024, roster_url: '', swimcloud_url: '', marks: '[{"event":"50 Free","time":"20.26"}]', synced_at: null },
                  { id: 2, slug: 'b', name: 'B', school: 'S', class_year: 2026, roster_url: '', swimcloud_url: '', marks: '[]', synced_at: null }];
  const env = { DB: { prepare: (sql) => ({ all: async () => ({ results: /FROM alumni WHERE/.test(sql) ? people : [] }) }) } };
  const body = await (await publicAlumni(env)).json();
  assert.deepEqual(body.alumni.map((x) => [x.name, x.marks.length, x.updates.length]), [['A', 1, 0], ['B', 0, 0]]);
});
