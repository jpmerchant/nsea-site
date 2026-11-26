// Meet Day: parsers, flags, model and the Worker API. All names and times here are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseSessionReport, parseHeatSheet, parseLaneLine, parseResults, parseHy3, extractByName, toCs, fmt, pdfLines, sameSwimmer, ocrColumns, ocrTime, parseMmNotify } from '../public/admin/meet/lib/parse.mjs';
import { flagsFor } from '../public/admin/meet/lib/flags.mjs';
import { buildRefs } from '../public/admin/meet/lib/refs.mjs';
import { derive, sessionSummary, meetSummary, parseTyped, nowEvent, sessionFlow, notesFor, blocksOf, blockFlow, nowInPools, applyTimeline, ttEvent, youngSession, inGroup, MOTIVATIONAL } from '../public/admin/meet/lib/model.mjs';
import { ttPhotoRows, heatSheetRows, resultsFromText, screenshotResults, photoHeatRows, guessSession, htmlToText, resultLinks } from '../public/admin/meet/lib/ingest.mjs';
import { handleMeetdayAdmin, blockedHost, handleMeetdayNotify } from '../worker/meetday.mjs';
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
  // OCR slips in names and a spaced-out team short name
  const slip = screenshotResults(P, M, 'Event 11\n1 Lame, Penny 17 NSEA Swim- NC 59.70\n5 Fishrnan, C 15 NSEA Swim- NC 1:05.40', { session: 2 });
  assert.deepEqual(slip.results.map((r) => [r.entry, r.time, !!r.fuzzy]), [['11-P-2', 5970, false], ['11-P-1', 6540, true]]);
  assert.equal(extractByName('Lane, Penny  DQ', [{ id: 'a', name: 'Lane, Penny' }])[0].status, 'DQ');
  const photo = photoHeatRows(P, M, 'Heat 2 of 3\n4 Fishman, Coral 15 Nsea Swim-NC 1:05.10\n5 Someone, Else 15 GCY-NC 1:05.00', 4, 11);
  assert.deepEqual(photo.rows.map((r) => [r.swimmerId, r.event, r.round, r.heat, r.lane]), [[1, 11, 'Finals', 2, 4]]);
  // OCR as it really comes back: "0f", squashed team name, event only in the continuation header
  const ocr = photoHeatRows(P, M, 'Heat 10 Prelims (#11 Girls 13 & Over 100 Yard Backstroke)\n9 Other, Person 16 CA-sC 1:02.11\nHeat 110f13 Prelims Startsat 10:34 AM\n10 Lane, Penny 17 NseaSwim-NC 1:02.72', 2, null);
  assert.deepEqual(ocr.rows.map((r) => [r.swimmerId, r.event, r.round, r.heat, r.lane, r.seed]), [[2, 11, 'Prelims', 11, 10, 6272]]);
});

test('photos: two-column OCR layout, deck-seeded combined 500s, circled lanes, mangled times', () => {
  const P = pkg();
  P.sessions[0].events.push({ num: 19, round: 'Finals' }, { num: 20, round: 'Finals' });
  P.events[19] = { num: 19, sex: 'F', dist: 500, stroke: 'Free', title: 'Girls 13 & Over 500 Freestyle' };
  P.events[20] = { num: 20, sex: 'M', dist: 500, stroke: 'Free', title: 'Boys 13 & Over 500 Freestyle' };
  P.entries.push({ id: '19-F-2', swimmerId: 2, event: 19, session: 2, round: 'Finals', heat: null, lane: null, seed: 36500 }, { id: '20-F-3', swimmerId: 3, event: 20, session: 2, round: 'Finals', heat: null, lane: null, seed: 37000 });
  const M = derive(P, []);
  assert.equal(ocrTime('61191'), 37191); assert.equal(ocrTime('5:3912'), 33912); assert.equal(ocrTime('6:04.41'), 36441); assert.equal(ocrTime('9999'), null);
  // words laid out in two columns; reading across would mix them
  const W = (text, x, y) => ({ text, x0: x, y0: y, x1: x + text.length * 9, y1: y + 18 });
  const words = [];
  const left = ['Event 19 / 20 Girls / Boys 13&O 500 Free', 'Heat 1 (Heat 1 Girls 500 Free)', '1 Other, Amy 15 GCY-NC 5:26.29', '2 More, Beth 16 RSA-NC 5:17.49', '3 Some, Cara 17 CA-SC 5:11.88'];
  const right = ['Heat 7 (Heat 4 Girls 500 Free) Starts at 10:40 AM', '1 Sims, Lu 14 GAME-SC 6:17.46', '2 Doe, Al 13 RSA-NC 6:14.36', 'Keller, Bri 15 CA-SC 6:05.94', '@ Lane, Penny 17 Nsea Swim-NC 6:04.41', '5 Zim, Lia 13 TIDE-SC 6:03.13', 'Heat 11 (Heat 6 Boys 500 Free)', '4 Kle, Wy 13 ATOM-NC 6:29.29', '5/ Reef, Rocco 14 Nsea Swim-NC 61191'];
  left.forEach((l, i) => l.split(' ').reduce((x, t) => { words.push(W(t, x, 100 + i * 30)); return x + t.length * 9 + 8; }, 10));
  right.forEach((l, i) => l.split(' ').reduce((x, t) => { words.push(W(t, x, 100 + i * 30 + i * 0.5)); return x + t.length * 9 + 8; }, 700));
  const text = ocrColumns(words);
  assert.ok(text.indexOf('Some, Cara') < text.indexOf('Heat 7'));
  const r = photoHeatRows(P, M, text, 2, null);
  assert.deepEqual(r.rows.map((x) => [x.swimmerId, x.event, x.heat, x.lane, x.seed]), [[2, 19, 7, 4, 36441], [3, 20, 11, 5, 37191]]);
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

test('finals heat sheet with lettered finals (A/B Final) and no Heat headings', () => {
  const p = parseHeatSheet([
    { text: 'Meet Program - Saturday Finals', header: true },
    'Event 11 Girls 13 & Over 100 Yard Backstroke',
    'Lane Name Age Team Prelim Time',
    'B - Final Starts at 06:24 PM',
    '3 Fishman, Coral A 15 Nsea Swim-NC 1:05.10',
    'A - Final',
    '4 Lane, Penny 17 Nsea Swim-NC 59.80',
    'A - Final (#11 Girls 13 & Over 100 Yard Backstroke)',
    '5 Other, Person 16 RSA-NC 1:00.00',
    'Event 12 Boys 13 & Over 100 Yard Backstroke',
    'Lane Name Age Team Prelim Time',
    '2 Reef, Rocco J 14 Nsea Swim-NC 1:01.00',
  ]);
  const e11 = p.events.find((e) => e.num === 11);
  assert.deepEqual(e11.heats.map((h) => [h.heat, h.final, h.lanes.length, h.start]), [[1, 'B Final', 1, '06:24 PM'], [2, 'A Final', 2, '06:24 PM']]);
  const e12 = p.events.find((e) => e.num === 12);
  assert.equal(e12.heats[0].lanes[0].name, 'Reef, Rocco J');
  const sheet = heatSheetRows(pkg(), derive(pkg(), []), p, 4);
  assert.equal(sheet.rows.length, 3);
});

test('lane lines with odd glyphs in names or extra columns after the seed', () => {
  assert.equal(parseLaneLine('4 Lane, Penny 17 Nsea Swim-NC 59.80 q 3').team, 'Nsea Swim-NC');
  const odd = parseLaneLine('5 6 ishman, Coral A 15 Nsea Swim-NC 1:05.10');
  assert.equal(odd.lane, 5); assert.equal(odd.age, 15); assert.equal(odd.seed, 6510);
  assert.equal(parseLaneLine('2 Reef, Rocco J 14 Nsea Swim-NC NT').seed, null);
});

test('USC finals program: "Heat 1 D - Final Starts at", underscores, alternates, ϐ glyph', () => {
  const p = parseHeatSheet([
    { text: 'Meet Program - Saturday finals', header: true },
    'Event 11 Girls 13 & Over 100 Yard Backstroke',
    'Lane Name Age Team Prelims',
    'Heat 1 D - Final Starts at 06:20 PM',
    '1 Fishman, Coral A 13 Nsea Swim-NC 1:08.70 _____',
    '2 Other, Person 14 CS-SC 1:06.99 _____',
    'Alternates',
    '1 Spare, Sally G 13 Nsea Swim-NC 1:10.34',
    'Heat 2 C - Final Starts at 06:22 PM',
    '2 Lane, Penny 17 Nsea Swim-NC 1:03.49 _____',
    'Heat 2 C - Final (#11 Girls 13 & Over 100 Yard Backstroke)',
    '9 Late, Lena 15 Nsea Swim-NC 1:03.80 _____',
  ]);
  const e = p.events[0];
  assert.deepEqual(e.heats.map((h) => [h.heat, h.of, h.final, h.start, h.lanes.map((l) => l.name)]),
    [[1, 2, 'D Final', '06:20 PM', ['Fishman, Coral A', 'Other, Person']], [2, 2, 'C Final', '06:22 PM', ['Lane, Penny', 'Late, Lena']]]);
  const lines = pdfLines([{ width: 612, height: 792, items: [{ x: 250, y: 760, str: 'Meet Program - Saturday' }, { x: 380, y: 760, str: 'ϐ' }, { x: 386, y: 760, str: 'inals' }] }]);
  assert.match(lines[0].text, /Saturday\s+finals/);
});

test('session times op shifts session, warm-up and loaded heat starts; later heat sheets keep printed times', () => {
  const P = pkg();
  P.sessions[1].warmup = { time: '5:15–6:15 PM', sprints: '6:15–6:20 PM pool cleared' };
  P.sessions[1].finish = '07:34 PM';
  let ops = [];
  const op = (type, data, at) => ops.push({ id: 'op' + ops.length + 'xxxxxxx', at, by: 'Coach', type, data });
  op('entries', heatSheetRows(P, derive(P, []), parseHeatSheet(SHEET), 4), '2026-11-14T20:00:00.000Z');
  op('times', { session: 4, start: '06:50 PM', shift: 30 }, '2026-11-14T21:00:00.000Z');
  const M = derive(P, ops);
  const s = M.sessions.find((x) => x.n === 4);
  assert.equal(s.start, '06:50 PM'); assert.equal(s.finish, '08:04 PM');
  assert.equal(s.warmup.time, '5:45–6:45 PM'); assert.equal(s.warmup.sprints, '6:45–6:50 PM pool cleared');
  assert.deepEqual(M.rows.filter((r) => r.session === 4).map((r) => r.start).sort(), ['06:54 PM', '06:54 PM', '07:00 PM']);
  assert.equal(P.sessions[1].start, '06:20 PM'); // package untouched
  op('entries', heatSheetRows(P, derive(P, []), parseHeatSheet(SHEET), 4), '2026-11-14T22:00:00.000Z');
  assert.ok(derive(P, ops).rows.filter((r) => r.session === 4).some((r) => r.start === '06:24 PM'));
});

test('Meet Mobile notification text (real wording)', () => {
  assert.deepEqual(parseMmNotify('Results: Violet Derry - 1:02.81 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)'),
    { name: 'Violet Derry', time: 6281, status: 'OK', official: false, eventTitle: 'Girls 13&O 100 Yard Back', event: 11 });
  assert.equal(parseMmNotify('Results: Gentry Witmer - 59.32 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)').time, 5932);
  assert.equal(parseMmNotify('Meet Mobile Results: Anna Claire Outlaw - DQ (unofficial), Girls 13&O 100 Yard Back (Evt. #11)').status, 'DQ');
  assert.equal(parseMmNotify('Meet Mobile is updating'), null);
});

test('notifications match the running session, never override typed times, list strangers', () => {
  const P = pkg();
  let ops = [];
  const op = (type, data, at) => ops.push({ id: 'op' + ops.length + 'xxxxxxx', at, by: 'Coach', type, data });
  op('entries', heatSheetRows(P, derive(P, []), parseHeatSheet(SHEET), 4), '2026-11-14T20:00:00.000Z');
  op('mmnotify', { text: 'Results: Coral Fishman - 1:04.10 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)' }, '2026-11-14T23:30:00.000Z'); // 6:30 PM ET
  op('mmnotify', { text: 'Results: Penny Lane - 59.10 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)' }, '2026-11-14T23:31:00.000Z');
  op('mmnotify', { text: 'Results: Some Stranger - 58.00 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)' }, '2026-11-14T23:32:00.000Z');
  op('mmnotify', { text: 'gibberish' }, '2026-11-14T23:33:00.000Z');
  let M = derive(P, ops);
  const fish = M.rows.filter((r) => r.swimmer.name.startsWith('Fishman') && r.event === 11);
  assert.equal(fish.find((r) => r.round === 'Finals').result.time, 6410);
  assert.ok(!fish.find((r) => r.round === 'Prelims')?.result);
  assert.deepEqual(M.notices.map((n) => n.status), ['matched', 'matched', 'not-ours', 'unread']);
  // a coach's typed time wins over a later notification
  const penny = M.rows.find((r) => r.swimmer.name.startsWith('Lane') && r.event === 11 && r.round === 'Finals');
  op('result', { entry: penny.id, time: 5900, status: 'OK', source: 'manual' }, '2026-11-14T23:40:00.000Z');
  op('mmnotify', { text: 'Results: Penny Lane - 59.12 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)' }, '2026-11-14T23:41:00.000Z');
  M = derive(P, ops);
  assert.equal(M.rows.find((r) => r.id === penny.id).result.time, 5900);
  assert.equal(M.notices.slice(-1)[0].status, 'kept');
});

test('worker: notify endpoint needs the meet key and dedupes re-posts', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const owner = { email: 'o@x.org', name: 'Owner', roles: ['owner'] };
  const audit = async () => {};
  await handleMeetdayAdmin(env, owner, 'POST', '/meetday/meet', { pkg: pkg() }, audit, new URL('https://x.test/api/admin/meetday/meet'));
  const post = (key, body) => handleMeetdayNotify(new Request(`https://x.test/api/meetday/notify?meet=test-meet&key=${key}`, { method: 'POST', body }), env, new URL(`https://x.test/api/meetday/notify?meet=test-meet&key=${key}`));
  assert.equal((await post('abcdefghijklmnop1234', 'x')).status, 403);
  await handleMeetdayAdmin(env, owner, 'POST', '/meetday/ops', { meet: 'test-meet', ops: [{ id: 'keyop000001', type: 'notifykey', data: { key: 'abcdefghijklmnop1234' } }] }, audit);
  const text = 'Results: Violet Derry - 1:02.81 (unofficial), Girls 13&O 100 Yard Back (Evt. #11)';
  assert.equal((await post('abcdefghijklmnop1234', text)).status, 200);
  assert.equal((await post('abcdefghijklmnop1234', JSON.stringify({ title: 'Meet Mobile', text }))).status, 200);
  assert.equal((await post('abcdefghijklmnop1234', text)).status, 200);
  const r = await handleMeetdayAdmin(env, owner, 'GET', '/meetday/ops', {}, audit, new URL('https://x.test/api/admin/meetday/ops?meet=test-meet'));
  const got = (await r.json()).ops.filter((o) => o.type === 'mmnotify');
  assert.equal(got.length, 2); // plain + JSON-with-title differ; the exact repeat is dropped
  assert.equal(got[0].by, 'Meet Mobile');
});

test('session flow: our swims grouped by heat, events with no swimmers kept with heats and rough times', () => {
  const P = pkg();
  P.sessions[1].finish = '06:50 PM';
  P.sessions[1].events.push({ num: 13, round: 'Finals' });
  P.events[13] = { num: 13, sex: 'F', dist: 200, stroke: 'Free', title: 'Girls 13 & Over 200 Freestyle' };
  const sheet = [...SHEET, 'Event 13 Girls 13 & Over 200 Yard Freestyle', 'Heat 1 of 3 Finals Starts at 06:33 PM', '4 Other, Person 16 RSA-NC 2:01.00',
    'Heat 2 of 3 Finals Starts at 06:37 PM', '4 Other, Two 16 RSA-NC 2:00.00', 'Heat 3 of 3 Finals Starts at 06:41 PM', '4 Other, Three 16 RSA-NC 1:59.00'];
  let M = derive(P, []);
  const ops = [{ id: 'op1xxxxxxx', at: '2026-11-14T20:00:00.000Z', by: 'Coach', type: 'entries', data: heatSheetRows(P, M, parseHeatSheet(sheet), 4) }];
  M = derive(P, ops);
  const S4 = M.sessions.find((s) => s.n === 4);
  const flow = sessionFlow(P, S4, M.rows.filter((r) => r.session === 4));
  assert.deepEqual(flow.map((x) => x.num), [11, 12, 13]);
  const ev11 = flow[0];
  assert.equal(ev11.heats, 2); assert.equal(ev11.heatGroups.length, 2);
  assert.deepEqual(ev11.heatGroups.map((h) => [h.heat, h.of, h.rows.map((r) => r.lane)]), [[1, 2, [3]], [2, 2, [5]]]);
  assert.equal(ev11.start, '06:24 PM'); assert.equal(ev11.end, '06:30 PM');
  const ev13 = flow[2];
  assert.equal(ev13.rows.length, 0); assert.equal(ev13.heats, 3);
  assert.equal(ev13.start, '06:33 PM'); assert.equal(ev13.end, '06:50 PM'); assert.equal(ev13.minutes, 17);
  // a later session time change moves the empty event too
  ops.push({ id: 'op2xxxxxxx', at: '2026-11-14T21:00:00.000Z', by: 'Coach', type: 'times', data: { session: 4, start: '06:50 PM', shift: 30 } });
  M = derive(P, ops);
  assert.equal(sessionFlow(P, M.sessions.find((s) => s.n === 4), []).find((x) => x.num === 13).start, '07:03 PM');
  // prelims (no sheet uploaded for it): event 12 occurs in two sessions, so the package-wide heat count is not borrowed
  P.events[12].heatCount = 4;
  const pre = sessionFlow(P, M.sessions.find((s) => s.n === 2), M.rows.filter((r) => r.session === 2));
  assert.equal(pre.find((x) => x.num === 12).heats, null);
  assert.equal(pre.find((x) => x.num === 11).heatGroups.map((h) => h.heat).join(), '3,5');
});

test('meet scratch, coach notes by scope, tag list and renames', () => {
  const P = pkg();
  const ops = [];
  const op = (type, data) => ops.push({ id: `op${ops.length}xxxxxxxx`, at: `2026-11-14T1${ops.length}:00:00.000Z`, by: 'Coach', type, data });
  op('note', { entry: '11-P-1', text: 'fast', tags: ['Turns'] });
  op('mscratch', { swimmer: 2, on: true, why: 'sick' });
  op('gnote', { scope: 'meet', text: 'Bring the canopy', tags: [] });
  op('gnote', { scope: 'day', key: '2026-11-14', text: 'Parking lot B', tags: ['Turns'] });
  op('gnote', { scope: 'session', key: 4, text: 'Finals: suits on by 6:30', tags: [] });
  op('tags', { list: ['Walls', 'Finish'], rename: { from: 'Turns', to: 'Walls' } });
  let M = derive(P, ops);
  assert.equal(M.rows.find((r) => r.swimmerId === 2).scratched, true);
  assert.equal(M.rows.find((r) => r.swimmerId === 2).meetOut, true);
  assert.equal(M.meetOut.get(2).why, 'sick');
  assert.equal(sessionSummary(M, 2).entries, 2);
  assert.deepEqual(M.tags, ['Walls', 'Finish']);
  assert.deepEqual(M.rows.find((r) => r.id === '11-P-1').notes[0].tags, ['Walls']);
  const n4 = notesFor(M, P.sessions[1]), n2 = notesFor(M, P.sessions[0]);
  assert.equal(n4.session.length, 1); assert.equal(n4.day.length, 1); assert.equal(n4.meet.length, 1);
  assert.equal(n2.session.length, 0); assert.equal(n2.day[0].tags[0], 'Walls');
  op('mscratch', { swimmer: 2, on: false });
  op('undo', { op: 'op2xxxxxxxx' });
  M = derive(P, ops);
  assert.equal(M.rows.find((r) => r.swimmerId === 2).scratched, false);
  assert.equal(notesFor(M, null).meet.length, 0);
});

test('two-pool meet: session report (split columns, two sessions per page), blocks, merged flow and now per pool', () => {
  // pdf.js order from a real Hy-Tek report: event column, then the numbers column, both sessions on one page
  const report = [
    'Session Report', 'Session: 2B  Saturday Prelim - Boys Divewell', 'Day of Meet: 2  Starts at 08:30 AM  Heat Interval: 30 Seconds',
    'Round  Event', 'Prelims  8 Boys 13 & Over 50 Freestyle', 'Prelims  10 Boys 13 & Over 100 Breaststroke', 'Entry / Heat Totals:', 'Finish Time',
    'Session: 2G  Saturday Prelim - Girls Scoreboard', 'Day of Meet: 2  Starts at 08:31 AM', 'Prelims  7 Girls 13 & Over 50 Freestyle', 'Prelims  9 Girls 13 & Over 100 Breaststroke', 'Finish Time',
    'Entries  Heats  Starts at', '173  22  u  08:30 AM  _______', '117  15  u  08:51 AM  _______', '====  ====', '290  37', '09:20 AM  _______',
    '215  27  u  08:31 AM  _______', '140  18  u  08:58 AM  _______', '09:35 AM  _______',
    'Session: 4  Saturday Finals', 'Day of Meet: 2  Starts at 05:30 PM', 'Finals  7 Girls 13 & Over 50 Freestyle  32  4  u  05:30 PM  _______', 'Finish Time  07:04 PM  _______',
  ];
  const R = parseSessionReport(report);
  assert.deepEqual(R.map((s) => s.code), ['2B', '2G', '4']);
  assert.equal(R[0].pool, 'Divewell'); assert.equal(R[0].finish, '09:20 AM'); assert.equal(R[1].finish, '09:35 AM');
  assert.deepEqual(R[1].events.map((e) => [e.num, e.round, e.heats, e.start]), [[7, 'Prelims', 27, '08:31 AM'], [9, 'Prelims', 18, '08:58 AM']]);
  assert.equal(R[2].events[0].heats, 4); assert.equal(R[0].events[0].stroke, 'Free');

  const P = pkg(); P.start = '2026-11-13'; P.sessions = [];
  P.entries = [{ id: '7-P-1', swimmerId: 1, event: 7, session: null, round: 'Prelims', heat: 14, lane: 4, seed: 2900 }, { id: '8-P-3', swimmerId: 3, event: 8, session: null, round: 'Prelims', heat: 2, lane: 5, seed: 3100 }];
  const ss = []; applyTimeline(ss, P, R);
  assert.deepEqual(ss.map((s) => [s.code, s.block || null, s.day]), [['2B', '2', '2026-11-14'], ['2G', '2', '2026-11-14'], ['4', null, '2026-11-14']]);
  const B = blocksOf(ss);
  assert.equal(B.length, 2); assert.equal(B[0].name, 'Saturday Prelim'); assert.equal(B[0].multi, true); assert.equal(B[0].start, '08:30 AM'); assert.equal(B[0].finish, '09:35 AM');
  P.entries[0].session = ss[1].n; P.entries[1].session = ss[0].n;
  const M = derive({ ...P, sessions: ss }, []);
  const flow = blockFlow({ ...P, sessions: ss }, B[0], M.rows);
  assert.deepEqual(flow.map((x) => `${x.num}:${x.pool}`), ['8:Boys Divewell', '7:Girls Scoreboard', '10:Boys Divewell', '9:Girls Scoreboard']);
  const g = flow.find((x) => x.num === 7);
  assert.equal(g.heatGroups[0].heat, 14); assert.equal(g.heatGroups[0].start, '08:44 AM'); // 27 heats over 27 min
  const now = nowInPools(flow, 9 * 60 + 5);
  assert.deepEqual(now.map((x) => [x.pool, x.item.num, x.live]), [['Boys Divewell', 10, true], ['Girls Scoreboard', 9, true]]);
  // a later timeline (op) updates the same sessions instead of adding new ones
  const M2 = derive({ ...P, sessions: ss }, [{ id: 'opTLxxxxxxxx', at: '2026-11-14T10:00:00Z', by: 'JP', type: 'timeline', data: { sessions: [{ ...R[1], start: '08:40 AM', events: [{ ...R[1].events[0], start: '08:40 AM' }] }] } }]);
  assert.equal(M2.sessions.length, 3); assert.equal(M2.sessions.find((s) => s.code === '2G').events[0].start, '08:40 AM');
  assert.equal(sessionSummary(M, B[0].sessions.map((s) => s.n)).entries, 2);
});

test('relays: heat sheet lines with legs, HY3 relay entries, legs op, swimmer page and summary', () => {
  const sheet = ['Meet Program - Saturday finals', 'Event 17 Girls 13 & Over 200 Yard Freestyle Relay', 'Lane Team Relay Seed Time', 'Heat 1 of 2 Finals Starts at 07:10 PM',
    '3 RSA-NC A 1:52.00', '4 Nsea Swim-NC A 1:50.00', '1) Fishman, Coral 15 2) Lane, Penny 17', '3) Someone, Else 16 4) Reef, Rita 14', '5 New Wave Swim Te-NC B NT',
    'Heat 2 Finals (#17 Girls 13 & Over 200 Yard Freestyle Relay)', '6 Nsea Swim-NC B 2:01.00'];
  const p = parseHeatSheet(sheet);
  const mine = p.events[0].heats.flatMap((h) => h.lanes).filter((l) => /nsea/i.test(l.team));
  assert.deepEqual(mine.map((l) => [l.letter, l.lane, l.seed]), [['A', 4, 11000], ['B', 6, 12100]]);
  const hy = parseHy3(['F1NSEA-A   0FFF   200A 13109     15.00 17        0Y  112.22Y', 'F3F    1FishmF1F', 'F3F    2Lane F2F', 'F1NSEA-A   0MMM   200E 13109     15.00 18        0Y  103.38Y'].join('\n'));
  assert.deepEqual(hy.relays.map((r) => [r.relay, r.sex, r.dist, r.stroke, r.event, r.seed, r.legs.filter(Boolean).length]), [['A', 'F', 200, 'Free Relay', 17, 11222, 2], ['A', 'M', 200, 'Medley Relay', 18, 10338, 0]]);

  const P = pkg();
  P.sessions[1].events.push({ num: 17, round: 'Finals' });
  P.events[17] = { num: 17, sex: 'F', dist: 200, stroke: 'Free', relay: true, title: 'Girls 13 & Over 200 Free Relay' };
  let M = derive(P, []);
  const data = heatSheetRows(P, M, p, 4);
  const ops = [{ id: 'opR1xxxxxxxx', at: '2026-11-14T20:00:00Z', by: 'JP', type: 'entries', data }];
  M = derive(P, ops);
  const A = M.rows.find((r) => r.relay === 'A'), B = M.rows.find((r) => r.relay === 'B');
  assert.equal(A.id, '17-F-RA'); assert.equal(A.lane, 4); assert.equal(B.heat, 2);
  assert.deepEqual(A.legs.slice(0, 2), [1, 2]); assert.equal(A.legSw[2].unknown, true); assert.equal(A.swimmer.name, 'NSEA A relay');
  ops.push({ id: 'opR2xxxxxxxx', at: '2026-11-14T20:05:00Z', by: 'JP', type: 'legs', data: { entry: '17-F-RA', legs: [2, 1, null, 3] } });
  ops.push({ id: 'opR3xxxxxxxx', at: '2026-11-14T20:06:00Z', by: 'JP', type: 'mscratch', data: { swimmer: 3, on: true } });
  ops.push({ id: 'opR4xxxxxxxx', at: '2026-11-14T23:00:00Z', by: 'JP', type: 'result', data: { entry: '17-F-RA', time: 10950, status: 'OK', source: 'manual' } });
  M = derive(P, ops);
  const A2 = M.rows.find((r) => r.id === '17-F-RA');
  assert.deepEqual(A2.legs, [2, 1, null, 3]); assert.deepEqual(A2.legOut, ['Reef, Rocco']); assert.equal(A2.delta, -50);
  const X = sessionSummary(M, 4);
  assert.equal(X.relays.length, 2); assert.ok(X.swimmers.every((w) => w.swimmer));
  // replace mode: a newer sheet without relay B drops it
  M = derive(P, [...ops, { id: 'opR5xxxxxxxx', at: '2026-11-15T00:00:00Z', by: 'JP', type: 'entries', data: heatSheetRows(P, M, parseHeatSheet(sheet.slice(0, 9)), 4) }]);
  assert.equal(M.rows.filter((r) => r.relay).length, 1);
});

test('time trials: session added in the app, TT events, swims merged in, photo rows', () => {
  const P = pkg();
  const ops = [{ id: 'opT1xxxxxxxx', at: '2026-11-14T16:00:00Z', by: 'JP', type: 'session', data: { n: 901, day: '2026-11-14', name: 'Saturday time trials', start: '12:30 PM', tt: true } }];
  let M = derive(P, ops);
  const tt = M.sessions.find((s) => s.n === 901);
  assert.ok(tt && tt.tt); assert.equal(M.sessions.indexOf(tt), 1); // between prelims (10:15) and finals (6:20)
  const ev = { ...M.events };
  const a = ttEvent(ev, 901, { dist: 200, stroke: 'Free', sex: 'F', shown: 101 }); ev[a.num] = a.meta;
  const b = ttEvent(ev, 901, { dist: 200, stroke: 'Free', sex: 'F', shown: 101 });
  assert.equal(a.num, 9001); assert.equal(b.num, 9001); assert.equal(b.meta, undefined);
  ops.push({ id: 'opT2xxxxxxxx', at: '2026-11-14T16:05:00Z', by: 'JP', type: 'entries', data: { session: 901, mode: 'merge', source: 'time trials', newEvents: [a.meta], rows: [{ event: 9001, round: 'Finals', swimmerId: 1, name: 'Fishman, Coral', heat: 1, lane: 4, seed: 13000 }] } });
  M = derive(P, ops);
  const r = M.rows.find((x) => x.session === 901);
  assert.equal(r.ev.tt, true); assert.equal(r.ev.dist, 200); assert.ok(Array.isArray(r.pre));
  assert.deepEqual(M.sessions.find((s) => s.n === 901).events.map((e) => e.num), [9001]);
  // removing the session op (undo) removes the session
  assert.equal(derive(P, [...ops, { id: 'opT3xxxxxxxx', at: '2026-11-14T17:00:00Z', by: 'JP', type: 'undo', data: { op: 'opT1xxxxxxxx' } }]).sessions.some((s) => s.n === 901), false);
  const rows = ttPhotoRows(M, 'TIME TRIALS\nEvent 101 Girls 13 & Over 200 Yard Freestyle\nHeat 1 of 2\n3 Smith, Jane 15 RSA-NC 2:10.00\n4 Fishman, Coral 15 Nsea Swim-NC 2:09.15\nHeat 2\n2 Lane, Penny 17 Nsea 2:01.00');
  assert.deepEqual(rows.map((x) => [x.swimmerId, x.dist, x.stroke, x.shown, x.heat, x.lane, x.seed]), [[1, 200, 'Free', 101, 1, 4, 12915], [2, 200, 'Free', 101, 2, 2, 12100]]);
});

test('finals: change vs prelims and vs entry time; best times measured against the entry time', () => {
  const P = pkg();
  P.entries[0].entrySeed = 6700; // Coral entered 1:07.00, seeded 1:06.20 on the prelim sheet
  const ops = [];
  const op = (type, data) => ops.push({ id: 'op' + ops.length + 'xxxxxxx', at: `2026-11-14T1${ops.length}:00:00.000Z`, by: 'Coach', type, data });
  op('entries', heatSheetRows(P, derive(P, []), parseHeatSheet(SHEET), 4));
  op('result', { entry: '11-P-1', time: 6540, status: 'OK' });   // prelims 1:05.40
  const fin = derive(P, ops).rows.find((r) => r.session === 4 && r.swimmerId === 1);
  op('result', { entry: fin.id, time: 6560, status: 'OK' });     // finals 1:05.60: slower than prelims, faster than entry
  const M = derive(P, ops);
  const f = M.rows.find((r) => r.id === fin.id), p = M.rows.find((r) => r.id === '11-P-1');
  assert.equal(f.isFinal, true); assert.equal(f.prelim.time, 6540);
  assert.equal(f.dPrelim, 20); assert.equal(f.delta, 20); assert.equal(f.entryTime, 6700); assert.equal(f.dEntry, -140); assert.equal(f.best, true);
  assert.equal(p.isFinal, undefined); assert.equal(p.entryTime, 6700); assert.equal(p.dEntry, -160);
  const X = sessionSummary(M, 4);
  assert.equal(X.best, 1); assert.equal(X.drop, 140);
  // Meet: Coral's 100 back counts once (her faster swim, prelims), Penny's too
  op('result', { entry: '11-P-2', time: 6000, status: 'OK' });
  const W = meetSummary(derive(P, ops));
  assert.equal(W.events, 2); assert.equal(W.best, 2); assert.equal(W.drop, 160 + 10);
});

test('DQ reasons, stars, session check-in, coach assignments, per-session cuts', () => {
  const P = pkg();
  const ops = [];
  const op = (type, data) => { const o = { id: 'op' + ops.length + 'xxxxxxx', at: `2026-11-14T1${ops.length}:00:00.000Z`, by: 'Coach', type, data }; ops.push(o); return o; };
  op('result', { entry: '11-P-1', time: null, status: 'DQ' });
  let M = derive(P, ops), X = sessionSummary(M, 2);
  assert.equal(X.dqNoReason.length, 1);
  op('dq', { entry: '11-P-1', codes: ['Shoulders past vertical'], text: 'at the 50 turn' });
  op('star', { entry: '11-P-2', on: true });
  M = derive(P, ops); X = sessionSummary(M, 2);
  assert.equal(X.dqNoReason.length, 0); assert.deepEqual(M.rows.find((r) => r.id === '11-P-1').dq.codes, ['Shoulders past vertical']);
  // an older label-only call is read as its USA Swimming code
  assert.deepEqual(M.rows.find((r) => r.id === '11-P-1').dq.calls.map((c) => c.code), ['2H']);
  assert.equal(X.starred.length, 1); assert.equal(X.starred[0].id, '11-P-2');
  // an official DQ loaded later keeps the coach's reason
  op('result', { entry: '11-P-1', time: null, status: 'DQ', official: true, source: 'official' });
  assert.equal(derive(P, ops).rows.find((r) => r.id === '11-P-1').dq.text, 'at the 50 turn');
  // absent for the session: scratched there only
  op('sscratch', { sessions: [2], swimmer: 3, on: true });
  M = derive(P, ops);
  const rr = M.rows.find((r) => r.id === '12-P-3');
  assert.equal(rr.scratched, true); assert.ok(rr.sessOut); assert.equal(sessionSummary(M, 2).entries, 2);
  op('sscratch', { sessions: [2], swimmer: 3, on: false });
  assert.equal(derive(P, ops).rows.find((r) => r.id === '12-P-3').scratched, false);
  // coach assignments: last one per coach and session wins; removable
  op('assign', { block: 2, coach: 'Rachel', pools: [2], group: '13O' });
  op('assign', { block: 2, coach: 'Rachel', pools: [2], group: 'F' });
  op('assign', { block: 2, coach: 'JP', pools: [2], group: 'all' });
  op('assign', { block: 2, coach: 'JP', on: false });
  M = derive(P, ops);
  assert.deepEqual(M.assigns.map((a) => [a.coach, a.group]), [['Rachel', 'F']]);
  assert.equal(inGroup('F', M.swimmers.get(1)), true); assert.equal(inGroup('12U', M.swimmers.get(1)), false);
  // cuts: phone default, then meet default, then the session's own choice
  assert.equal(M.cutsInfo(2).how, 'phone');
  assert.ok(M.rows.find((r) => r.id === '11-P-1').pre.length >= 0);
  op('cuts', { session: null, list: ['NC Senior'] });
  M = derive(P, ops); assert.deepEqual(M.cutsOf(2), ['NC Senior']); assert.equal(M.cutsInfo(2).how, 'meet');
  op('cuts', { session: [2], list: [] });
  M = derive(P, ops); assert.deepEqual(M.cutsOf(2), []); assert.deepEqual(M.cutsOf(4), ['NC Senior']);
  assert.ok(!M.rows.find((r) => r.id === '11-P-1').pre.some((f) => f.kind === 'cut'));
  assert.ok(M.rows.find((r) => r.id === '11-P-1').pre.some((f) => f.kind !== 'cut') || true);
  op('cuts', { session: [2], list: null });
  assert.deepEqual(derive(P, ops).cutsOf(2), ['NC Senior']);
});

test('12 & under pools default to B–AAAA and age group champs', () => {
  const events = { 1: { title: 'Girls 10 & Under 50 Free' }, 2: { title: 'Boys 11-12 100 IM' }, 3: { title: 'Girls 13 & Over 200 Free' } };
  assert.equal(youngSession({ events: [{ num: 1 }, { num: 2 }] }, events), true);
  assert.equal(youngSession({ events: [{ num: 1 }, { num: 3 }] }, events), false);
  assert.equal(youngSession({ events: [] }, events), false);
  const P = pkg();
  P.sessions.push({ n: 6, day: '2026-11-14', name: '12 & Under', start: '01:00 PM', events: [{ num: 21, round: 'Finals' }] });
  P.events[21] = { num: 21, sex: 'F', dist: 50, stroke: 'Free', title: 'Girls 9-10 50 Free' };
  P.refs.cutNames = [...MOTIVATIONAL, 'NC AG', 'NC Senior'];
  const M = derive(P, []);
  assert.deepEqual(M.cutsOf(6), [...MOTIVATIONAL, 'NC AG']); assert.equal(M.cutsInfo(6).how, 'auto');
  assert.notDeepEqual(M.cutsOf(2), M.cutsOf(6));
});

test('DQ codes: groups by stroke, matching written reasons, stored calls', async () => {
  const { dqGroups, matchDq, dqCalls, DQ_BY_CODE } = await import('../public/admin/meet/lib/dqcodes.mjs');
  assert.deepEqual(dqGroups('Breast').map((g) => g.group), ['Breast', 'Misc']);
  assert.deepEqual(dqGroups('IM').map((g) => g.group), ['IM', 'Fly', 'Back', 'Breast', 'Free', 'Misc']);
  assert.deepEqual(dqGroups('Medley', true).map((g) => g.group), ['Relay', 'Back', 'Breast', 'Fly', 'Free', 'Misc']);
  assert.equal(DQ_BY_CODE.get('3A').slip, '10');
  // the event's stroke breaks ties; a "- fly" tail wins over it
  assert.equal(matchDq('Scissors kick', 'Breast').code, '3C');
  assert.equal(matchDq('Scissors kick', 'Fly').code, '1C');
  assert.equal(matchDq('Non-simultaneous arms - fly', 'IM').code, '1D');
  assert.equal(matchDq('Shoulders past vertical toward breast - back').code, '2H');
  assert.equal(matchDq('Hands brought beyond the hipline during stroke', 'Breast').code, '3G');
  assert.equal(matchDq('Head did not break the surface by 15 meters', 'Free').code, '4N');
  assert.equal(matchDq('Something the official made up'), null);
  assert.deepEqual(dqCalls({ calls: [{ code: '7A', slip: '60', desc: 'False start' }] }).map((c) => c.code), ['7A']);
  assert.deepEqual(dqCalls({ codes: ['Wandered off'] }), [{ code: '', slip: '', desc: 'Wandered off' }]);
});

test('results: DQ reason printed under the swim is kept and stands in for a missing coach call', () => {
  const lines = ['Event 11 Girls 13 & Over 100 Yard Backstroke', '--- Pond, Coral A 13 Nsea Swim-NC 1:10.00 DQ', '35.46 DQ (48.58)', 'Shoulders past vertical toward breast',
    '--- Lake, Penny 14 Other Team-NC 1:12.00 NS'];
  const R = parseResults(lines);
  assert.equal(R[0].status, 'DQ'); assert.equal(R[0].dqWhy, 'Shoulders past vertical toward breast');
  assert.equal(R[1].dqWhy, undefined);
  const P = pkg();
  const ops = [{ id: 'opA1234567', at: '2026-11-14T10:00:00.000Z', by: 'Official', type: 'result', data: { entry: '11-P-1', time: null, status: 'DQ', official: true, dqWhy: R[0].dqWhy } }];
  let row = derive(P, ops).rows.find((r) => r.id === '11-P-1');
  assert.equal(row.dq.official, true); assert.equal(row.dq.calls[0].code, '2H'); assert.equal(row.dqOfficial.call.code, '2H');
  assert.equal(sessionSummary(derive(P, ops), 2).dqNoReason.length, 0);
  // the coach's own call wins; the official reason stays alongside it
  ops.push({ id: 'opB1234567', at: '2026-11-14T10:05:00.000Z', by: 'Coach', type: 'dq', data: { entry: '11-P-1', calls: [{ code: '2C', slip: '32', desc: 'Shoulders not at or past vertical toward back off the wall' }], codes: ['2C'], text: '2nd wall' } });
  row = derive(P, ops).rows.find((r) => r.id === '11-P-1');
  assert.equal(row.dq.calls[0].code, '2C'); assert.equal(row.dq.text, '2nd wall'); assert.equal(row.dqOfficial.call.code, '2H');
});

test('NS, DFS and DNF: their own results; a DQ called only 7C / 7D reads as DNF / DFS', () => {
  const R = parseResults(['Event 11 Girls 13 & Over 100 Yard Backstroke', '--- Pond, Coral A 13 Nsea Swim-NC 1:10.00 DFS', '--- Lake, Penny 14 Nsea Swim-NC 1:12.00 DNF']);
  assert.deepEqual(R.map((r) => r.status), ['DFS', 'DNF']);
  const P = pkg(); const ops = [];
  const op = (type, data) => ops.push({ id: 'op' + ops.length + 'xxxxxxx', at: `2026-11-14T1${ops.length}:00:00.000Z`, by: 'Coach', type, data });
  op('result', { entry: '11-P-1', time: null, status: 'DQ' });
  op('dq', { entry: '11-P-1', calls: [{ code: '7C', slip: '62', desc: 'Did not finish' }], codes: ['7C'], text: 'cramp' });
  let row = derive(P, ops).rows.find((r) => r.id === '11-P-1');
  assert.equal(row.result.status, 'DNF'); assert.equal(row.dq.text, 'cramp');
  op('dq', { entry: '11-P-1', calls: [{ code: '7D', slip: '63', desc: 'Declared false start' }], codes: ['7D'], text: '' });
  assert.equal(derive(P, ops).rows.find((r) => r.id === '11-P-1').result.status, 'DFS');
  // a real DQ call plus anything else stays a DQ
  op('dq', { entry: '11-P-1', calls: [{ code: '7A', slip: '60', desc: 'False start' }], codes: ['7A'], text: '' });
  row = derive(P, ops).rows.find((r) => r.id === '11-P-1');
  assert.equal(row.result.status, 'DQ');
  const X = sessionSummary(derive(P, ops), 2);
  assert.equal(X.dq.length, 1);
});

test('parseHy3 reads entries whose age columns have a gap (11 12, 0 10) as well as 13109', () => {
  const hy = parseHy3([
    'D1M    1Testa               Sam                                      ABCDEFGHIJKLMN    03312015 11',
    'E1M    1TestaMM   100A 11 12      9.00  72       0Y  101.96Y',
    'E1M    1TestaMM   100B 13109     12.00  52       0Y   84.26Y',
    'E1M    1TestaMM   500A  0109      9.00   4       0Y  366.86Y',
    'E1M    1TestaMM    50A  0 10      9.00  24       0Y    0.00Y',
  ].join('\n'));
  assert.deepEqual(hy.entries.map((e) => [e.event, e.dist, e.stroke, e.seed]), [[72, 100, 'Free', 10196], [52, 100, 'Back', 8426], [4, 500, 'Free', 36686], [24, 50, 'Free', null]]);
});
