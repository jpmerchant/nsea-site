// Runs the real migrations against an in-memory SQLite (same engine family as D1) and drives the assessment skill library end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleAssessmentAdmin, parseSkill, parseMinimum, markOk, checklistFor, ASSESSED_GROUPS } = await import('../worker/assessment.mjs');
const { MODULES } = await import('../worker/admin.mjs');

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
const log = [];
const audit = async (m, a, d) => { log.push([m, a, d]); };
const admin = async (env, method, path, body = {}) => { const r = await handleAssessmentAdmin(env, me, method, path, body, audit); return { status: r.status, json: await r.json() }; };
const find = (o, category, name) => o.skills.find((s) => s.category === category && s.name === name);

test('the assessment role exists', () => assert.ok(MODULES.includes('assessment')));

test('parsers: skills, minimums and marks', () => {
  assert.equal(parseSkill({ category: '', name: 'x' }).error, 'Please choose or enter a category.');
  assert.equal(parseSkill({ category: 'General', name: '' }).error, 'Please enter the skill name.');
  assert.equal(parseSkill({ category: 'General', name: ' Tread  water ', kind: 'bogus' }).kind, 'score');
  assert.match(parseSkill({ category: 'General', name: 'Laps', kind: 'distance' }).error, /stroke category/);
  assert.equal(parseSkill({ category: 'freestyle', name: 'Distance', kind: 'distance' }).category, 'Freestyle');
  assert.equal(parseMinimum({ stroke: 'Freestyle', group_name: 'Splash', yards: '75' }).yards, 75);
  assert.equal(parseMinimum({ stroke: 'Freestyle', group_name: 'Splash', yards: '' }).yards, null);
  for (const y of ['30', '0', '12.5', '1025', 'abc', '-25']) assert.ok(parseMinimum({ stroke: 'Freestyle', group_name: 'Splash', yards: y }).error, y);
  assert.ok(parseMinimum({ stroke: 'Sidestroke', group_name: 'Splash', yards: 25 }).error);
  assert.ok(parseMinimum({ stroke: 'Freestyle', group_name: 'Senior', yards: 25 }).error);
  assert.ok(markOk('score', 'G') && markOk('yesno', 'A') && markOk('score', '') && markOk('distance', 'L'));
  assert.ok(!markOk('score', 'L') && !markOk('distance', 'G') && !markOk('score', 'X'));
});

test('migration seeds the library from the doc', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const o = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.equal(o.skills.length, 44);
  assert.deepEqual(o.groups, ['Splash', 'Tidepool', 'Riptide', 'Breakers']);
  assert.deepEqual(o.skills.slice(0, 3).map((s) => s.name), ['Bobs / streamline jumps', 'Front float', 'Back float']);
  assert.deepEqual(find(o, 'General', 'Comfortable in deep water').marks, { Splash: 'A', Tidepool: 'G', Riptide: 'A' });
  assert.deepEqual(find(o, 'Freestyle', 'Flip turn').marks, { Riptide: 'A', Breakers: 'G' });
  assert.equal(find(o, 'Diving: shallow water', 'Shallow standing dive').kind, 'yesno');
  assert.ok(find(o, 'Diving: deep water', 'Shallow standing dive'));
  // minimum distances from the doc
  const mins = Object.fromEntries(o.minimums.map((m) => [m.stroke + '/' + m.group_name, m.yards]));
  assert.deepEqual(mins, { 'Freestyle/Splash': 25, 'Freestyle/Tidepool': 50, 'Freestyle/Riptide': 100, 'Backstroke/Splash': 25, 'Backstroke/Tidepool': 50, 'Backstroke/Riptide': 100,
    'Breaststroke/Tidepool': 25, 'Breaststroke/Riptide': 50, 'Butterfly/Tidepool': 25, 'Butterfly/Riptide': 50 });
  // every stroke has one distance skill, logged (L) wherever the group has a minimum, and every minimum has its L mark
  for (const stroke of o.strokes) {
    const d = o.skills.filter((s) => s.category === stroke && s.kind === 'distance');
    assert.equal(d.length, 1, stroke);
    for (const m of o.minimums.filter((x) => x.stroke === stroke)) assert.equal(d[0].marks[m.group_name], 'L', `${stroke} ${m.group_name}`);
    assert.ok(Object.values(d[0].marks).every((x) => x === 'L'));
  }
  // marks only use the allowed letters for each kind
  for (const s of o.skills) for (const k of Object.values(s.marks)) assert.ok(markOk(s.kind, k), s.name);
});

test('checklists come out in order with minimums on the distance skills', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const splash = (await admin(env, 'GET', '/assessment/groups/Splash/checklist')).json;
  assert.equal(splash.group, 'Splash');
  assert.equal(splash.checklist[0].name, 'Bobs / streamline jumps');
  assert.equal(splash.checklist[0].mark, 'G');
  const free = splash.checklist.find((s) => s.category === 'Freestyle');
  assert.equal(free.name, 'Distance swum'); assert.equal(free.min_yards, 25); assert.equal(free.mark, 'L');
  assert.ok(!splash.checklist.some((s) => s.category === 'Butterfly'));
  const rip = await checklistFor(env, 'Riptide');
  assert.equal(rip.find((s) => s.category === 'Breaststroke' && s.kind === 'distance').min_yards, 50);
  assert.equal((await admin(env, 'GET', '/assessment/groups/Senior/checklist')).status, 404);
});

test('add a skill, attach it to groups, change and remove marks', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const mk = await admin(env, 'POST', '/assessment/skills', { category: 'General', name: 'Treads water', cue: 'Stays up for 30 seconds', kind: 'score' });
  assert.equal(mk.status, 200);
  const id = mk.json.id;
  let o = (await admin(env, 'GET', '/assessment/skills')).json;
  const s = o.skills.find((x) => x.id === id);
  assert.deepEqual(s.marks, {}); assert.equal(s.sort, 100); // after the nine General skills
  assert.equal((await admin(env, 'POST', '/assessment/skills', { category: 'general', name: 'TREADS WATER' })).status, 409);
  assert.equal((await admin(env, 'POST', `/assessment/skills/${id}/marks`, { marks: { Riptide: 'G', Breakers: 'A' } })).status, 200);
  assert.equal((await admin(env, 'POST', `/assessment/skills/${id}/marks`, { marks: { Riptide: 'L' } })).status, 400);   // L is for distance only
  assert.equal((await admin(env, 'POST', `/assessment/skills/${id}/marks`, { marks: { Senior: 'G' } })).status, 400);   // not an assessed group
  assert.equal((await admin(env, 'POST', `/assessment/skills/${id}/marks`, { marks: {} })).status, 400);
  assert.deepEqual((await checklistFor(env, 'Riptide')).filter((x) => x.id === id).map((x) => x.mark), ['G']);
  await admin(env, 'POST', `/assessment/skills/${id}/marks`, { marks: { Riptide: 'A', Breakers: '' } });
  o = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.deepEqual(o.skills.find((x) => x.id === id).marks, { Riptide: 'A' });
  assert.equal((await checklistFor(env, 'Breakers')).some((x) => x.id === id), false);
  // edit it
  assert.equal((await admin(env, 'POST', '/assessment/skills', { id, category: 'General', name: 'Treads water', cue: 'Stays up for 45 seconds', kind: 'yesno' })).status, 200);
  o = (await admin(env, 'GET', '/assessment/skills')).json;
  const e = o.skills.find((x) => x.id === id);
  assert.equal(e.cue, 'Stays up for 45 seconds'); assert.equal(e.kind, 'yesno'); assert.equal(e.sort, 100);
  assert.ok(log.some((l) => l[1] === 'add skill' && /Treads water/.test(l[2])));
  assert.equal((await admin(env, 'POST', '/assessment/skills/99999/marks', { marks: { Splash: 'A' } })).status, 404);
});

test('archiving takes a skill off every checklist and restoring brings it back', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const o = (await admin(env, 'GET', '/assessment/skills')).json;
  const sk = find(o, 'General', 'Front float');
  assert.ok((await checklistFor(env, 'Splash')).some((x) => x.id === sk.id));
  await admin(env, 'POST', `/assessment/skills/${sk.id}/active`, { active: false });
  assert.ok(!(await checklistFor(env, 'Splash')).some((x) => x.id === sk.id));
  const after = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.equal(find(after, 'General', 'Front float').active, false);
  assert.deepEqual(find(after, 'General', 'Front float').marks, { Splash: 'G', Tidepool: 'A' }); // marks kept
  await admin(env, 'POST', `/assessment/skills/${sk.id}/active`, { active: true });
  assert.ok((await checklistFor(env, 'Splash')).some((x) => x.id === sk.id));
});

test('each stroke has one distance skill, and minimums attach the logging mark', { skip: !DatabaseSync }, async () => {
  const env = d1();
  const second = await admin(env, 'POST', '/assessment/skills', { category: 'Freestyle', name: 'Laps', kind: 'distance' });
  assert.equal(second.status, 409);
  const o = (await admin(env, 'GET', '/assessment/skills')).json;
  const fly = find(o, 'Butterfly', 'Distance swum');
  assert.equal(fly.marks.Splash, undefined);
  assert.equal((await admin(env, 'POST', '/assessment/minimums', { stroke: 'Butterfly', group_name: 'Splash', yards: 12 })).status, 400);
  assert.equal((await admin(env, 'POST', '/assessment/minimums', { stroke: 'Butterfly', group_name: 'Splash', yards: 25 })).status, 200);
  const o2 = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.equal(find(o2, 'Butterfly', 'Distance swum').marks.Splash, 'L');
  assert.equal(o2.minimums.find((m) => m.stroke === 'Butterfly' && m.group_name === 'Splash').yards, 25);
  // change, then clear (the logging mark stays)
  await admin(env, 'POST', '/assessment/minimums', { stroke: 'Butterfly', group_name: 'Splash', yards: 50 });
  assert.equal((await admin(env, 'GET', '/assessment/skills')).json.minimums.find((m) => m.stroke === 'Butterfly' && m.group_name === 'Splash').yards, 50);
  await admin(env, 'POST', '/assessment/minimums', { stroke: 'Butterfly', group_name: 'Splash', yards: '' });
  const o3 = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.equal(o3.minimums.some((m) => m.stroke === 'Butterfly' && m.group_name === 'Splash'), false);
  assert.equal(find(o3, 'Butterfly', 'Distance swum').marks.Splash, 'L');
  // archive the stroke's distance skill: a minimum then has nothing to attach to
  await admin(env, 'POST', `/assessment/skills/${fly.id}/active`, { active: false });
  assert.equal((await admin(env, 'POST', '/assessment/minimums', { stroke: 'Butterfly', group_name: 'Riptide', yards: 50 })).status, 400);
});

test('moving a skill up or down swaps it with its neighbour in the same category', { skip: !DatabaseSync }, async () => {
  const env = d1();
  let o = (await admin(env, 'GET', '/assessment/skills')).json;
  const names = () => o.skills.filter((s) => s.category === 'General').map((s) => s.name).slice(0, 3);
  assert.deepEqual(names(), ['Bobs / streamline jumps', 'Front float', 'Back float']);
  await admin(env, 'POST', `/assessment/skills/${find(o, 'General', 'Front float').id}/move`, { dir: 'up' });
  o = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.deepEqual(names(), ['Front float', 'Bobs / streamline jumps', 'Back float']);
  await admin(env, 'POST', `/assessment/skills/${find(o, 'General', 'Front float').id}/move`, { dir: 'up' }); // already first: no change
  o = (await admin(env, 'GET', '/assessment/skills')).json;
  assert.deepEqual(names(), ['Front float', 'Bobs / streamline jumps', 'Back float']);
  assert.equal((await admin(env, 'POST', `/assessment/skills/${find(o, 'General', 'Front float').id}/move`, { dir: 'sideways' })).status, 400);
});

test('unrelated paths fall through', { skip: !DatabaseSync }, async () => {
  const env = d1();
  assert.equal(await handleAssessmentAdmin(env, me, 'GET', '/assessment/nope', {}, audit), null);
  assert.deepEqual(ASSESSED_GROUPS, ['Splash', 'Tidepool', 'Riptide', 'Breakers']);
});
