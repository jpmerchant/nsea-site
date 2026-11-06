// New swimmer assessment: the skill library and each group's checklist (admin console: Assessments).
// Admin only for now (needs the "assessment" role); a coach-facing checklist read comes with the assessment screens.
//
// A skill has a category and a kind. A group's checklist is the set of skills attached to that group, each with a mark:
//   G = gating (a score of 3+ is needed for the swimmer to be suggested for the group)
//   A = assessed, not gating
//   L = logged measurement, not scored (distance swum)
// Distance swum is one skill per stroke; each group has a minimum yardage per stroke. A swimmer below it is flagged, never held out.
import { json, fail, clean } from './util.mjs';
import { handleScheduleAdmin } from './assessment-schedule.mjs';
import { handleIntakeAdmin } from './assessment-intake.mjs';

export const ASSESSED_GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers'];
export const STROKES = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly'];
export const MINI = 'Mini practice';
export const KINDS = { score: 'Scored 1 to 4', yesno: 'Yes or no', distance: 'Distance swum (yards)', set: 'Mini-practice set (rated 1 to 4)' };
export const CATEGORY_ORDER = ['General', 'Diving: shallow water', 'Diving: deep water', 'Diving: off the blocks', ...STROKES, MINI];
export const POOL_YARDS = 25;
const MAX_YARDS = 1000;

const catRank = (c) => { const i = CATEGORY_ORDER.findIndex((x) => x.toLowerCase() === String(c).toLowerCase()); return i < 0 ? CATEGORY_ORDER.length : i; };
export const byOrder = (a, b) => catRank(a.category) - catRank(b.category) || a.category.localeCompare(b.category) || a.sort - b.sort || a.id - b.id;

// The marks a skill of this kind may carry. '' means "not on this group's checklist".
export function markOk(kind, mark) {
  if (mark === '' || mark == null) return true;
  return kind === 'distance' ? mark === 'L' : mark === 'G' || mark === 'A';
}

export function parseSkill(b) {
  const kind = Object.keys(KINDS).includes(b.kind) ? b.kind : 'score';
  const category = kind === 'set' ? MINI : clean(b.category, 40), name = clean(b.name, 80);
  if (!category) return { error: 'Please choose or enter a category.' };
  if (!name) return { error: kind === 'set' ? 'Please give the set a short title.' : 'Please enter the skill name.' };
  if (kind === 'set') {
    const detail = clean(b.detail, 400);
    if (!detail) return { error: 'Please write the set as it will be swum, for example “4 x 50 freestyle, 20 seconds rest”.' };
    return { category, name, cue: clean(b.cue, 240), kind, detail };
  }
  if (category.toLowerCase() === MINI.toLowerCase()) return { error: 'The Mini practice category holds sets only. Choose “Mini-practice set” as how it is recorded.' };
  if (kind === 'distance' && !STROKES.some((s) => s.toLowerCase() === category.toLowerCase())) return { error: 'A distance skill belongs to a stroke category (Freestyle, Backstroke, Breaststroke or Butterfly).' };
  const canon = kind === 'distance' ? STROKES.find((s) => s.toLowerCase() === category.toLowerCase()) : category;
  return { category: canon, name, cue: clean(b.cue, 240), kind, detail: '' };
}

export function parseMinimum(b) {
  const stroke = STROKES.find((s) => s === b.stroke);
  if (!stroke) return { error: 'Choose a stroke.' };
  if (!ASSESSED_GROUPS.includes(b.group_name)) return { error: 'Choose a group.' };
  if (b.yards === '' || b.yards == null) return { stroke, group_name: b.group_name, yards: null };
  const y = Number(b.yards);
  if (!Number.isInteger(y) || y < POOL_YARDS || y > MAX_YARDS || y % POOL_YARDS) return { error: `Enter a whole number of lengths: ${POOL_YARDS}, ${POOL_YARDS * 2}, ${POOL_YARDS * 3} yards and so on (up to ${MAX_YARDS}), or leave it blank for no minimum.` };
  return { stroke, group_name: b.group_name, yards: y };
}

async function allSkills(env) {
  const [skills, marks] = await Promise.all([
    env.DB.prepare(`SELECT id, category, name, cue, detail, kind, sort, active, updated_at, updated_by FROM assess_skills`).all(),
    env.DB.prepare(`SELECT skill_id, group_name, mark FROM assess_group_skills`).all(),
  ]);
  const by = new Map();
  for (const m of marks.results) { if (!by.has(m.skill_id)) by.set(m.skill_id, {}); by.get(m.skill_id)[m.group_name] = m.mark; }
  return skills.results.map((s) => ({ ...s, active: !!s.active, marks: by.get(s.id) || {} })).sort(byOrder);
}

// The checklist a coach works from for one group: its active skills in order, with the group's minimum for each distance skill.
export async function checklistFor(env, group) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.category, s.name, s.cue, s.detail, s.kind, s.sort, g.mark
       FROM assess_skills s JOIN assess_group_skills g ON g.skill_id = s.id
      WHERE s.active = 1 AND g.group_name = ?`).bind(group).all();
  const mins = await env.DB.prepare(`SELECT stroke, yards FROM assess_min_distance WHERE group_name = ?`).bind(group).all();
  const minOf = Object.fromEntries(mins.results.map((m) => [m.stroke, m.yards]));
  return results.sort(byOrder).map((s) => ({ ...s, min_yards: s.kind === 'distance' ? (minOf[s.category] ?? null) : null }));
}

// Returns a Response, or null if the path is not an assessment path. Called from admin.mjs (needs the "assessment" role).
export async function handleAssessmentAdmin(env, me, method, path, body, audit) {
  const sched = await handleScheduleAdmin(env, me, method, path, body, audit);
  if (sched) return sched;
  const intake = await handleIntakeAdmin(env, me, method, path, body);
  if (intake) return intake;

  if (method === 'GET' && path === '/assessment/skills') {
    const [skills, mins] = await Promise.all([allSkills(env), env.DB.prepare(`SELECT stroke, group_name, yards FROM assess_min_distance`).all()]);
    return json({ skills, minimums: mins.results, groups: ASSESSED_GROUPS, strokes: STROKES, kinds: KINDS, categories: [...new Set([...CATEGORY_ORDER, ...skills.map((s) => s.category)])], poolYards: POOL_YARDS });
  }

  let m = path.match(/^\/assessment\/groups\/([^/]+)\/checklist$/);
  if (method === 'GET' && m) {
    const group = ASSESSED_GROUPS.find((g) => g === decodeURIComponent(m[1]));
    if (!group) return fail(404, 'That group is not assessed.');
    return json({ group, checklist: await checklistFor(env, group) });
  }

  // Add a skill, or change one (body.id). New skills go to the end of their category.
  if (method === 'POST' && path === '/assessment/skills') {
    const s = parseSkill(body);
    if (s.error) return fail(400, s.error);
    const id = body.id ? Number(body.id) : null;
    const dupe = await env.DB.prepare(`SELECT id FROM assess_skills WHERE category = ? AND name = ? AND id IS NOT ?`).bind(s.category, s.name, id).first();
    if (dupe) return fail(409, 'That category already has a skill with this name.');
    if (s.kind === 'distance') {
      const other = await env.DB.prepare(`SELECT id FROM assess_skills WHERE category = ? AND kind = 'distance' AND active = 1 AND id IS NOT ?`).bind(s.category, id).first();
      if (other) return fail(409, `${s.category} already has a distance skill. Each stroke has one.`);
    }
    if (id) {
      const cur = await env.DB.prepare(`SELECT id, kind, category FROM assess_skills WHERE id = ?`).bind(id).first();
      if (!cur) return fail(404, 'That skill no longer exists.');
      if (cur.kind !== s.kind) {
        // Changing the kind could leave marks that no longer fit; drop the ones that do not.
        const marks = await env.DB.prepare(`SELECT group_name, mark FROM assess_group_skills WHERE skill_id = ?`).bind(id).all();
        const bad = marks.results.filter((x) => !markOk(s.kind, x.mark));
        if (bad.length) await env.DB.batch(bad.map((x) => env.DB.prepare(`DELETE FROM assess_group_skills WHERE skill_id = ? AND group_name = ?`).bind(id, x.group_name)));
      }
      const sort = cur.category.toLowerCase() === s.category.toLowerCase() ? null : (await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) + 10 AS n FROM assess_skills WHERE category = ?`).bind(s.category).first()).n;
      await env.DB.prepare(`UPDATE assess_skills SET category = ?, name = ?, cue = ?, detail = ?, kind = ?, sort = COALESCE(?, sort), updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(s.category, s.name, s.cue, s.detail, s.kind, sort, me.email, id).run();
      await audit('assessment', 'edit skill', `${s.category}: ${s.name}`);
      return json({ ok: true, id, updated: true });
    }
    const next = (await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) + 10 AS n FROM assess_skills WHERE category = ?`).bind(s.category).first()).n;
    const r = await env.DB.prepare(`INSERT INTO assess_skills (category, name, cue, detail, kind, sort, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(s.category, s.name, s.cue, s.detail, s.kind, next, me.email, me.email).run();
    await audit('assessment', 'add skill', `${s.category}: ${s.name}`);
    return json({ ok: true, id: r.meta.last_row_id });
  }

  m = path.match(/^\/assessment\/skills\/(\d+)\/(active|marks|move)$/);
  if (method === 'POST' && m) {
    const id = Number(m[1]), act = m[2];
    const sk = await env.DB.prepare(`SELECT id, category, name, kind, sort, active FROM assess_skills WHERE id = ?`).bind(id).first();
    if (!sk) return fail(404, 'That skill no longer exists.');

    // Archive or restore. An archived skill leaves every checklist but keeps its marks, so restoring brings it back as it was.
    if (act === 'active') {
      const on = body.active ? 1 : 0;
      if (on && sk.kind === 'distance') {
        const other = await env.DB.prepare(`SELECT id FROM assess_skills WHERE category = ? AND kind = 'distance' AND active = 1 AND id != ?`).bind(sk.category, id).first();
        if (other) return fail(409, `${sk.category} already has an active distance skill.`);
      }
      await env.DB.prepare(`UPDATE assess_skills SET active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(on, me.email, id).run();
      await audit('assessment', on ? 'restore skill' : 'archive skill', `${sk.category}: ${sk.name}`);
      return json({ ok: true });
    }

    // Attach to, change on, or take off groups. body.marks = { Splash: 'G', Tidepool: 'A', Riptide: '' } (blank = off).
    if (act === 'marks') {
      const want = body.marks && typeof body.marks === 'object' ? body.marks : {};
      const stmts = [];
      for (const [g, mark] of Object.entries(want)) {
        if (!ASSESSED_GROUPS.includes(g)) return fail(400, `${g} is not an assessed group.`);
        const mk = mark == null ? '' : String(mark);
        if (!markOk(sk.kind, mk)) return fail(400, sk.kind === 'distance' ? 'Distance swum is logged (L), not scored.' : 'Choose gating (G) or assessed (A).');
        stmts.push(mk === ''
          ? env.DB.prepare(`DELETE FROM assess_group_skills WHERE skill_id = ? AND group_name = ?`).bind(id, g)
          : env.DB.prepare(`INSERT INTO assess_group_skills (skill_id, group_name, mark) VALUES (?, ?, ?) ON CONFLICT (skill_id, group_name) DO UPDATE SET mark = excluded.mark`).bind(id, g, mk));
      }
      if (!stmts.length) return fail(400, 'Nothing to change.');
      await env.DB.batch(stmts);
      await audit('assessment', 'change groups', `${sk.category}: ${sk.name} → ${Object.entries(want).map(([g, k]) => `${g} ${k || 'off'}`).join(', ')}`);
      return json({ ok: true });
    }

    // Move up or down inside the category.
    const dir = body.dir === 'up' ? -1 : body.dir === 'down' ? 1 : 0;
    if (!dir) return fail(400, 'Choose up or down.');
    const { results } = await env.DB.prepare(`SELECT id, sort FROM assess_skills WHERE category = ? ORDER BY sort, id`).bind(sk.category).all();
    const i = results.findIndex((x) => x.id === id), j = i + dir;
    if (j < 0 || j >= results.length) return json({ ok: true });
    const order = results.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    await env.DB.batch(order.map((sid, k) => env.DB.prepare(`UPDATE assess_skills SET sort = ? WHERE id = ?`).bind((k + 1) * 10, sid)));
    return json({ ok: true });
  }

  // Minimum yards for a stroke and group. Setting one also puts that stroke's distance skill on the group's checklist.
  if (method === 'POST' && path === '/assessment/minimums') {
    const p = parseMinimum(body);
    if (p.error) return fail(400, p.error);
    if (p.yards == null) {
      await env.DB.prepare(`DELETE FROM assess_min_distance WHERE stroke = ? AND group_name = ?`).bind(p.stroke, p.group_name).run();
      await audit('assessment', 'clear minimum', `${p.stroke}, ${p.group_name}`);
      return json({ ok: true });
    }
    const ds = await env.DB.prepare(`SELECT id FROM assess_skills WHERE category = ? AND kind = 'distance' AND active = 1`).bind(p.stroke).first();
    if (!ds) return fail(400, `Add a distance skill for ${p.stroke} first (Skill library).`);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES (?, ?, ?) ON CONFLICT (stroke, group_name) DO UPDATE SET yards = excluded.yards`).bind(p.stroke, p.group_name, p.yards),
      env.DB.prepare(`INSERT OR IGNORE INTO assess_group_skills (skill_id, group_name, mark) VALUES (?, ?, 'L')`).bind(ds.id, p.group_name),
    ]);
    await audit('assessment', 'set minimum', `${p.stroke}, ${p.group_name}: ${p.yards} yd`);
    return json({ ok: true });
  }

  return null;
}
