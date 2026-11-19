// Coaching staff records (/api/admin/staff/*) and the public Coaching Staff page (/api/content/staff).
// Who sees what:
//   * managers (owner or the "staff" role): every coach's full record, private notes, the review queue;
//   * a coach (any admin whose sign-in email is linked to a coach row): their own record, minus private notes.
//     Their edits to anything that shows on the public page wait in staff_changes for a manager's OK;
//     private items (date of birth, unpublished phone, unpublished accomplishments) save straight away.
// Nothing is hard-deleted: items are soft-removed and every change goes to staff_history (before/after).
// Date of birth and private notes are never sent to the public page, whatever the publish list says.
import { json, fail, clean } from './util.mjs';

export const STAFF_GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers', 'Surge', 'Senior', 'Dryland'];
export const KINDS = {
  deck: 'On-deck accomplishments', offdeck: 'Off-deck accomplishments', membership: 'Professional memberships',
  position: 'LSC and national positions', certification: 'Certifications', education: 'Education', season: 'Season record',
};
export const LEVELS = { club: 'Club', lsc: 'LSC (NC Swimming)', zone: 'Zone', national: 'National', international: 'International' };
// Profile fields that can appear on the public page. "years" = years with the team, worked out from the start date.
export const PUB_FIELDS = ['photo', 'role', 'subtitle', 'groups', 'email', 'phone', 'years', 'bio'];
const MANAGER_ONLY = ['name', 'role', 'email', 'started_on', 'ended_on', 'active', 'on_staff_page', 'sort', 'notes'];
const SELF_FIELDS = ['subtitle', 'groups', 'bio', 'phone', 'dob', 'photo_alt', 'publish'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO = 1.5 * 1024 * 1024;

export const isManager = (me) => me.roles.includes('owner') || me.roles.includes('staff');
export const linkedCoach = (env, me) => env.DB.prepare(`SELECT id FROM coach_authors WHERE email = ?`).bind(me.email).first();
const today = () => new Date().toISOString().slice(0, 10);
const list = (s) => (s ? String(s).split(',').filter(Boolean) : []);
const text = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const year = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null; };

export function yearsWith(c, on = today()) {
  if (!c.started_on) return null;
  const end = c.ended_on && c.ended_on < on ? c.ended_on : on;
  const [y1, m1, d1] = c.started_on.split('-').map(Number), [y2, m2, d2] = end.split('-').map(Number);
  let y = y2 - y1; if (m2 < m1 || (m2 === m1 && d2 < d1)) y--;
  return Math.max(0, y);
}

// ---------- parsing ----------
// Returns { vals } with only the fields present in the body, or { error }.
function parseProfile(b, fields) {
  const v = {};
  const has = (k) => fields.includes(k) && Object.prototype.hasOwnProperty.call(b, k);
  if (has('name')) { v.name = clean(b.name, 60); if (!v.name) return { error: 'Please enter a name.' }; }
  if (has('role')) v.role = clean(b.role, 60);
  if (has('subtitle')) v.subtitle = clean(b.subtitle, 80);
  if (has('email')) {
    v.email = clean(b.email, 120).toLowerCase() || null;
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return { error: 'That email does not look right.' };
  }
  if (has('phone')) { v.phone = clean(b.phone, 30); if (v.phone && !/^[0-9+().\s-]{7,30}$/.test(v.phone)) return { error: 'That phone number does not look right.' }; }
  for (const k of ['dob', 'started_on', 'ended_on']) if (has(k)) {
    v[k] = clean(b[k], 10) || null;
    if (v[k] && !DATE.test(v[k])) return { error: 'Dates must be full dates (YYYY-MM-DD).' };
  }
  if (v.started_on && v.ended_on && v.ended_on < v.started_on) return { error: 'The end date is before the start date.' };
  if (has('groups')) v.groups = (Array.isArray(b.groups) ? b.groups : []).filter((g) => STAFF_GROUPS.includes(g)).join(',');
  if (has('publish')) v.publish = PUB_FIELDS.filter((f) => (Array.isArray(b.publish) ? b.publish : []).includes(f)).join(',');
  if (has('bio')) { v.bio = text(b.bio, 6000); }
  if (has('notes')) v.notes = text(b.notes, 4000);
  if (has('photo_alt')) v.photo_alt = clean(b.photo_alt, 160);
  if (has('active')) v.active = b.active ? 1 : 0;
  if (has('on_staff_page')) v.on_staff_page = b.on_staff_page ? 1 : 0;
  if (has('sort')) { const n = Number(b.sort); v.sort = Number.isInteger(n) && n >= 0 && n <= 999 ? n : 100; }
  return { vals: v };
}
function parseItem(b) {
  const kind = Object.keys(KINDS).includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'Choose what kind of item this is.' };
  const title = clean(b.title, 160);
  if (!title) return { error: 'Please give the item a title.' };
  const y = b.year === '' || b.year == null ? null : year(b.year), yt = b.year_to === '' || b.year_to == null ? null : year(b.year_to);
  if ((b.year && y === null) || (b.year_to && yt === null)) return { error: 'Years must be four digits (for example 2026).' };
  if (y && yt && yt < y) return { error: 'The end year is before the start year.' };
  const exp = clean(b.expires_on, 10) || null;
  if (exp && !DATE.test(exp)) return { error: 'The expiry date must be a full date.' };
  return { vals: { kind, title, org: clean(b.org, 120), rank: clean(b.rank, 80), level: Object.keys(LEVELS).includes(b.level) ? b.level : '',
    detail: text(b.detail, 1500), year: y, year_to: yt, expires_on: exp, publish: b.publish ? 1 : 0 } };
}

// ---------- shared reads ----------
const COACH_COLS = `id, name, role, subtitle, groups, email, phone, dob, started_on, ended_on, bio, notes, photo_url, photo_key, photo_alt,
  publish, active, on_staff_page, sort, updated_by, updated_at`;
async function getCoach(env, id) { return env.DB.prepare(`SELECT ${COACH_COLS} FROM coach_authors WHERE id = ?`).bind(id).first(); }
const shapeCoach = (c, manager) => {
  const o = { ...c, groups: list(c.groups), publish: list(c.publish), active: !!c.active, on_staff_page: !!c.on_staff_page, years: yearsWith(c), has_photo: !!(c.photo_key || c.photo_url) };
  delete o.photo_key;
  if (!manager) delete o.notes;
  return o;
};
const shapeItem = (i) => ({ ...i, publish: !!i.publish, approved: !!i.approved });
async function hist(env, coachId, me, action, detail) {
  await env.DB.prepare(`INSERT INTO staff_history (coach_id, by_email, action, detail) VALUES (?, ?, ?, ?)`)
    .bind(coachId, me.email, action, detail == null ? null : JSON.stringify(detail).slice(0, 20000)).run();
}
function diff(before, after) {
  const b = {}, a = {};
  for (const k of Object.keys(after)) if (String(before[k] ?? '') !== String(after[k] ?? '')) { b[k] = before[k] ?? null; a[k] = after[k]; }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
async function applyProfile(env, id, vals, me) {
  const keys = Object.keys(vals);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE coach_authors SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(...keys.map((k) => vals[k]), me.email, id).run();
}
function decodePhoto(data) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) return { error: 'Please choose a JPG, PNG or WebP photo.' };
  const bin = atob(m[2]);
  if (bin.length > MAX_PHOTO) return { error: 'That photo is too large (1.5 MB maximum after resizing).' };
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], ext: PHOTO_TYPES[m[1]], bytes };
}
async function servePhoto(env, key) {
  if (!env.REPORTS || !key) return fail(404, 'No photo');
  const o = await env.REPORTS.get(key);
  if (!o) return fail(404, 'No photo');
  return new Response(o.body, { headers: { 'content-type': (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', 'cache-control': 'private, max-age=300' } });
}

// ---------- admin API ----------
export async function handleStaffAdmin(env, me, method, path, body, audit) {
  const manager = isManager(me);
  const mine = await linkedCoach(env, me);
  const myId = mine ? mine.id : null;
  const canSee = (id) => manager || id === myId;
  const log = (action, detail) => audit('staff', action, detail);

  if (method === 'GET' && path === '/staff') {
    const rows = (await env.DB.prepare(`SELECT ${COACH_COLS} FROM coach_authors ${manager ? '' : 'WHERE id = ?'} ORDER BY active DESC, sort, name`).bind(...(manager ? [] : [myId ?? -1])).all()).results;
    let queue = null;
    if (manager) {
      const ch = (await env.DB.prepare(`SELECT c.id, c.coach_id, c.json, c.photo_key, c.submitted_by, c.submitted_at, a.name FROM staff_changes c JOIN coach_authors a ON a.id = c.coach_id WHERE c.status = 'pending' ORDER BY c.id`).all()).results;
      const it = (await env.DB.prepare(`SELECT i.*, a.name FROM staff_items i JOIN coach_authors a ON a.id = i.coach_id WHERE i.approved = 0 AND i.removed_at IS NULL ORDER BY i.id`).all()).results;
      queue = { changes: ch.map((c) => ({ ...c, json: JSON.parse(c.json), has_photo: !!c.photo_key, photo_key: undefined })), items: it.map(shapeItem) };
    }
    const counts = (await env.DB.prepare(`SELECT coach_id, COUNT(*) n FROM staff_items WHERE removed_at IS NULL GROUP BY coach_id`).all()).results;
    return json({
      manager, mineId: myId, kinds: KINDS, levels: LEVELS, groups: STAFF_GROUPS, pubFields: PUB_FIELDS, today: today(), queue,
      coaches: rows.map((c) => ({ ...shapeCoach(c, manager), bio: undefined, notes: undefined, items: (counts.find((x) => x.coach_id === c.id) || { n: 0 }).n })),
    });
  }

  if (method === 'POST' && path === '/staff') {
    if (!manager) return fail(403, 'Only an owner or the Staff records role can add a coach.');
    const p = parseProfile(body, [...MANAGER_ONLY, ...SELF_FIELDS]);
    if (p.error) return fail(400, p.error);
    if (!p.vals.name) return fail(400, 'Please enter a name.');
    try {
      const r = await env.DB.prepare(`INSERT INTO coach_authors (name, email) VALUES (?, ?)`).bind(p.vals.name, p.vals.email ?? null).run();
      const id = r.meta.last_row_id;
      await applyProfile(env, id, p.vals, me);
      await hist(env, id, me, 'add coach', { after: { ...p.vals, dob: p.vals.dob ? '(set)' : undefined } });
      await log('add coach', p.vals.name);
      return json({ ok: true, id });
    } catch (e) { if (/UNIQUE/i.test(String(e))) return fail(400, 'Another coach already uses that email.'); throw e; }
  }

  // review queue decisions
  let m = path.match(/^\/staff\/changes\/(\d+)\/(approve|decline|photo)$/);
  if (m) {
    if (!manager) return fail(403, 'Only an owner or the Staff records role can review changes.');
    const ch = await env.DB.prepare(`SELECT * FROM staff_changes WHERE id = ?`).bind(m[1]).first();
    if (!ch) return fail(404, 'That change no longer exists.');
    if (method === 'GET' && m[2] === 'photo') return servePhoto(env, ch.photo_key);
    if (method !== 'POST' || m[2] === 'photo') return null;
    if (ch.status !== 'pending') return fail(400, 'That change was already decided.');
    const c = await getCoach(env, ch.coach_id);
    if (m[2] === 'approve') {
      const vals = JSON.parse(ch.json);
      if (ch.photo_key) { vals.photo_key = ch.photo_key; vals.photo_url = `/api/content/staff/photo/${c.id}?v=${ch.id}`; }
      await applyProfile(env, c.id, vals, me);
      await hist(env, c.id, me, 'approve profile change', { ...diff(c, vals), submitted_by: ch.submitted_by });
    } else await hist(env, c.id, me, 'decline profile change', { proposed: JSON.parse(ch.json), note: clean(body.note, 300) });
    await env.DB.prepare(`UPDATE staff_changes SET status = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?`)
      .bind(m[2] === 'approve' ? 'approved' : 'declined', me.email, clean(body.note, 300), ch.id).run();
    await log(m[2] === 'approve' ? 'approve profile change' : 'decline profile change', c.name);
    return json({ ok: true });
  }
  m = path.match(/^\/staff\/items\/(\d+)\/(approve|decline)$/);
  if (method === 'POST' && m) {
    if (!manager) return fail(403, 'Only an owner or the Staff records role can approve items.');
    const it = await env.DB.prepare(`SELECT * FROM staff_items WHERE id = ? AND removed_at IS NULL`).bind(m[1]).first();
    if (!it) return fail(404, 'That item no longer exists.');
    if (m[2] === 'approve') await env.DB.prepare(`UPDATE staff_items SET approved = 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(me.email, it.id).run();
    else await env.DB.prepare(`UPDATE staff_items SET approved = 1, publish = 0, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(me.email, it.id).run();
    await hist(env, it.coach_id, me, m[2] === 'approve' ? 'approve item for the public page' : 'keep item private', { item: it.id, title: it.title });
    await log(m[2] === 'approve' ? 'approve item' : 'decline item', it.title);
    return json({ ok: true });
  }

  m = path.match(/^\/staff\/(\d+)(?:\/(photo|items|history)(?:\/(\d+)\/(remove|restore))?)?$/);
  if (!m) return null;
  const id = Number(m[1]);
  if (!canSee(id)) return fail(403, 'You can only open your own coach record.');
  const c = await getCoach(env, id);
  if (!c) return fail(404, 'That coach is not on file.');
  const self = !manager;

  if (method === 'GET' && !m[2]) {
    const items = (await env.DB.prepare(`SELECT * FROM staff_items WHERE coach_id = ? AND removed_at IS NULL ORDER BY kind, COALESCE(year, 0) DESC, id DESC`).bind(id).all()).results;
    const pending = await env.DB.prepare(`SELECT id, json, photo_key, submitted_by, submitted_at FROM staff_changes WHERE coach_id = ? AND status = 'pending' ORDER BY id DESC`).bind(id).first();
    const history = (await env.DB.prepare(`SELECT at, by_email, action, detail FROM staff_history WHERE coach_id = ? ORDER BY id DESC LIMIT 150`).bind(id).all()).results;
    const removed = manager ? (await env.DB.prepare(`SELECT id, kind, title, year, removed_at, removed_by FROM staff_items WHERE coach_id = ? AND removed_at IS NOT NULL ORDER BY removed_at DESC LIMIT 50`).bind(id).all()).results : [];
    return json({
      manager, self: id === myId, coach: shapeCoach(c, manager), items: items.map(shapeItem), removed,
      pending: pending ? { id: pending.id, json: JSON.parse(pending.json), has_photo: !!pending.photo_key, submitted_by: pending.submitted_by, submitted_at: pending.submitted_at } : null,
      history: history.map((h) => ({ ...h, detail: h.detail ? safeJson(h.detail) : null })),
    });
  }
  if (method === 'GET' && m[2] === 'photo') return servePhoto(env, c.photo_key);

  // save profile
  if (method === 'POST' && !m[2]) {
    const p = parseProfile(body, manager ? [...MANAGER_ONLY, ...SELF_FIELDS] : SELF_FIELDS);
    if (p.error) return fail(400, p.error);
    const vals = p.vals;
    try {
      if (manager) {
        const d = diff(c, vals);
        if (!d) return json({ ok: true, unchanged: true });
        await applyProfile(env, id, vals, me);
        if (d.before.dob !== undefined) { d.before.dob = d.before.dob ? '(set)' : null; d.after.dob = d.after.dob ? '(changed)' : null; }
        await hist(env, id, me, 'edit profile', d);
        await log('edit coach profile', c.name);
        return json({ ok: true });
      }
      // a coach editing their own record: private fields save now, public-facing ones wait for review
      const pubAfter = vals.publish !== undefined ? list(vals.publish) : list(c.publish);
      const direct = {}, review = {};
      for (const k of Object.keys(vals)) {
        if (String(c[k] ?? '') === String(vals[k] ?? '')) continue;
        const isPublic = k === 'publish' || k === 'photo_alt' || (PUB_FIELDS.includes(k) && pubAfter.includes(k));
        (isPublic ? review : direct)[k] = vals[k];
      }
      if (Object.keys(direct).length) {
        await applyProfile(env, id, direct, me);
        const d = diff(c, direct);
        if (d && d.before.dob !== undefined) { d.before.dob = d.before.dob ? '(set)' : null; d.after.dob = d.after.dob ? '(changed)' : null; }
        await hist(env, id, me, 'edit own record (private)', d);
      }
      let queued = false;
      if (Object.keys(review).length) { await queueChange(env, c, me, review, null); queued = true; }
      if (Object.keys(direct).length || queued) await log(queued ? 'submit profile change' : 'edit own record', c.name);
      return json({ ok: true, queued });
    } catch (e) { if (/UNIQUE/i.test(String(e))) return fail(400, 'Another coach already uses that email.'); throw e; }
  }

  if (method === 'POST' && m[2] === 'photo') {
    if (!env.REPORTS) return fail(503, 'Photo storage is not connected yet.');
    const ph = decodePhoto(body.data);
    if (ph.error) return fail(400, ph.error);
    const key = `staff/${self ? 'pending' : 'photos'}/${id}-${Date.now()}.${ph.ext}`;
    await env.REPORTS.put(key, ph.bytes, { httpMetadata: { contentType: ph.type } });
    if (self) {
      await queueChange(env, c, me, {}, key);
      await log('submit new photo', c.name);
      return json({ ok: true, queued: true });
    }
    await applyProfile(env, id, { photo_key: key, photo_url: `/api/content/staff/photo/${id}?v=${Date.now()}` }, me);
    await hist(env, id, me, 'new photo', { before: { photo: c.photo_key || c.photo_url || null }, after: { photo: key } });
    await log('new coach photo', c.name);
    return json({ ok: true });
  }

  if (method === 'GET' && m[2] === 'history') {
    const h = (await env.DB.prepare(`SELECT at, by_email, action, detail FROM staff_history WHERE coach_id = ? ORDER BY id DESC`).bind(id).all()).results;
    return json({ history: h.map((x) => ({ ...x, detail: x.detail ? safeJson(x.detail) : null })) });
  }

  if (method === 'POST' && m[2] === 'items') {
    if (m[3]) {
      const it = await env.DB.prepare(`SELECT * FROM staff_items WHERE id = ? AND coach_id = ?`).bind(m[3], id).first();
      if (!it) return fail(404, 'That item no longer exists.');
      if (m[4] === 'restore') {
        if (!manager) return fail(403, 'Ask an owner to restore a removed item.');
        await env.DB.prepare(`UPDATE staff_items SET removed_at = NULL, removed_by = NULL WHERE id = ?`).bind(it.id).run();
        await hist(env, id, me, 'restore item', { item: it.id, title: it.title });
      } else {
        await env.DB.prepare(`UPDATE staff_items SET removed_at = datetime('now'), removed_by = ? WHERE id = ?`).bind(me.email, it.id).run();
        await hist(env, id, me, 'remove item', { item: shapeItem(it) });
      }
      await log(m[4] + ' item', it.title);
      return json({ ok: true });
    }
    const p = parseItem(body);
    if (p.error) return fail(400, p.error);
    const v = p.vals;
    const itemId = body.item_id ? Number(body.item_id) : null;
    const before = itemId ? await env.DB.prepare(`SELECT * FROM staff_items WHERE id = ? AND coach_id = ? AND removed_at IS NULL`).bind(itemId, id).first() : null;
    if (itemId && !before) return fail(404, 'That item no longer exists.');
    // A coach's published item waits for an OK; an unchanged, already-approved item keeps its approval.
    const same = before && ['kind', 'title', 'org', 'rank', 'level', 'detail', 'year', 'year_to', 'publish'].every((k) => String(before[k] ?? '') === String(v[k] ?? ''));
    v.approved = manager || !v.publish ? 1 : same ? before.approved : 0;
    const cols = Object.keys(v);
    if (before) {
      await env.DB.prepare(`UPDATE staff_items SET ${cols.map((k) => k + ' = ?').join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(...cols.map((k) => v[k]), me.email, before.id).run();
      await hist(env, id, me, 'edit item', diff(before, v));
    } else {
      await env.DB.prepare(`INSERT INTO staff_items (coach_id, ${cols.join(', ')}, created_by, updated_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`).bind(id, ...cols.map((k) => v[k]), me.email, me.email).run();
      await hist(env, id, me, 'add item', { item: v });
    }
    await log((before ? 'edit' : 'add') + ' item' + (v.approved ? '' : ' (waiting for review)'), v.title);
    return json({ ok: true, waiting: !v.approved });
  }
  return null;
}
const safeJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

// One pending change per coach: a new submission folds into the waiting one.
async function queueChange(env, c, me, fields, photoKey) {
  const p = await env.DB.prepare(`SELECT id, json, photo_key FROM staff_changes WHERE coach_id = ? AND status = 'pending' ORDER BY id DESC`).bind(c.id).first();
  if (p) {
    const merged = { ...JSON.parse(p.json), ...fields };
    await env.DB.prepare(`UPDATE staff_changes SET json = ?, photo_key = ?, submitted_by = ?, submitted_at = datetime('now') WHERE id = ?`).bind(JSON.stringify(merged), photoKey || p.photo_key, me.email, p.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO staff_changes (coach_id, json, photo_key, submitted_by) VALUES (?, ?, ?, ?)`).bind(c.id, JSON.stringify(fields), photoKey, me.email).run();
  }
  await hist(env, c.id, me, 'submit change for review', { proposed: fields, photo: photoKey ? 'new photo' : undefined });
}

// ---------- public ----------
export async function publicStaff(env) {
  const t = today();
  const rows = (await env.DB.prepare(`SELECT ${COACH_COLS} FROM coach_authors WHERE active = 1 AND on_staff_page = 1 AND (ended_on IS NULL OR ended_on > ?) ORDER BY sort, name`).bind(t).all()).results;
  const items = rows.length ? (await env.DB.prepare(`SELECT coach_id, kind, title, org, rank, level, detail, year, year_to FROM staff_items
      WHERE publish = 1 AND approved = 1 AND removed_at IS NULL AND coach_id IN (${rows.map(() => '?').join(',')}) ORDER BY COALESCE(year, 0) DESC, id DESC`).bind(...rows.map((r) => r.id)).all()).results : [];
  const coaches = rows.map((c) => {
    const pub = list(c.publish), o = { id: c.id, name: c.name };
    if (pub.includes('photo') && (c.photo_key || c.photo_url)) { o.photo = c.photo_url; o.photo_alt = c.photo_alt || ''; }
    for (const k of ['role', 'subtitle', 'email', 'phone', 'bio']) if (pub.includes(k) && c[k]) o[k] = c[k];
    if (pub.includes('groups')) o.groups = list(c.groups);
    if (pub.includes('years') && c.started_on) { o.since = Number(c.started_on.slice(0, 4)); o.years = yearsWith(c, t); }
    o.items = items.filter((i) => i.coach_id === c.id).map(({ coach_id, ...i }) => i);
    return o;
  });
  return json({ coaches, kinds: KINDS, levels: LEVELS }, 200, { 'cache-control': 'public, max-age=60' });
}
export async function publicStaffPhoto(env, id) {
  const c = await env.DB.prepare(`SELECT photo_key, publish, active, on_staff_page FROM coach_authors WHERE id = ?`).bind(id).first();
  if (!c || !c.photo_key || !list(c.publish).includes('photo')) return fail(404, 'No photo');
  const r = await servePhoto(env, c.photo_key);
  if (r.ok) r.headers.set('cache-control', 'public, max-age=86400');
  return r;
}
