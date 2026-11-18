// NSEA data hub: public, read-only queries over the results database copy in D1 (binding HUB, database nsea-hub).
// The data is built by nsea-results-db export_hub.py and loaded by hand (see README, "Data hub").
// Every route is GET, answers JSON and is cached at the edge; the data only changes when a new copy is loaded.
import { json, fail } from './util.mjs';

const COURSES = new Set(['Y', 'L', 'S']);
const STROKES = new Set([1, 2, 3, 4, 5]);
const CACHE = { 'cache-control': 'public, max-age=300, s-maxage=3600' };
const int = (v, lo, hi, dflt = null) => {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const word = (v, max = 40) => (/^[A-Za-z0-9_]+$/.test(v || '') ? String(v).slice(0, max) : null);
const ok = (data) => json(data, 200, CACHE);
// /meta carries the data's `built` stamp, which the page adds (as v=) to every other request, so it is only cached briefly.
const META_CACHE = { 'cache-control': 'public, max-age=0, s-maxage=60' };
const rows = async (stmt) => (await stmt.all()).results || [];

// Event filter shared by the list and the compare views.
function eventFilter(q) {
  const course = q.get('course'), distance = int(q.get('distance'), 25, 1650), stroke = int(q.get('stroke'), 1, 5);
  if (!COURSES.has(course) || !distance || !STROKES.has(stroke)) return { error: 'course, distance and stroke are required' };
  const sex = ['F', 'M'].includes(q.get('sex')) ? q.get('sex') : null;
  return { course, distance, stroke, sex, ageLo: int(q.get('age_lo'), 0, 99), ageHi: int(q.get('age_hi'), 0, 99) };
}

async function meta(env) {
  const [m, series, sets, seasons] = await Promise.all([
    rows(env.HUB.prepare('SELECT key, value FROM hub_meta')),
    rows(env.HUB.prepare(`SELECT series, MAX(champ_level) AS champ_level, MAX(is_champ) AS champ, COUNT(*) AS meets, MIN(substr(start_date,1,4)) AS first_year, MAX(substr(start_date,1,4)) AS last_year
      FROM hub_meet WHERE series IS NOT NULL GROUP BY series ORDER BY series`)),
    rows(env.HUB.prepare(`SELECT id, code, label, family, level, course, edition, as_of FROM hub_benchmark_set WHERE family <> 'cutoff' ORDER BY family, level, label`)),
    rows(env.HUB.prepare('SELECT DISTINCT season FROM hub_meet WHERE season IS NOT NULL ORDER BY season DESC')),
  ]);
  return json({ meta: Object.fromEntries(m.map((r) => [r.key, r.value])), series, benchmark_sets: sets, seasons: seasons.map((r) => r.season) }, 200, META_CACHE);
}

async function swimmers(env, q) {
  const text = String(q.get('q') || '').replace(/[%_]/g, '').trim().slice(0, 40);
  if (text.length < 2) return fail(400, 'Type at least 2 letters');
  const parts = text.split(/\s+/);
  const nseaOnly = q.get('nsea') === '1' ? 'AND s.nsea = 1' : '';
  let where, binds;
  if (parts.length > 1) { where = '(s.first LIKE ? AND s.last LIKE ?) OR (s.last LIKE ? AND s.first LIKE ?)'; binds = [parts[0] + '%', parts.slice(1).join(' ') + '%', parts[0] + '%', parts.slice(1).join(' ') + '%']; }
  else { where = 's.last LIKE ? OR s.first LIKE ?'; binds = [text + '%', text + '%']; }
  const list = await rows(env.HUB.prepare(`SELECT s.id, s.first, s.last, s.sex, s.nsea, s.active,
      (SELECT t.name FROM hub_swim x JOIN hub_team t ON t.id = x.team_id WHERE x.swimmer_id = s.id ORDER BY x.swim_date DESC LIMIT 1) AS team,
      (SELECT MAX(x.swim_date) FROM hub_swim x WHERE x.swimmer_id = s.id) AS last_swim
    FROM hub_swimmer s WHERE (${where}) ${nseaOnly} ORDER BY s.nsea DESC, s.last, s.first LIMIT 30`).bind(...binds));
  return ok({ swimmers: list });
}

async function swimmer(env, id) {
  const s = await env.HUB.prepare('SELECT id, first, last, sex, nsea, active FROM hub_swimmer WHERE id = ?').bind(id).first();
  if (!s) return fail(404, 'Swimmer not found');
  const swims = await rows(env.HUB.prepare(`SELECT x.id, x.meet_id, m.name AS meet, m.series, x.kind, x.distance, x.stroke, x.course, x.round,
      x.time_cs, x.place, x.age, x.swim_date, x.event_age, x.nsea, t.name AS team,
      (SELECT COUNT(*) FROM hub_split p WHERE p.swim_id = x.id) AS splits
    FROM hub_swim x JOIN hub_meet m ON m.id = x.meet_id LEFT JOIN hub_team t ON t.id = x.team_id
    WHERE x.swimmer_id = ? ORDER BY x.swim_date DESC, x.distance, x.stroke`).bind(id));
  return ok({ swimmer: s, swims });
}

async function splits(env, id) {
  const list = await rows(env.HUB.prepare('SELECT idx, cum_cs FROM hub_split WHERE swim_id = ? ORDER BY idx').bind(id));
  return ok({ splits: list });
}

// Rankings: performers (best swim per swimmer) or performances (every swim).
async function rank(env, q) {
  const f = eventFilter(q);
  if (f.error) return fail(400, f.error);
  const where = ['x.course = ?', 'x.distance = ?', 'x.stroke = ?']; const b = [f.course, f.distance, f.stroke];
  if (f.sex) { where.push('s.sex = ?'); b.push(f.sex); }
  if (f.ageLo !== null) { where.push('x.age >= ?'); b.push(f.ageLo); }
  if (f.ageHi !== null) { where.push('x.age <= ?'); b.push(f.ageHi); }
  const from = date(q.get('from')), to = date(q.get('to'));
  if (from) { where.push('x.swim_date >= ?'); b.push(from); }
  if (to) { where.push('x.swim_date <= ?'); b.push(to); }
  if (q.get('scope') !== 'all') where.push(q.get('records') === '1' ? 'x.nsea_rec = 1' : 'x.nsea = 1');
  if (q.get('active') === '1') where.push('s.active = 1');
  if (q.get('leadoffs') === '0') where.push("x.kind = 'I'");
  const series = word(q.get('series'));
  if (series) { where.push('m.series = ?'); b.push(series); }
  const meetId = int(q.get('meet'), 1, 1e9);
  if (meetId) { where.push('x.meet_id = ?'); b.push(meetId); }
  const limit = int(q.get('limit'), 1, 500, 25);
  const body = `SELECT x.id, x.swimmer_id, s.first, s.last, s.sex, x.time_cs, x.age, x.swim_date, x.kind, x.round, x.place, x.event_age,
      m.name AS meet, m.id AS meet_id, t.name AS team
    FROM hub_swim x JOIN hub_swimmer s ON s.id = x.swimmer_id JOIN hub_meet m ON m.id = x.meet_id LEFT JOIN hub_team t ON t.id = x.team_id
    WHERE ${where.join(' AND ')}`;
  const sql = q.get('mode') === 'performances'
    ? `${body} ORDER BY x.time_cs, x.swim_date LIMIT ?`
    : `SELECT * FROM (SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.swimmer_id ORDER BY r.time_cs, r.swim_date) AS rn FROM (${body}) r) WHERE rn = 1 ORDER BY time_cs, swim_date LIMIT ?`;
  const list = await rows(env.HUB.prepare(sql).bind(...b, limit));
  return ok({ results: list.map(({ rn, ...r }) => r) });
}

// Every reference time for one event at one age: standards, records, and (optionally) championship cutoffs.
async function benchmarks(env, q) {
  const f = eventFilter(q);
  if (f.error) return fail(400, f.error);
  if (!f.sex) return fail(400, 'sex is required');
  const age = int(q.get('age'), 0, 99);
  const fam = q.get('cutoffs') === '1' ? '' : "AND s.family <> 'cutoff'";
  const ageSql = age === null ? '' : 'AND ? BETWEEN t.age_lo AND t.age_hi';
  const list = await rows(env.HUB.prepare(`SELECT s.id AS set_id, s.code, s.label, s.family, s.level, s.edition, t.age_group, t.age_lo, t.age_hi,
      t.time_cs, t.time_text, t.rank, t.holder, t.holder_team, t.swim_date, t.meet, t.note
    FROM hub_benchmark_time t JOIN hub_benchmark_set s ON s.id = t.set_id
    WHERE t.course = ? AND t.distance = ? AND t.stroke = ? AND t.sex = ? AND t.is_relay = 0 ${fam} ${ageSql}
    ORDER BY t.time_cs`).bind(f.course, f.distance, f.stroke, f.sex, ...(age === null ? [] : [age])));
  return ok({ benchmarks: list });
}

// Championship placing history: Nth-place times by year for one series and event age group.
async function cutoffs(env, q) {
  const f = eventFilter(q);
  if (f.error) return fail(400, f.error);
  const series = word(q.get('series'));
  if (!series || !f.sex) return fail(400, 'series and sex are required');
  const b = [f.course, f.distance, f.stroke, f.sex, 'CUT_' + series + '_%'];
  let ageSql = '';
  if (f.ageLo !== null && f.ageHi !== null) { ageSql = 'AND t.age_lo = ? AND t.age_hi = ?'; b.push(f.ageLo, f.ageHi); }
  const list = await rows(env.HUB.prepare(`SELECT s.code, s.edition AS meet, s.effective_from AS date, t.age_group, t.age_lo, t.age_hi, t.rank, t.note, t.time_cs, t.time_text
    FROM hub_benchmark_time t JOIN hub_benchmark_set s ON s.id = t.set_id
    WHERE s.family = 'cutoff' AND t.course = ? AND t.distance = ? AND t.stroke = ? AND t.sex = ? AND s.code LIKE ? ${ageSql}
    ORDER BY s.effective_from, t.age_lo, t.rank`).bind(...b));
  const ages = await rows(env.HUB.prepare(`SELECT DISTINCT t.age_group, t.age_lo, t.age_hi FROM hub_benchmark_time t JOIN hub_benchmark_set s ON s.id = t.set_id
    WHERE s.family = 'cutoff' AND s.code LIKE ? AND t.course = ? AND t.distance = ? AND t.stroke = ? AND t.sex = ? ORDER BY t.age_lo, t.age_hi`)
    .bind('CUT_' + series + '_%', f.course, f.distance, f.stroke, f.sex));
  return ok({ cutoffs: list, age_groups: ages });
}

async function meets(env, q) {
  const where = []; const b = [];
  const series = word(q.get('series'));
  if (series) { where.push('series = ?'); b.push(series); }
  const season = word(q.get('season'), 12);
  if (season) { where.push('season = ?'); b.push(season); }
  const text = String(q.get('q') || '').replace(/[%_]/g, '').trim().slice(0, 40);
  if (text) { where.push('name LIKE ?'); b.push('%' + text + '%'); }
  if (q.get('champ') === '1') where.push('is_champ = 1');
  const list = await rows(env.HUB.prepare(`SELECT id, name, start_date, end_date, course, location, season, meet_type, series, is_champ,
      (SELECT COUNT(*) FROM hub_swim x WHERE x.meet_id = hub_meet.id) AS swims
    FROM hub_meet ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY start_date DESC LIMIT 200`).bind(...b));
  return ok({ meets: list });
}

async function meet(env, id, q) {
  const m = await env.HUB.prepare('SELECT * FROM hub_meet WHERE id = ?').bind(id).first();
  if (!m) return fail(404, 'Meet not found');
  const nsea = q.get('scope') === 'all' ? '' : 'AND x.nsea = 1';
  const swims = await rows(env.HUB.prepare(`SELECT x.id, x.swimmer_id, s.first, s.last, s.sex, x.distance, x.stroke, x.course, x.round, x.kind,
      x.time_cs, x.place, x.age, x.event_age, x.event_sex, x.nsea, t.name AS team
    FROM hub_swim x JOIN hub_swimmer s ON s.id = x.swimmer_id LEFT JOIN hub_team t ON t.id = x.team_id
    WHERE x.meet_id = ? ${nsea} ORDER BY x.distance, x.stroke, s.sex, x.round, x.time_cs LIMIT 8000`).bind(id));
  return ok({ meet: m, swims });
}

export async function handleHub(req, env, url) {
  if (req.method !== 'GET') return fail(405, 'GET only');
  if (!env.HUB) return fail(503, 'The data hub database is not connected yet');
  const path = url.pathname.replace(/^\/api\/hub/, '');
  const q = url.searchParams;
  // Edge cache: the page adds v=<built stamp> to every request except /meta, so a new copy of the data gets new cache entries.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(req); if (hit) return hit; }
  let res;
  try {
    let m;
    if (path === '/meta') res = await meta(env);
    else if (path === '/swimmers') res = await swimmers(env, q);
    else if ((m = path.match(/^\/swimmer\/(\d+)$/))) res = await swimmer(env, Number(m[1]));
    else if ((m = path.match(/^\/splits\/(\d+)$/))) res = await splits(env, Number(m[1]));
    else if (path === '/rank') res = await rank(env, q);
    else if (path === '/benchmarks') res = await benchmarks(env, q);
    else if (path === '/cutoffs') res = await cutoffs(env, q);
    else if (path === '/meets') res = await meets(env, q);
    else if ((m = path.match(/^\/meet\/(\d+)$/))) res = await meet(env, Number(m[1]), q);
    else res = fail(404, 'Not found');
  } catch (e) {
    return fail(500, 'Query failed');
  }
  if (cache && res.status === 200) await cache.put(req, res.clone());
  return res;
}
