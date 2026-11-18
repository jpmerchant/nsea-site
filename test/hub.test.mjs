// Data hub API against an in-memory SQLite with the hub schema (same tables export_hub.py builds).
import test from 'node:test';
import assert from 'node:assert/strict';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }
const { handleHub } = await import('../worker/hub.mjs');

const SCHEMA = `
create table hub_meta(key text primary key, value text);
create table hub_meet(id integer primary key, name text, start_date text, end_date text, course text, location text, season text, meet_type text, series text, is_champ int, champ_level text);
create table hub_team(id integer primary key, code text, name text, lsc text);
create table hub_swimmer(id integer primary key, first text, last text, sex text, nsea int, active int);
create table hub_swim(id integer primary key, meet_id int, swimmer_id int, team_id int, kind text, distance int, stroke int, course text, round text, time_cs int, place int, age int, swim_date text, event_age text, event_sex text, nsea int, nsea_rec int);
create table hub_split(swim_id int, idx int, cum_cs int, primary key(swim_id, idx)) without rowid;
create table hub_benchmark_set(id integer primary key, code text, label text, family text, level text, course text, edition text, effective_from text, effective_to text, age_scope text, source text, note text, as_of text);
create table hub_benchmark_time(set_id int, sex text, age_group text, age_lo int, age_hi int, distance int, stroke int, is_relay int, course text, time_cs int, time_text text, rank int, holder text, holder_team text, swim_date text, meet text, note text);`;

function hub() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec(`insert into hub_meta values('built','2026-11-18');
    insert into hub_meet values(1,'2026 NC SC AG Champs','2026-02-26','2026-03-01','Y','Cary','2025-26','champ','NC_SC_AG',1,'lsc'),(2,'2026 Fall Frenzy','2026-09-18','2026-09-18','Y','Wilmington','2026-27','dual',null,0,null);
    insert into hub_team values(1,'NCNSEA','NSEA Swim','NC'),(2,'NCTAC','TAC Titans','NC');
    insert into hub_swimmer values(1,'Ava','Able','F',1,1),(2,'Bea','Best','F',0,0),(3,'Cal','Cole','M',1,0);
    insert into hub_swim values(1,1,1,1,'I',50,1,'Y','P',2900,5,12,'2026-02-26','1112','F',1,1),(2,1,2,2,'I',50,1,'Y','P',2800,1,12,'2026-02-26','1112','F',0,0),
      (3,2,1,1,'I',50,1,'Y','F',2850,1,12,'2026-09-18',null,null,1,1),(4,1,3,1,'I',50,1,'Y','F',2600,2,13,'2026-02-27','1314','M',1,1);
    insert into hub_split values(3,1,1400),(3,2,2850);
    insert into hub_benchmark_set values(1,'MOT_A','A','standard','motivational','Y','2024-2028',null,null,'by_age',null,null,null),(2,'CUT_NC_SC_AG_2026','2026 NC SC AG cutoffs','cutoff','lsc','Y','2026 NC SC AG Champs','2026-02-26','2026-02-26','by_age',null,null,null);
    insert into hub_benchmark_time values(1,'F','11-12',11,12,50,1,0,'Y',2929,'29.29',null,null,null,null,null,null),(2,'F','11-12',11,12,50,1,0,'Y',2800,'28.00',1,null,null,null,null,'winner'),(2,'F','11-12',11,12,50,1,0,'Y',2950,'29.50',8,null,null,null,null,'prelim');`);
  const prep = (sql) => ({ bind: (...b) => ({ first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) }) });
  return { HUB: { prepare: (sql) => { const p = prep(sql); return { ...p.bind(), bind: p.bind }; } } };
}
const get = async (env, path) => { const u = new URL('https://x.test/api/hub' + path); const r = await handleHub(new Request(u), env, u); return { status: r.status, json: await r.json() }; };

test('hub: not connected answers 503', async () => {
  assert.equal((await get({}, '/meta')).status, 503);
});

test('hub: rankings by scope, performers vs performances', { skip: !DatabaseSync }, async () => {
  const env = hub();
  const ev = '/rank?course=Y&distance=50&stroke=1&sex=F';
  const nsea = (await get(env, ev)).json.results;
  assert.deepEqual(nsea.map((r) => [r.last, r.time_cs]), [['Able', 2850]]);   // NSEA only, best swim per swimmer
  const all = (await get(env, ev + '&scope=all')).json.results;
  assert.deepEqual(all.map((r) => r.last), ['Best', 'Able']);
  const perf = (await get(env, ev + '&mode=performances')).json.results;
  assert.deepEqual(perf.map((r) => r.time_cs), [2850, 2900]);
  const champ = (await get(env, ev + '&scope=all&series=NC_SC_AG')).json.results;
  assert.deepEqual(champ.map((r) => r.time_cs), [2800, 2900]);
  assert.equal((await get(env, '/rank?course=X&distance=50&stroke=1')).status, 400);
});

test('hub: swimmer search, profile, splits, benchmarks, cutoffs, meets', { skip: !DatabaseSync }, async () => {
  const env = hub();
  assert.deepEqual((await get(env, '/swimmers?q=ab')).json.swimmers.map((s) => s.last), ['Able']);
  assert.deepEqual((await get(env, '/swimmers?q=ava ab')).json.swimmers.map((s) => s.id), [1]);
  assert.equal((await get(env, '/swimmers?q=a')).status, 400);
  const p = (await get(env, '/swimmer/1')).json;
  assert.equal(p.swims.length, 2); assert.equal(p.swims[0].splits, 2);
  assert.deepEqual((await get(env, '/splits/3')).json.splits.map((s) => s.cum_cs), [1400, 2850]);
  assert.equal((await get(env, '/swimmer/99')).status, 404);
  const bm = (await get(env, '/benchmarks?course=Y&distance=50&stroke=1&sex=F&age=12')).json.benchmarks;
  assert.deepEqual(bm.map((b) => b.label), ['A']);
  assert.equal((await get(env, '/benchmarks?course=Y&distance=50&stroke=1&sex=F&age=12&cutoffs=1')).json.benchmarks.length, 3);
  const cut = (await get(env, '/cutoffs?course=Y&distance=50&stroke=1&sex=F&series=NC_SC_AG')).json;
  assert.deepEqual(cut.cutoffs.map((c) => c.rank), [1, 8]); assert.equal(cut.age_groups[0].age_group, '11-12');
  assert.equal((await get(env, '/meets?champ=1')).json.meets.length, 1);
  const m = (await get(env, '/meet/1?scope=all')).json; assert.equal(m.swims.length, 3);
  assert.equal((await get(env, '/meet/1')).json.swims.length, 2);
  const meta = (await get(env, '/meta')).json; assert.equal(meta.series[0].series, 'NC_SC_AG'); assert.equal(meta.series[0].champ, 1);
});
