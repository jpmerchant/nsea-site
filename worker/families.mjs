// Families & Roster (JP, Nov 24 2026): who a family sign-in belongs to, and whether that family may use gated tools.
// A family is eligible when its sign-in email is linked to at least one swimmer whose roster status is active or alumni.
// Links come from Captyn (source 'captyn', replaced on each roster import) or are made by hand here (source 'manual'):
// approving a request, an alum not in Captyn, or a family whose Captyn email differs from the one they use.
// One sign-in per family for now (JP): the members row is the family's account; Captyn's Account Email is its address.
// Gating itself is switched on with the FAMILY_GATE = "on" variable; until then this only reports eligibility.
import { json, fail, clean } from './util.mjs';
import { newMemberInvite } from './carpool.mjs';

export const ELIGIBLE = ['active', 'alumni'];
export const gateOn = (env) => String(env.FAMILY_GATE || '').toLowerCase() === 'on';

// Swimmers linked to an email, with roster status. Swimmers missing from the roster count as not eligible.
export async function familySwimmers(env, email) {
  const r = await env.DB.prepare(
    `SELECT f.usa_id, f.source, s.name, s.status, s.grp FROM family_swimmer f LEFT JOIN roster_swimmer s ON s.usa_id = f.usa_id
      WHERE f.email = ? ORDER BY s.name`).bind(String(email || '').toLowerCase()).all();
  return r.results.map((x) => ({ usa_id: x.usa_id, name: x.name || '(not on the roster)', status: x.status || 'unknown', group: x.grp || null, source: x.source }));
}
export async function familyAccess(env, email) {
  const swimmers = await familySwimmers(env, email);
  const eligible = swimmers.some((s) => ELIGIBLE.includes(s.status));
  return { eligible, alumniOnly: eligible && !swimmers.some((s) => s.status === 'active'), swimmers };
}

// Roster name search for the link picker. Matches every word against the swimmer's name.
async function searchRoster(env, q) {
  const words = clean(q, 60).toLowerCase().split(' ').filter((w) => w.length >= 2).slice(0, 3);
  if (!words.length) return [];
  const r = await env.DB.prepare(`SELECT usa_id, name, status, grp FROM roster_swimmer WHERE ${words.map(() => 'lower(name) LIKE ?').join(' AND ')} ORDER BY status = 'active' DESC, name LIMIT 15`)
    .bind(...words.map((w) => '%' + w + '%')).all();
  return r.results;
}

export async function handleFamiliesAdmin(env, me, method, path, body, audit, origin) {
  const ok = (d) => json(d || { ok: true });

  if (method === 'GET' && path === '/families') {
    const [imp, counts, members, links] = await Promise.all([
      env.DB.prepare(`SELECT exported_at, swimmers, families, links, loaded_at FROM roster_import ORDER BY id DESC LIMIT 1`).first(),
      env.DB.prepare(`SELECT status, COUNT(*) n FROM roster_swimmer GROUP BY status`).all(),
      env.DB.prepare(`SELECT id, email, family_name, phone, swimmers, note, status, relation, grad_year, created_at FROM members WHERE status != 'disabled' ORDER BY status = 'pending' DESC, family_name`).all(),
      env.DB.prepare(`SELECT f.email, f.usa_id, f.source, s.name, s.status FROM family_swimmer f LEFT JOIN roster_swimmer s ON s.usa_id = f.usa_id`).all(),
    ]);
    const byEmail = {};
    for (const l of links.results) (byEmail[l.email.toLowerCase()] ||= []).push({ usa_id: l.usa_id, name: l.name || '(not on the roster)', status: l.status || 'unknown', source: l.source });
    const unclaimed = await env.DB.prepare(
      `SELECT COUNT(*) n FROM roster_family r WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = r.email)
          AND EXISTS (SELECT 1 FROM family_swimmer f JOIN roster_swimmer s ON s.usa_id = f.usa_id WHERE f.email = r.email AND s.status IN ('active','alumni'))`).first();
    return ok({
      gate: gateOn(env), import: imp || null,
      roster: Object.fromEntries(counts.results.map((c) => [c.status, c.n])),
      unclaimed: unclaimed.n,
      members: members.results.map((m) => {
        const sw = byEmail[m.email.toLowerCase()] || [];
        return { ...m, linked: sw, eligible: sw.some((s) => ELIGIBLE.includes(s.status)) };
      }),
    });
  }

  if (method === 'GET' && path === '/families/roster') return ok({ swimmers: await searchRoster(env, body.q) });

  // Captyn families (eligible ones) that have no sign-in yet, optionally filtered by family or swimmer name.
  if (method === 'GET' && path === '/families/captyn') {
    const q = clean(body.q, 60).toLowerCase();
    const r = await env.DB.prepare(
      `SELECT r.email, r.family_name, r.phone, group_concat(s.name || ' (' || s.status || ')', ', ') swimmers
         FROM roster_family r JOIN family_swimmer f ON f.email = r.email JOIN roster_swimmer s ON s.usa_id = f.usa_id
        WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = r.email)
        GROUP BY r.email HAVING max(s.status IN ('active','alumni')) = 1
           AND (? = '' OR lower(r.family_name) LIKE ? OR lower(group_concat(s.name)) LIKE ?)
        ORDER BY r.family_name LIMIT 60`).bind(q, '%' + q + '%', '%' + q + '%').all();
    return ok({ families: r.results });
  }

  // Make a sign-in for a Captyn family that has not asked yet. Creates the family account (active) and a one-time link.
  if (method === 'POST' && path === '/families/captyn-invite') {
    const email = clean(body.email, 120).toLowerCase();
    const fam = await env.DB.prepare(`SELECT email, family_name, phone FROM roster_family WHERE email = ?`).bind(email).first();
    if (!fam) return fail(404, 'That email is not a Captyn family on the roster.');
    if (!(await familyAccess(env, email)).eligible) return fail(400, 'None of this family’s swimmers is Active or Alumni.');
    let m = await env.DB.prepare(`SELECT id, status FROM members WHERE email = ?`).bind(email).first();
    if (m && m.status !== 'active') return fail(400, 'This family already has an account that is ' + m.status + '. Use the list below.');
    if (!m) {
      const sw = (await familySwimmers(env, email)).map((s) => s.name).join(', ');
      const r = await env.DB.prepare(`INSERT INTO members (email, family_name, phone, swimmers, status, approved_at) VALUES (?, ?, ?, ?, 'active', datetime('now'))`)
        .bind(email, fam.family_name || email, fam.phone || null, clean(sw, 160) || '(from Captyn)').run();
      m = { id: r.meta.last_row_id };
    }
    await audit(env, me, 'families', 'sign-in for Captyn family', fam.family_name);
    return ok({ ok: true, link: await newMemberInvite(env, m.id, origin) });
  }

  // Requests: approving creates the one-time sign-in link (same as Carpool); link the swimmers first so the family is eligible.
  let rq = path.match(/^\/families\/members\/(\d+)\/(approve|reject)$/);
  if (method === 'POST' && rq) {
    const m = await env.DB.prepare(`SELECT id, email, family_name, status FROM members WHERE id = ?`).bind(+rq[1]).first();
    if (!m) return fail(404, 'Family not found');
    if (m.status !== 'pending') return fail(400, 'Not pending.');
    if (rq[2] === 'reject') {
      await env.DB.prepare(`DELETE FROM members WHERE id = ?`).bind(m.id).run();
      await audit(env, me, 'families', 'reject request', m.family_name);
      return ok({ ok: true });
    }
    await env.DB.prepare(`UPDATE members SET status = 'active', approved_at = datetime('now') WHERE id = ?`).bind(m.id).run();
    await audit(env, me, 'families', 'approve request', m.family_name);
    return ok({ ok: true, link: await newMemberInvite(env, m.id, origin), access: await familyAccess(env, m.email) });
  }

  let mm = path.match(/^\/families\/members\/(\d+)\/(link|unlink)$/);
  if (method === 'POST' && mm) {
    const id = +mm[1];
    const m = await env.DB.prepare(`SELECT id, email, family_name FROM members WHERE id = ?`).bind(id).first();
    if (!m) return fail(404, 'Family not found');
    const usa = clean(body.usa_id, 20).toUpperCase();
    const s = await env.DB.prepare(`SELECT usa_id, name FROM roster_swimmer WHERE usa_id = ?`).bind(usa).first();
    if (!s) return fail(404, 'Swimmer not on the roster');
    if (mm[2] === 'link') {
      await env.DB.prepare(`INSERT OR IGNORE INTO family_swimmer (email, usa_id, source, added_by) VALUES (?, ?, 'manual', ?)`).bind(m.email.toLowerCase(), usa, me.email).run();
      await audit(env, me, 'families', 'link swimmer', m.family_name + ' → ' + s.name);
    } else {
      const r = await env.DB.prepare(`DELETE FROM family_swimmer WHERE email = ? AND usa_id = ? AND source = 'manual'`).bind(m.email.toLowerCase(), usa).run();
      if (!r.meta.changes) return fail(400, 'Only links made by hand can be removed here. Captyn links change when Captyn changes.');
      await audit(env, me, 'families', 'unlink swimmer', m.family_name + ' → ' + s.name);
    }
    return ok({ ok: true, access: await familyAccess(env, m.email) });
  }

  return fail(404, 'Not found');
}

export const cleanRelation = (v) => (v === 'alum' ? 'alum' : 'family');
export const cleanGradYear = (v) => { const n = parseInt(v, 10); return n >= 2000 && n <= 2100 ? n : null; };
