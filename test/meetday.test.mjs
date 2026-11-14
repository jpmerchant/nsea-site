// Meet Day: parsers, flags, model and the Worker API. All names and times here are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseHeatSheet, parseLaneLine, parseResults, parseHy3, extractByName, toCs, fmt, pdfLines, sameSwimmer } from '../public/admin/meet/lib/parse.mjs';
import { flagsFor } from '../public/admin/meet/lib/flags.mjs';
import { buildRefs } from '../public/admin/meet/lib/refs.mjs';
import { derive, sessionSummary, parseTyped, nowEvent } from '../public/admin/meet/lib/model.mjs';
import { heatSheetRows, resultsFromText, screenshotResults, photoHeatRows, guessSession, htmlToText, resultLinks } from '../public/admin/meet/lib/ingest.mjs';
import { handleMeetdayAdmin, blockedHost } from '../worker/meetday.mjs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node */ }

const SHEET = [
  { text: 'Meet Program - Saturday finals', header: true },
  'Event 11 Girls 13 & Over 100 Yard Backstroke',
  'Lane Name Age Team Seed Time',
  'Heat 1 of 2 Finals Starts at 06:24 PM',
  '3 Fishman, Coral A 15 Nsea Swim-NC 1:05.10',
  '4 Other, Person 16 RSA-NC 1:04.00',
  'Heat 2 Finals (#11 Girls 13 & Over 100 Yard Backstroke)',
  '5 Lane, Penny 17 Nsea Swim-NC 59.80',
  'Event 12 Boys 13 & Over 100 Yard Backstroke',
  'Heat 1 of 1 Finals Starts at 06:30 PM',
  '2 Reef, Rocco J 14 Nsea Swim-NC NT',
];
const pkg = () => ({
  format: 'nsea-meetday/1', id: 'test-meet', name: 'Test Invite', teamMatch: 'nsea', teamName: 'NSEA',
  sessions: [
    { n: 2, day: '2026-11-14', name: 'Saturday prelims', start: '10:15 AM', events: [{ num: 11, round: 'Prelims' }, { num: 12, round: 'Prelims' }] },
    { n: 4, day: '2026-11-14', name: 'Saturday finals', start: '06:20 PM', events: [{ num: 11, round: 'Finals' }, { num: 12, round: 'Finals' }] },
  ],
  events: { 11: { num: 11, sex: 'F', dist: 100, stroke: 'Back', title: 'Girls 13 & Over 100 Backstroke' }, 12: { num: 12, sex: 'M', dist: 100, stroke: 'Back', title: 'Boys 13 & Over 100 Backstroke' } },
  swimmers: [{ id: 1, name: 'Fishman, Coral', first: 'Coral', last: 'Fishman', sex: 'F', age: 15 }, { id: 2, name: 'Lane, Penny', first: 'Penny', last: 'Lane', sex: 'F', age: 17 }, { id: 3, name: 'Reef, Rocco', first: 'Rocco', last: 'Reef', sex: 'M', age: 14 }],
  entries: [
    { id: '11-P-1', swimmerId: 1, event: 11, session: 2, round: 'Prelims', heat: 3, lane: 4, seed: 6620, start: '10:20 AM' },
    { id: '11-P-2', swimmerId: 2, event: 11, session: 2, round: 'Prelims', heat: 5, lane: 4, seed: 6010, start: '10:24 AM' },
    { id: '12-P-3', swimmerId: 3, event: 12, session: 2, round: 'Prelims', heat: 1, lane: 2, seed: null, start: '10:38 AM' },
  ],
  refs: buildRefs({
    records: { genders: { Female: { ageGroups: [{ age: '15-16', events: [{ event: '100 Back', time: '1:05.50', holder: 'Old Holder' }] }, { age: '17-18', events: [{ event: '100 Back', time: '1:00.00', holder: 'Lane, Penny' }] }, { age: 'Open', events: [{ event: '100 Back', time: '58.00' }] }] } } },
    top10: { data: { '15-16': { Female: { '100 Back': Array.from({ length: 10 }, (_, i) => ({ first: 'A' + i, last: 'B', time: fmt(6400 + i * 30) })) } } } },
    standards: { W: { '15-16': { '100 BK': [['NC Senior', '1:05.79', 'teal', 14], ['Futures 18&U', '58.99', 'cyan', 10], ['NSEA Team Record', '1:05.50', 'rec', 0, 'x', '2020']] } } },
  }),
});

test('times: parse, format and phone keypad entry', () => {
  assert.equal(toCs('1:05.10'), 6510); assert.equal(toCs('59.80'), 5980); assert.equal(toCs('NT'), null);
  assert.equal(fmt(6510), '1:05.10'); assert.equal(fmt(5980), '59.80');
  assert.equal(parseTyped('5912'), 5912); assert.equal(parseTyped('21533'), 13533); assert.equal(parseTyped('1:02.4'), 6240); assert.equal(parseTyped('59.1'), 5910);
  assert.equal(parseTyped('9999'), null); assert.equal(parseTyped('abc'), null);
});

test('heat sheet: events, heats (incl. column continuation), lanes and team filter', () => {
  const p = parseHeatSheet(SHEET);
  assert.equal(p.session, 'Saturday finals');
  assert.deepEqual(p.events.map((e) => e.num), [11, 12]);
  const e11 = p.events[0];
  assert.equal(e11.heats.length, 2); assert.equal(e11.heats[1].of, 2); assert.equal(e11.heats[1].start, '06:24 PM'); assert.ok(e11.heats[1].estStart);
  assert.deepEqual(parseLaneLine('3 Fishman, Coral A 15 Nsea Swim-NC 1:05.10'), { lane: 3, name: 'Fishman, Coral A', age: 15, team: 'Nsea Swim-NC', seed: 6510 });
  assert.equal(parseLaneLine('10 Two Word, Name Here 12 Southern Tide Sw-SC NT').seed, null);
  assert.ok(sameSwimmer('Fishman, Coral A', 'Fishman, Coral'));
});

test('pdf lines: two columns read left column first, page header kept apart', () => {
  const it = (x, y, str) => ({ x, y, w: 10, str });
  const lines = pdfLines([{ width: 612, height: 792, items: [it(250, 727, 'Meet Program - Friday PM'), it(18, 700, 'Event 1'), it(54, 700, 'Girls 11 & Over 200 Yard Butterfly'), it(320, 700, 'Heat 2 of 2 Finals'), it(18, 680, 'Heat 1 of 2 Finals')] }]);
  assert.deepEqual(lines.map((l) => l.text), ['Meet Program - Friday PM', 'Event 1  Girls 11 & Over 200 Yard Butterfly', 'Heat 1 of 2 Finals', 'Heat 2 of 2 Finals']);
  assert.equal(lines[0].header, true);
});

test('HY3 entries file', () => {
  const hy = [
    'B12026 Test Invite                              Columbia                                     111320261115202611132026            91',
    'D1F    7Fishman             Coral                                    ABCDEF12345678     01022011 15                             69',
    'E1F    7FishcFF   100B 13109      5.00  11       0Y   66.20Y                                    N                               37',
  ].join('\n');
  const h = parseHy3(hy);
  assert.equal(h.meet.start, '2026-11-13');
  assert.equal(h.swimmers[0].last, 'Fishman'); assert.equal(h.swimmers[0].age, 15);
  assert.deepEqual(h.entries[0], { swimmerId: 7, dist: 100, stroke: 'Back', event: 11, seed: 6620, seedCourse: 'Y' });
});

test('flags: tiers from seed, results become hits, own board spot and cuts already held', () => {
  const P = pkg();
  const f = flagsFor({ sex: 'F', age: 15, dist: 100, stroke: 'Back', name: 'Fishman, Coral', seed: 6620 }, P.refs);
  const rec = f.find((x) => x.kind === 'record' && x.label.includes('15-16'));
  assert.equal(rec.tier, '3'); // 66.20 vs 65.50 = 1.07%
  assert.equal(f.find((x) => x.kind === 'cut' && x.label === 'NC Senior').tier, '1');
  assert.equal(f.find((x) => x.kind === 'top10').tier, 'under'); // 10th on the board is 1:06.70
  const after = flagsFor({ sex: 'F', age: 15, dist: 100, stroke: 'Back', name: 'Fishman, Coral', seed: 6620, time: 6540 }, P.refs);
  assert.ok(after.some((x) => x.kind === 'record' && x.tier === 'hit'));
  assert.ok(after.some((x) => x.kind === 'cut' && x.label === 'NC Senior' && x.tier === 'hit'));
  const has = flagsFor({ sex: 'F', age: 15, dist: 100, stroke: 'Back', name: 'X, Y', seed: 6500 }, P.refs);
  assert.ok(!has.some((x) => x.label === 'NC Senior')); // already has the cut
});

test('model: finals heat sheet adds entries, results, notes, undo, scratch and session summary', () => {
  const P = pkg();
  let ops = [];
  const op = (type, data, at) => { const o = { id: 'op' + ops.length + 'xxxxxxx', at: at || `2026-11-14T1${ops.length}:00:00.000Z`, by: 'Coach', type, data }; ops.push(o); return o; };
  let M = derive(P, ops);
  const parsed = parseHeatSheet(SHEET);
  assert.equal(guessSession(P, parsed), 4);
  const sheet = heatSheetRows(P, M, parsed, 4);
  assert.equal(sheet.rows.length, 3); assert.ok(sheet.rows.every((r) => r.round === 'Finals' && r.swimmerId));
  op('entries', sheet);
  op('result', { entry: '11-P-1', time: 6540, status: 'OK', source: 'manual' });
  op('result', { entry: '11-P-2', time: 6000, status: 'OK', source: 'live', place: 3 });
  const n = op('note', { entry: '11-P-1', text: 'Great turns', tags: ['Turns'] });
  op('scratch', { entry: '12-P-3', on: true });
  M = derive(P, ops);
  const fin = M.rows.filter((r) => r.session === 4);
  assert.equal(fin.length, 3); assert.equal(fin.find((r) => r.swimmerId === 2).lane, 5);
  const r1 = M.rows.find((r) => r.id === '11-P-1');
  assert.equal(r1.delta, -80); assert.equal(r1.notes.length, 1); assert.ok(r1.post.some((f) => f.tier === 'hit'));
  const X = sessionSummary(M, 2);
  assert.equal(X.entries, 2); assert.equal(X.best, 2); assert.equal(X.drop, 90); assert.ok(X.records.length >= 1); assert.equal(X.official, false);
  op('undo', { op: n.id });
  op('official', { session: 2, on: true });
  M = derive(P, ops);
  assert.equal(M.rows.find((r) => r.id === '11-P-1').notes.length, 0);
  assert.equal(sessionSummary(M, 2).official, true);
  // replace: a newer finals sheet without Penny drops her finals swim only
  op('entries', { ...heatSheetRows(P, M, parseHeatSheet(SHEET.filter((l) => !String(l).includes('Lane, Penny'))), 4) });
  M = derive(P, ops);
  assert.equal(M.rows.filter((r) => r.session === 4).length, 2);
  assert.equal(M.rows.filter((r) => r.swimmerId === 2).length, 1);
  assert.equal(nowEvent(M.rows.filter((r) => r.session === 2), 10 * 60 + 21), 11);
});

test('results: Hy-Tek results text, live page links, screenshots and photos', () => {
  const P = pkg(); const M = derive(P, []);
  const txt = ['Event 11 Girls 13 & Over 100 Yard Backstroke', 'Preliminaries', '  1 Lane, Penny 17 Nsea Swim-NC 1:00.10 59.70q', '  2 Other, Person 16 RSA-NC 1:04.00 1:03.00q', ' -- Fishman, Coral A 15 Nsea Swim-NC 1:06.20 DQ'].join('\n');
  const list = resultsFromText(P, M, txt, { source: 'live' });
  assert.deepEqual(list.map((r) => [r.entry, r.time, r.status, r.place]), [['11-P-2', 5970, 'OK', 1], ['11-P-1', null, 'DQ', null]]);
  assert.equal(parseResults(txt.split('\n'))[0].qualified, true);
  const html = '<html><body><a href="260011P001.htm">#11 Girls 13 &amp; Over 100 Back</a><pre>Event 11 Girls 13 &amp; Over 100 Yard Backstroke\n  1 Lane, Penny 17 Nsea Swim-NC 1:00.10 59.70</pre></body></html>';
  assert.match(htmlToText(html), /Lane, Penny 17/);
  assert.deepEqual(resultLinks(html, 'https://results.example.org/live/index.htm').map((l) => [l.href, l.event]), [['https://results.example.org/live/260011P001.htm', 11]]);
  const shot = screenshotResults(P, M, 'Results\nPenny Lane\n17 NSEA 59.88\nCoral Fishman 15  1:05.01', { event: 11 });
  assert.deepEqual(shot.results.map((r) => [r.entry, r.time]), [['11-P-1', 6501], ['11-P-2', 5988]]);
  // Meet Mobile style title, no event number we can parse, favorites-filtered list
  const mm = screenshotResults(P, M, 'W 13 & Over 100 Back\nFavorites\n1 Penny Lane 17 NSEA 59.70\n5 Coral Fishman 15 NSEA 1:05.40', { session: 2 });
  assert.equal(mm.event, 11); assert.deepEqual(mm.results.map((r) => r.time), [6540, 5970]);
  assert.equal(screenshotResults(P, M, 'Results\nsomething unreadable', { session: 2 }).event, null);
  assert.equal(extractByName('Lane, Penny  DQ', [{ id: 'a', name: 'Lane, Penny' }])[0].status, 'DQ');
  const photo = photoHeatRows(P, M, 'Heat 2 of 3\n4 Fishman, Coral 15 Nsea Swim-NC 1:05.10\n5 Someone, Else 15 GCY-NC 1:05.00', 4, 11);
  assert.deepEqual(photo.rows.map((r) => [r.swimmerId, r.event, r.round, r.heat, r.lane]), [[1, 11, 'Finals', 2, 4]]);
  // OCR as it really comes back: "0f", squashed team name, event only in the continuation header
  const ocr = photoHeatRows(P, M, 'Heat 10 Prelims (#11 Girls 13 & Over 100 Yard Backstroke)\n9 Other, Person 16 CA-sC 1:02.11\nHeat 110f13 Prelims Startsat 10:34 AM\n10 Lane, Penny 17 NseaSwim-NC 1:02.72', 2, null);
  assert.deepEqual(ocr.rows.map((r) => [r.swimmerId, r.event, r.round, r.heat, r.lane, r.seed]), [[2, 11, 'Prelims', 11, 10, 6272]]);
});

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { db.prepare(sql).run(...b); return {}; },
    _run: () => db.prepare(sql).run(...b) }) });
  return { DB: { prepare: (sql) => { const p = prep(sql); return { ...p, ...p.bind(), bind: p.bind }; }, batch: async (list) => list.map((s) => s._run()) } };
}

test('worker: load meet, sync ops idempotently, coach access, owner-only delete, fetch guard', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const log = [];
  const audit = async (...a) => log.push(a);
  const owner = { email: 'o@x.org', name: 'Owner', roles: ['owner'] };
  const coach = { email: 'c@x.org', name: 'Coach', roles: ['coach'] };
  const call = async (me, method, path, body = {}, qs = '') => { const r = await handleMeetdayAdmin(env, me, method, path, body, audit, new URL('https://x.test/api/admin' + path + qs)); return { status: r.status, json: await r.json() }; };
  assert.equal((await call(owner, 'POST', '/meetday/meet', { pkg: { format: 'nope' } })).status, 400);
  assert.equal((await call(owner, 'POST', '/meetday/meet', { pkg: pkg() })).status, 200);
  assert.equal((await call(coach, 'POST', '/meetday/meet', { pkg: pkg() })).status, 409);
  const list = await call(coach, 'GET', '/meetday/meets');
  assert.equal(list.json.meets[0].id, 'test-meet');
  const got = await call(coach, 'GET', '/meetday/meet/test-meet');
  assert.equal(got.json.pkg.name, 'Test Invite');
  const ops = [{ id: 'abcdefgh1', at: '2026-11-14T15:00:00.000Z', type: 'result', data: { entry: '11-P-1', time: 6540 } }, { id: 'abcdefgh2', type: 'note', data: { entry: '11-P-1', text: 'hi' } }, { id: 'bad', type: 'result', data: {} }, { id: 'abcdefgh3', type: 'nope', data: {} }];
  assert.equal((await call(coach, 'POST', '/meetday/ops', { meet: 'test-meet', ops })).json.accepted, 2);
  await call(coach, 'POST', '/meetday/ops', { meet: 'test-meet', ops }); // retry: no duplicates
  const pulled = await call(owner, 'GET', '/meetday/ops', {}, '?meet=test-meet&since=0');
  assert.equal(pulled.json.ops.length, 2); assert.equal(pulled.json.ops[0].by, 'Coach'); assert.equal(pulled.json.ops[0].data.time, 6540);
  const later = await call(owner, 'GET', '/meetday/ops', {}, `?meet=test-meet&since=${pulled.json.last}`);
  assert.equal(later.json.ops.length, 0);
  assert.equal((await call(coach, 'POST', '/meetday/delete', { id: 'test-meet' })).status, 403);
  assert.equal((await call(owner, 'POST', '/meetday/fetch', { url: 'http://localhost/x' })).status, 400);
  assert.equal((await call(owner, 'POST', '/meetday/fetch', { url: 'file:///etc/passwd' })).status, 400);
  const fake = async () => new Response('<pre>hi</pre>', { headers: { 'content-type': 'text/html' } });
  const r = await handleMeetdayAdmin(env, owner, 'POST', '/meetday/fetch', { url: 'https://results.example.org/' }, audit, new URL('https://x.test/'), fake);
  assert.equal((await r.json()).text, '<pre>hi</pre>');
  assert.equal((await call(owner, 'POST', '/meetday/delete', { id: 'test-meet' })).status, 200);
  assert.equal((await call(owner, 'GET', '/meetday/meets')).json.meets.length, 0);
  assert.ok(log.some((l) => l[1] === 'load meet'));
  for (const h of ['10.0.0.1', '192.168.1.5', '172.20.1.1', '::1', 'intranet', 'x.local']) assert.ok(blockedHost(h), h);
  assert.ok(!blockedHost('swimmeet.example.com'));
});
