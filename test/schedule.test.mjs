// Practice Schedule: rules checked against the real 2026-27 calendars (fixtures) and JP's own calls on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { suggest, parseICS, weekView, baseTime, schoolDayKind, hsSchools, mondayOf, dow, etToday, runCheck, handleScheduleAdmin, publicSchedule } from '../worker/schedule.mjs';
import { scheduleDefaults } from '../src/data/schedule-defaults.mjs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip DB tests */ }

const fx = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const ICS = fx('hs-meets-holidays.ics');
const EVENTS = JSON.parse(fx('events-2026-27.json')).events;
const cfg = scheduleDefaults();
const hs = parseICS(ICS);
const inputs = { events: EVENTS, hs, schools: [{ name: 'New Hanover County Schools', events: hs.filter((e) => e.allDay) }], wsl: [] };
const run = (from, to, extra = {}) => suggest(cfg, from, to, { ...inputs, ...extra }, from);
const hsOn = (list, d) => list.filter((s) => s.source === 'hs' && s.date === d && s.kind === 'time');

test('dates: Monday-based weeks, Eastern dates from UTC stamps', () => {
  assert.equal(dow('2026-11-16'), 0);
  assert.equal(dow('2026-11-22'), 6);
  assert.equal(mondayOf('2026-11-19'), '2026-11-16');
  assert.equal(etToday(new Date('2026-11-20T02:30:00Z')), '2026-11-19');
});

test('parseICS reads folded lines, all-day (exclusive end) and UTC times as Eastern dates', () => {
  const night = hs.find((e) => /UNCW: Ashley \/ Laney/.test(e.summary));
  assert.equal(night.start, '2026-11-19'); // 7:30 PM Eastern = 00:30 UTC the next day
  assert.equal(night.allDay, false);
  assert.match(night.description, /Teams: Ashley, Laney, New Hanover, Topsail/);
  const tg = hs.find((e) => e.summary === 'Thanksgiving Holidays');
  assert.equal(tg.start, tg.end);
  assert.equal(tg.allDay, true);
});

test('school day kinds: holidays and workdays count, early release and report days do not', () => {
  assert.equal(schoolDayKind('Veterans Day Holiday'), 'holiday');
  assert.equal(schoolDayKind('Vacation Days'), 'holiday');
  assert.equal(schoolDayKind('Election Day/Undesignated Teacher Workday'), 'workday');
  assert.equal(schoolDayKind('Early Release'), null);
  assert.equal(schoolDayKind('Interim Reports'), null);
  assert.equal(schoolDayKind('End of Grading Period'), null);
});

test('HS schools are read from the summary or the Teams line; "All Teams" counts everyone', () => {
  assert.deepEqual(hsSchools({ summary: 'Swim Meet @ BCC: South / West / North* / Hoggard', description: '' }), ['South', 'West', 'North', 'Hoggard']);
  assert.deepEqual(hsSchools({ summary: 'Conference Championships @ UNCW (All Teams)', description: '' }), ['*']);
});

test('HS meet nights match JP’s calls for Nov 2026 – Jan 2027', () => {
  const l = run('2026-11-16', '2027-01-31');
  // 11/19: two meets, five NSEA schools, Senior and Surge PM -> shift (already made)
  assert.deepEqual(hsOn(l, '2026-11-19').map((s) => s.group_name).sort(), ['Senior', 'Surge']);
  // 12/16 (Wed, UNCW, four schools) -> change
  assert.deepEqual(hsOn(l, '2026-12-16').map((s) => s.group_name).sort(), ['Senior', 'Surge']);
  // No change: 12/3, 12/10, 12/18, 1/14 (Brunswick schools + one) ; 12/4, 1/8, 1/22 (Fridays: no Surge/Senior PM)
  for (const d of ['2026-12-03', '2026-12-10', '2026-12-18', '2027-01-14', '2026-12-04', '2027-01-08', '2027-01-22']) assert.deepEqual(hsOn(l, d), [], d);
  // 1/8: no practice change, but the intersquad is flagged
  assert.ok(l.some((s) => s.source === 'hs' && s.kind === 'info' && s.date === '2027-01-08' && /Intersquad/.test(s.reason)));
});

test('meets: away meet cancels practice for the groups entered; a Sat+Sun meet suggests the Monday off', () => {
  const l = run('2026-12-07', '2026-12-20');
  const fri = l.filter((s) => s.date === '2026-12-11' && s.source === 'meet');
  assert.ok(fri.length >= 6 && fri.every((s) => s.kind === 'cancel' && s.confidence === 'likely'));
  const mon = l.filter((s) => s.date === '2026-12-14' && s.source === 'meet');
  assert.ok(mon.length && mon.every((s) => s.confidence === 'maybe' && /Monday after/.test(s.reason)));
  // US Open / Winter Juniors are info-only: nothing suggested
  assert.ok(!l.some((s) => /us-open|winter-juniors/.test(s.source_ref)));
});

test('team events: replace practice for the groups named, or add when there is no practice that day', () => {
  const l = run('2026-11-20', '2026-11-22');
  const nerf = l.filter((s) => s.date === '2026-11-20' && s.source === 'team-event');
  assert.deepEqual(nerf.map((s) => s.group_name).sort(), ['Riptide', 'Splash', 'Tidepool']);
  assert.ok(nerf.every((s) => s.kind === 'replace'));
  const rock = l.filter((s) => s.date === '2026-11-22');
  assert.deepEqual(rock.map((s) => [s.group_name, s.session, s.kind]).sort(), [['Breakers', 'AM', 'add'], ['Senior', 'AM', 'add'], ['Surge', 'AM', 'add']]);
});

test('school days: AM practices only; days inside a holiday practice plan are left to the plan', () => {
  const l = run('2027-01-04', '2027-01-31');
  const s = l.filter((x) => x.source === 'school');
  assert.deepEqual(s.map((x) => [x.date, x.group_name, x.session, x.confidence]), [['2027-01-19', 'Senior', 'AM', 'maybe']]);
  const xmas = run('2026-12-18', '2027-01-03').filter((x) => x.source === 'school');
  assert.deepEqual(xmas, []);
});

test('WSL: only checked once teams are set; April asks for them', () => {
  const april = suggest(cfg, '2027-04-08', '2027-04-30', inputs, '2027-04-07');
  assert.ok(april.some((s) => s.source === 'reminder'));
  const c2 = scheduleDefaults(); c2.check.wslTeams = ['Wrightsville Beach'];
  const wsl = parseICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20270615T220000Z\nDTEND:20270616T000000Z\nSUMMARY:WSL Meet: Wrightsville Beach vs Pine Valley\nEND:VEVENT\nEND:VCALENDAR');
  const l = suggest(c2, '2027-06-07', '2027-06-30', { ...inputs, wsl }, '2027-06-01');
  assert.deepEqual(l.filter((s) => s.source === 'wsl').map((s) => [s.date, s.group_name, s.session]), [['2027-06-15', 'Senior', 'PM']]);
});

test('weekView applies approved changes only and marks them', () => {
  assert.equal(baseTime(cfg, '2026-11-17', 'Senior', 'AM'), '5:30 - 7:00');
  assert.equal(baseTime(cfg, '2026-11-22', 'Senior', 'AM'), 'Off');
  assert.equal(baseTime(cfg, '2026-11-17', 'Splash', 'AM'), null);
  const w = weekView(cfg, '2026-11-16', [
    { date: '2026-11-16', group_name: 'All', session: 'PM', kind: 'cancel', status: 'approved' },
    { date: '2026-11-20', group_name: 'Splash', session: 'PM', kind: 'replace', value: 'Nerf', status: 'approved' },
    { date: '2026-11-22', group_name: 'Surge', session: 'AM', kind: 'add', value: 'Rock Gym', status: 'approved' },
    { date: '2026-11-18', group_name: 'Senior', session: 'PM', kind: 'time', value: '3:00 - 5:00', status: 'suggested' },
  ]);
  const row = (g, s) => w.rows.find((r) => r.group === g && r.session === s).cells.map((c) => c.text);
  assert.deepEqual(row('Splash', 'PM'), ['Off', '4:30 - 5:15', '4:30 - 5:15', '4:30 - 5:15', 'Nerf', 'Off', 'Off']);
  assert.equal(row('Tidepool', 'PM')[0], 'Off');
  assert.equal(row('Surge', 'AM')[6], 'Rock Gym');
  assert.equal(row('Senior', 'PM')[2], '4:15 - 6:15'); // suggestion not approved yet
  assert.equal(w.rows.find((r) => r.group === 'Tidepool').cells[0].changed, true);
  assert.equal(w.days[0].short, 'Mon 11/16');
});

// ---------- end to end against the real migrations ----------
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }) });
  return { DB: { prepare: (sql) => { const p = prep(sql); return { ...p.bind(), bind: p.bind }; } } };
}
const me = { email: 'jp@nseaswim.com', roles: ['owner'] };
const audit = async () => {};
const fakeFetch = async (u) => {
  if (String(u).includes('events.json')) return new Response(JSON.stringify({ events: EVENTS }));
  if (String(u).includes('hs.ics')) return new Response(ICS);
  return new Response('nope', { status: 404 });
};
const admin = async (env, method, path, body = {}) => { const r = await handleScheduleAdmin(env, me, method, path, body, audit, fakeFetch); return { status: r.status, json: await r.json() }; };

test('weekly check -> queue -> approve -> public week', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const s = scheduleDefaults(); s.check.hsUrl = 'https://example.test/hs.ics';
  assert.equal((await admin(env, 'POST', '/schedule/settings', s)).status, 200);
  const r1 = await runCheck(env, 'test', fakeFetch, new Date('2026-12-10T02:00:00Z')); // Wed 12/9, 9 PM ET
  assert.equal(r1.from, '2026-12-10');
  assert.ok(r1.added > 5);
  assert.deepEqual(r1.problems, []);
  // running again adds nothing new
  assert.equal((await runCheck(env, 'test', fakeFetch, new Date('2026-12-10T02:00:00Z'))).added, 0);
  const all = (await env.DB.prepare(`SELECT * FROM sched_changes ORDER BY id`).all()).results;
  const hsSenior = all.find((x) => x.source_ref === 'hs:2026-12-16:Senior:PM');
  assert.ok(hsSenior);
  // a time change can't be approved without a time
  assert.equal((await admin(env, 'POST', `/schedule/changes/${hsSenior.id}/approve`)).status, 400);
  assert.equal((await admin(env, 'POST', `/schedule/changes/${hsSenior.id}/approve`, { value: '3:30 - 5:30', note: 'HS meet night' })).status, 200);
  // reject one; it is never suggested again
  const mon = all.find((x) => x.source_ref.startsWith('meet-monday:star-triad-tropic:2026-12-14:Senior'));
  await admin(env, 'POST', `/schedule/changes/${mon.id}/reject`);
  await runCheck(env, 'test', fakeFetch, new Date('2026-12-10T02:00:00Z'));
  assert.equal((await env.DB.prepare(`SELECT status FROM sched_changes WHERE id = ?`).bind(mon.id).first()).status, 'rejected');
  // approve all likely (cancel/add/replace only), plus a manual change
  const al = await admin(env, 'POST', '/schedule/approve-likely');
  assert.ok(al.json.approved > 0);
  assert.equal((await admin(env, 'POST', '/schedule/changes', { date: '2026-12-15', group_name: 'Breakers', session: 'PM', kind: 'time', value: '6:00 - 7:30', reason: 'Coach out' })).status, 200);
  assert.equal((await admin(env, 'POST', '/schedule/changes', { date: '2026-12-15', group_name: 'Breakers', session: 'PM', kind: 'time', value: '' })).status, 400);
  // public week: approved only, no admin-only reasons
  const url = new URL('https://x.test/api/content/schedule?start=2026-12-14&weeks=1');
  const url0 = new URL('https://x.test/api/content/schedule?start=2026-12-07&weeks=1');
  const wk0 = (await (await publicSchedule(env, url0)).json()).weeks[0];
  const pub = await (await publicSchedule(env, url)).json();
  const wk = pub.weeks[0];
  const cell = (g, s, i) => wk.rows.find((r) => r.group === g && r.session === s).cells[i];
  assert.equal(cell('Senior', 'PM', 2).text, '3:30 - 5:30');
  assert.equal(cell('Senior', 'PM', 2).note, 'HS meet night');
  assert.equal(cell('Senior', 'PM', 0).text, '6:45 - 8:15'); // rejected Monday-off stays at base
  assert.equal(cell('Breakers', 'PM', 1).text, '6:00 - 7:30');
  assert.equal(wk0.rows.find((r) => r.group === 'Splash').cells[4].text, 'Off'); // Fri 12/11 STAR Triad Tropic (likely) approved
  assert.ok(!JSON.stringify(pub).includes('Coach out'));
  assert.ok(!JSON.stringify(pub).includes('hs.ics'));
  // Captyn tick and the console view
  await admin(env, 'POST', `/schedule/changes/${hsSenior.id}/captyn`, { on: true });
  const view = await admin(env, 'GET', '/schedule');
  assert.equal(view.status, 200);
  assert.equal(view.json.runs.length, 3);
});

test('settings: bad season dates and bad links are refused', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const s = scheduleDefaults(); s.seasons[0].end = '2020-01-01';
  assert.equal((await admin(env, 'POST', '/schedule/settings', s)).status, 400);
  const t = scheduleDefaults(); t.check.hsUrl = 'javascript:alert(1)';
  assert.equal((await admin(env, 'POST', '/schedule/settings', t)).status, 200);
  assert.equal((await admin(env, 'GET', '/schedule')).json.config.check.hsUrl, '');
});
