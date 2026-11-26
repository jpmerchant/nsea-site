// Meet Day family side: what a family sees (server-side filtering), links, feedback and alerts. Made-up names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildRefs } from '../public/admin/meet/lib/refs.mjs';
import { derive } from '../public/admin/meet/lib/model.mjs';
import { familyView, findSwimmers, parseInfoText, infoText } from '../worker/meetday-family-view.mjs';
import { handleMeetdayFamily, handleFamilyAdmin, alertsFor, runFamilyAlerts, _clearFamilyCache } from '../worker/meetday-family.mjs';
import { handleMeetdayAdmin } from '../worker/meetday.mjs';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node */ }

const pkg = () => ({
  format: 'nsea-meetday/1', id: 'fam-meet', name: 'Test Invite', short: 'Test', teamMatch: 'nsea', teamName: 'NSEA', start: '2026-12-12', end: '2026-12-12',
  general: [{ title: 'Entry limits', items: ['Coach-only detail'] }],
  sessions: [
    { n: 2, day: '2026-12-12', name: 'Saturday prelims', start: '10:15 AM', finish: '11:00 AM', warmup: { group: 'All', time: '9:00–9:45 AM', pool: 'Comp', lanes: '1-8' }, events: [{ num: 11, round: 'Prelims' }, { num: 12, round: 'Prelims' }] },
    { n: 4, day: '2026-12-12', name: 'Saturday finals', start: '06:20 PM', events: [{ num: 11, round: 'Finals' }] },
  ],
  events: { 11: { num: 11, sex: 'F', dist: 100, stroke: 'Back', title: 'Girls 13 & Over 100 Backstroke' }, 12: { num: 12, sex: 'M', dist: 100, stroke: 'Back', title: 'Boys 13 & Over 100 Backstroke' } },
  swimmers: [
    { id: 1, name: 'Fishman, Coral', first: 'Coral', last: 'Fishman', sex: 'F', age: 15, usaId: 'AAAAAAAAAAAAA1' },
    { id: 2, name: 'Lane, Penny', first: 'Penny', last: 'Lane', sex: 'F', age: 17, usaId: 'AAAAAAAAAAAAA2' },
    { id: 3, name: 'Reef, Rocco', first: 'Rocco', last: 'Reef', sex: 'M', age: 14 },
  ],
  entries: [
    { id: '11-P-1', swimmerId: 1, event: 11, session: 2, round: 'Prelims', heat: 3, lane: 4, seed: 6620, entrySeed: 6620, start: '10:20 AM' },
    { id: '11-P-2', swimmerId: 2, event: 11, session: 2, round: 'Prelims', heat: 5, lane: 4, seed: 6010, entrySeed: 6010, start: '10:24 AM' },
    { id: '12-P-3', swimmerId: 3, event: 12, session: 2, round: 'Prelims', heat: 1, lane: 2, seed: null, start: '10:38 AM' },
  ],
  refs: buildRefs({
    records: { genders: { Female: { ageGroups: [{ age: '15-16', events: [{ event: '100 Back', time: '1:05.50', holder: 'Old Holder' }] }] } } },
    top10: { data: {} },
    standards: { W: { '15-16': { '100 BK': [['NC Senior', '1:05.79', 'teal', 14]] } } },
  }),
});
let n = 0;
const op = (type, data, at = '2026-12-12T15:00:00.000Z') => ({ id: 'op' + String(++n).padStart(8, '0'), at, by: 'Coach', type, data });

test('family view: own swimmer in full, teammates names only, nothing coach-only', () => {
  const P = pkg();
  const ops = [
    op('result', { entry: '11-P-1', time: 6540 }), op('result', { entry: '11-P-2', time: 5990 }),
    op('note', { entry: '11-P-1', text: 'SECRET coach note', tags: ['Turns'] }), op('star', { entry: '11-P-1', on: true }),
    op('dq', { entry: '12-P-3', calls: [{ code: '2A', desc: 'x' }], text: 'SECRET call' }),
    op('gnote', { scope: 'meet', text: 'SECRET meet note', tags: [] }),
  ];
  const M = derive(P, ops);
  const mine = findSwimmers(P, [{ usa_id: 'AAAAAAAAAAAAA1', name: 'Coral Fishman' }]);
  assert.deepEqual([...mine], [1]);
  const V = familyView(P, M, mine, ops);
  const text = JSON.stringify(V);
  assert.ok(!/SECRET|Coach-only|5990|6010|tier|pct/.test(text), 'no coach data, no teammate times, no pre-race flags');
  assert.equal(V.swims.length, 1);
  const s = V.swims[0];
  assert.equal(s.name, 'Coral Fishman');
  assert.deepEqual([s.heat, s.lane, s.result.time, s.result.official, s.dEntry, s.best], [3, 4, 6540, false, -80, true]);
  assert.deepEqual(s.cuts.map((c) => c.label), ['NC Senior'], 'new cut shows while unofficial');
  assert.deepEqual(s.honors, [], 'team record waits for official');
  assert.deepEqual(V.team.map((t) => [t.name, t.mine]), [['Coral Fishman', true], ['Penny Lane', false], ['Rocco Reef', false]]);
  assert.equal(V.days[0].blocks[0].warmup.time, '9:00–9:45 AM');

  const V2 = familyView(P, derive(P, [...ops, op('official', { session: 2, on: true })]), mine, ops);
  assert.equal(V2.swims[0].result.official, true);
  assert.deepEqual(V2.swims[0].honors.map((h) => h.label), ['Team record 15-16']);
  // Name match when the meet file has no USA Swimming ID
  assert.deepEqual([...findSwimmers(P, [{ usa_id: 'ZZZ', name: 'Rocco Reef' }])], [3]);
});

test('family info text: coach text -> sections and back', () => {
  const s = parseInfoText('Warm-ups:\n- Arrive 15 minutes early\n- Caps on\n\n# Parking\nLot B behind the pool');
  assert.deepEqual(s, [{ title: 'Warm-ups', items: ['Arrive 15 minutes early', 'Caps on'] }, { title: 'Parking', items: ['Lot B behind the pool'] }]);
  assert.deepEqual(parseInfoText(infoText(s)), s);
});

test('alerts: swim soon, result in, made finals, heat/lane baseline', () => {
  const view = { swims: [
    { id: 'a', name: 'Coral Fishman', title: 'Girls 13 & Over 100 Backstroke', day: '2026-12-12', heat: 3, of: 5, lane: 4, pool: '', start: '10:20 AM', est: true, result: null, cuts: [] },
    { id: 'b', name: 'Coral Fishman', title: 'Girls 13 & Over 100 Backstroke', day: '2026-12-12', heat: 1, lane: 5, start: '06:20 PM', isFinal: true, result: { time: 6540, official: false }, dEntry: -80, cuts: [{ label: 'NC Senior' }] },
  ] };
  const a = alertsFor(view, { day: '2026-12-12', min: 10 * 60 + 10 }, (id) => id === 'b');
  assert.deepEqual(a.filter((x) => !x.silent).map((x) => x.title), ['Coral swims soon: 100 Backstroke', 'Coral: 100 Backstroke 1:05.40 (−0.80 vs entry)', 'Coral made finals: 100 Backstroke']);
  assert.match(a.filter((x) => !x.silent)[1].body, /Unofficial · New cut: NC Senior/);
});

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const prep = (sql) => ({ bind: (...b) => ({
    first: async () => db.prepare(sql).get(...b) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { db.prepare(sql).run(...b); return {}; },
    _run: () => db.prepare(sql).run(...b) }) });
  return { db, DB: { prepare: (sql) => { const p = prep(sql); return { ...p, ...p.bind(), bind: p.bind }; }, batch: async (list) => list.map((s) => s._run()) } };
}

test('worker: family links, filtered feed, revoke, feedback, push alerts', { skip: !DatabaseSync }, async () => {
  _clearFamilyCache();
  const env = d1();
  env.db.exec(`INSERT INTO roster_swimmer VALUES ('AAAAAAAAAAAAA1', 'Coral Fishman', 'active', 'Senior'), ('AAAAAAAAAAAAA2', 'Penny Lane', 'active', 'Senior');
    INSERT INTO roster_family (email, family_name) VALUES ('fish@x.org', 'Fishman'), ('lane@x.org', 'Lane');
    INSERT INTO family_swimmer (email, usa_id, source) VALUES ('fish@x.org', 'AAAAAAAAAAAAA1', 'captyn'), ('lane@x.org', 'AAAAAAAAAAAAA2', 'captyn');`);
  const coach = { email: 'c@x.org', name: 'Coach', roles: ['coach'] };
  const audit = async () => {};
  const admin = async (method, path, body = {}, qs = '') => { const r = await handleMeetdayAdmin(env, coach, method, path, body, audit, new URL('https://x.test/api/admin' + path + qs)); return { status: r.status, json: await r.json() }; };
  const P = pkg(); P.start = P.end = new Date().toISOString().slice(0, 10);
  for (const s of P.sessions) s.day = P.start;
  assert.equal((await admin('POST', '/meetday/meet', { pkg: P })).status, 200);
  const made = await admin('POST', '/meetday/family-link', { email: 'FISH@x.org' });
  assert.equal(made.status, 200);
  const token = made.json.url.split('#k=')[1];
  assert.ok(made.json.url.startsWith('https://x.test/meetday/#k='));
  assert.equal((await admin('POST', '/meetday/family-link', { email: 'nobody@x.org' })).status, 404);

  const fam = async (method, path, { key = token, body, qs = '' } = {}) => {
    const r = await handleMeetdayFamily(new Request('https://x.test/api/meetday/family' + path + qs, { method, headers: { 'x-family-key': key, ...(body ? { 'content-type': 'application/json', origin: 'https://x.test' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, new URL('https://x.test/api/meetday/family' + path + qs));
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await fam('GET', '/me', { key: 'x'.repeat(24) })).status, 401);
  assert.deepEqual((await fam('GET', '/me')).json.meets, [], 'family view is off until a coach turns it on');
  assert.equal((await fam('GET', '/meet', { qs: '?id=fam-meet' })).status, 404);

  await admin('POST', '/meetday/ops', { meet: 'fam-meet', ops: [{ id: 'fv000001', type: 'familyview', data: { on: true } }, { id: 'res00001', type: 'result', at: new Date().toISOString(), data: { entry: '11-P-1', time: 6540 } }, { id: 'res00002', type: 'result', data: { entry: '11-P-2', time: 5990 } }] });
  const me = await fam('GET', '/me');
  assert.deepEqual(me.json.swimmers, ['Coral Fishman']);
  assert.deepEqual(me.json.meets.map((m) => [m.id, m.swims]), [['fam-meet', 1]]);
  const v = await fam('GET', '/meet', { qs: '?id=fam-meet' });
  assert.equal(v.status, 200);
  assert.deepEqual(v.json.swims.map((s) => s.result.time), [6540]);
  assert.ok(!JSON.stringify(v.json).includes('5990'));
  assert.deepEqual((await fam('GET', '/meet', { qs: `?id=fam-meet&v=${encodeURIComponent(v.json.v)}` })).json.same, true);

  // Coach list: link, who's in the meet, picker
  const list = await admin('GET', '/meetday/families', {}, '?meet=fam-meet');
  assert.equal(list.json.on, true);
  assert.deepEqual(list.json.links.map((l) => [l.label, l.inMeet, l.swimmers]), [['Fishman', 1, ['Coral Fishman']]]);
  assert.deepEqual(list.json.swimmers.map((s) => [s.name, s.families.map((f) => [f.family, f.hasLink])]), [['Fishman, Coral', [['Fishman', true]]], ['Lane, Penny', [['Lane', false]]], ['Reef, Rocco', []]]);

  // Feedback
  assert.equal((await fam('POST', '/feedback', { body: { meet: 'fam-meet', page: 'today', text: 'Loved the heat times' } })).status, 200);
  assert.deepEqual((await admin('GET', '/meetday/families', {}, '?meet=fam-meet')).json.feedback.map((f) => [f.family, f.text]), [['Fishman', 'Loved the heat times']]);

  // Push: subscribe, cron sends once (result just in), alerts readable, no repeat
  assert.equal((await fam('POST', '/push', { body: { sub: { endpoint: 'https://push.example.test/abc' } } })).status, 200);
  const sent = [];
  const fakeFetch = async (u, o) => { sent.push([u, o.headers.Authorization.slice(0, 8)]); return new Response('', { status: 201 }); };
  assert.deepEqual(await runFamilyAlerts(env, fakeFetch), { sent: 1 });
  assert.deepEqual(sent, [['https://push.example.test/abc', 'vapid t=']]);
  const al = await fam('GET', '/alerts');
  assert.ok(al.json.alerts.some((a) => /^Coral: 100 Backstroke 1:05.40/.test(a.title)));
  assert.deepEqual(await runFamilyAlerts(env, fakeFetch), { sent: 0 });

  // Revoke
  const id = list.json.links[0].id;
  await admin('POST', '/meetday/family-link/revoke', { id });
  assert.equal((await fam('GET', '/me')).status, 401);
});
