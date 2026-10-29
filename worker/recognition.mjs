// Athlete Spotlights and Recognition. Public reads: /api/content/spotlights and /api/content/recognition (see content.mjs).
// Admin writes go through handleRecognitionAdmin (called from content.mjs, so they need the "content" role).
import { json, fail, clean } from './util.mjs';
import { GROUPS } from './coach.mjs';

const URL_OK = /^(https?:\/\/|\/)[^\s]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// Athletes are minors: letters, spaces, apostrophes, periods and hyphens only, and no more than three words.
// This keeps "Mia", "Mia K." and "Mary Kate" but rejects digits and long strings (full names are up to the admin; the form says first name only).
const NAME_OK = /^\p{L}[\p{L}'’.\- ]{0,39}$/u;
const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'spotlight';
const today = () => new Date().toISOString().slice(0, 10);

export function cleanAthlete(v) {
  const n = clean(v, 40);
  if (!n || !NAME_OK.test(n) || n.split(' ').length > 3) return '';
  return n;
}

// "2026-11" -> "2026-27" (a season runs September to August).
export function seasonOf(period) {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Turns a pasted list into [{ athlete, count }]. One athlete per line; an optional count may follow as
// "Mia x3", "Mia ×3", "Mia, 3", "Mia - 3" or "Mia (3)". Blank lines and a leading "-", "*" or "1." are ignored.
export function parseBulk(text) {
  const out = [], bad = [], seen = new Set();
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, '');
    if (!line) continue;
    let count = null;
    const m = line.match(/^(.*?)(?:\s*[,\-–—]\s*|\s+[x×]\s*|\s*\(\s*[x×]?\s*)(\d{1,3})\s*\)?$/i);
    if (m && m[1].trim()) { line = m[1].trim(); count = Number(m[2]); }
    const athlete = cleanAthlete(line);
    if (!athlete) { bad.push(raw.trim()); continue; }
    const key = athlete.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ athlete, count });
  }
  return { entries: out, bad };
}

// Running totals: for each award + athlete, how many months they were recognised and the sum of their counts.
export function totalsOf(entries, season = '') {
  const map = new Map();
  for (const e of entries) {
    if (e.hidden) continue;
    if (season && seasonOf(e.period) !== season) continue;
    const k = e.award_id + '|' + e.athlete.toLowerCase();
    const t = map.get(k) || { award_id: e.award_id, athlete: e.athlete, months: 0, sum: 0 };
    t.months += 1;
    t.sum += e.count || 0;
    map.set(k, t);
  }
  return [...map.values()].sort((a, b) => b.months - a.months || b.sum - a.sum || a.athlete.localeCompare(b.athlete));
}

export function parseSpotlight(b) {
  const title = clean(b.title, 120), body = String(b.body ?? '').replace(/\r/g, '').trim();
  if (!title) return { error: 'Please enter a title.' };
  const athlete = cleanAthlete(b.athlete);
  if (!athlete) return { error: 'Please enter the athlete’s first name (and a last initial if needed). Letters only.' };
  if (!body) return { error: 'Please write the spotlight.' };
  if (body.length > 8000) return { error: 'The spotlight is too long (8,000 characters maximum).' };
  const group = GROUPS.includes(b.group_name) ? b.group_name : '';
  const photo = clean(b.photo_url, 300);
  if (photo && !URL_OK.test(photo)) return { error: 'The photo link must start with https:// or /.' };
  const publish_on = DATE.test(b.publish_on || '') ? b.publish_on : today();
  return { title, athlete, group_name: group, summary: clean(b.summary, 300), body, photo_url: photo, photo_alt: clean(b.photo_alt, 160), publish_on, family_ok: b.family_ok ? 1 : 0 };
}

export function parseAward(b) {
  const name = clean(b.name, 60);
  if (!name) return { error: 'Please enter a name for the award.' };
  return { name, description: clean(b.description, 240), sort: Math.max(0, Math.min(999, parseInt(b.sort, 10) || 0)), active: b.active === false ? 0 : 1 };
}

// ---------- public ----------
export async function publicSpotlights(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, title, athlete, group_name, summary, body, photo_url, photo_alt, publish_on, newsletter_on
       FROM spotlights WHERE status = 'published' AND family_ok = 1 AND publish_on <= ?
      ORDER BY publish_on DESC, id DESC LIMIT 100`).bind(today()).all();
  return json({ spotlights: results }, 200, { 'cache-control': 'public, max-age=60' });
}

export async function publicRecognition(env) {
  const [awards, entries] = await Promise.all([
    env.DB.prepare(`SELECT id, name, description FROM recognition_awards WHERE active = 1 ORDER BY sort, name`).all(),
    env.DB.prepare(
      `SELECT r.award_id, r.period, r.athlete, r.group_name, r.count, r.note, r.hidden
         FROM recognitions r JOIN recognition_awards a ON a.id = r.award_id
        WHERE a.active = 1 AND r.hidden = 0 AND r.period <= ? ORDER BY r.period DESC, r.athlete LIMIT 5000`).bind(today().slice(0, 7)).all(),
  ]);
  const list = entries.results.map((e) => ({ award_id: e.award_id, period: e.period, season: seasonOf(e.period), athlete: e.athlete, group_name: e.group_name, count: e.count, note: e.note }));
  return json({ awards: awards.results, entries: list, seasons: [...new Set(list.map((e) => e.season))] }, 200, { 'cache-control': 'public, max-age=60' });
}

// ---------- admin ----------
// Returns a Response, or null if the path is not a spotlight/recognition path.
export async function handleRecognitionAdmin(env, me, method, path, body, audit) {
  // Spotlights
  if (method === 'GET' && path === '/content/spotlights') {
    const { results } = await env.DB.prepare(
      `SELECT id, slug, title, athlete, group_name, summary, body, photo_url, photo_alt, publish_on, status, family_ok, newsletter_on, updated_at, updated_by
         FROM spotlights ORDER BY publish_on DESC, id DESC LIMIT 300`).all();
    return json({ spotlights: results.map((s) => ({ ...s, family_ok: !!s.family_ok })), groups: GROUPS, today: today() });
  }
  if (method === 'POST' && path === '/content/spotlights') {
    const s = parseSpotlight(body);
    if (s.error) return fail(400, s.error);
    const id = body.id ? Number(body.id) : null;
    const existing = id ? await env.DB.prepare(`SELECT id, status FROM spotlights WHERE id = ?`).bind(id).first() : null;
    if (id && !existing) return fail(404, 'That spotlight no longer exists.');
    const wantPublished = body.status === 'published';
    if (wantPublished && !s.family_ok) return fail(400, 'Tick “Family OK to feature” before publishing.');
    const status = wantPublished ? 'published' : 'draft';
    const f = [s.title, s.athlete, s.group_name, s.summary, s.body, s.photo_url, s.photo_alt, s.publish_on, status, s.family_ok, me.email];
    if (existing) {
      await env.DB.prepare(`UPDATE spotlights SET title=?, athlete=?, group_name=?, summary=?, body=?, photo_url=?, photo_alt=?, publish_on=?, status=?, family_ok=?, updated_by=?, updated_at=datetime('now') WHERE id=?`).bind(...f, existing.id).run();
      await audit('content', 'edit spotlight (' + status + ')', s.title);
      return json({ ok: true, id: existing.id, status });
    }
    let slug = slugify(s.title), n = 1;
    while (await env.DB.prepare(`SELECT 1 x FROM spotlights WHERE slug = ?`).bind(slug).first()) slug = slugify(s.title).slice(0, 44) + '-' + (++n);
    const r = await env.DB.prepare(`INSERT INTO spotlights (title, athlete, group_name, summary, body, photo_url, photo_alt, publish_on, status, family_ok, created_by, updated_by, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...f, me.email, slug).run();
    await audit('content', 'new spotlight (' + status + ')', s.title);
    return json({ ok: true, id: r.meta.last_row_id, status });
  }
  let m = path.match(/^\/content\/spotlights\/(\d+)\/(publish|unpublish|used|unused|delete)$/);
  if (method === 'POST' && m) {
    const s = await env.DB.prepare(`SELECT id, title, family_ok FROM spotlights WHERE id = ?`).bind(m[1]).first();
    if (!s) return fail(404, 'That spotlight no longer exists.');
    const act = m[2];
    if (act === 'delete') {
      await env.DB.prepare(`DELETE FROM spotlights WHERE id = ?`).bind(s.id).run();
      await audit('content', 'delete spotlight', s.title);
    } else if (act === 'publish') {
      if (!s.family_ok) return fail(400, 'Tick “Family OK to feature” on the spotlight before publishing.');
      await env.DB.prepare(`UPDATE spotlights SET status='published', updated_by=?, updated_at=datetime('now') WHERE id=?`).bind(me.email, s.id).run();
      await audit('content', 'publish spotlight', s.title);
    } else if (act === 'unpublish') {
      await env.DB.prepare(`UPDATE spotlights SET status='draft', updated_by=?, updated_at=datetime('now') WHERE id=?`).bind(me.email, s.id).run();
      await audit('content', 'unpublish spotlight', s.title);
    } else {
      const on = act === 'used' ? (DATE.test(body.date || '') ? body.date : today()) : null;
      await env.DB.prepare(`UPDATE spotlights SET newsletter_on=?, updated_by=?, updated_at=datetime('now') WHERE id=?`).bind(on, me.email, s.id).run();
      await audit('content', act === 'used' ? 'mark spotlight used in newsletter' : 'mark spotlight unused', s.title);
    }
    return json({ ok: true });
  }

  // Recognition
  if (method === 'GET' && path === '/content/recognition') {
    const [awards, entries] = await Promise.all([
      env.DB.prepare(`SELECT a.id, a.name, a.description, a.sort, a.active, (SELECT COUNT(*) FROM recognitions r WHERE r.award_id = a.id) AS entries FROM recognition_awards a ORDER BY a.sort, a.name`).all(),
      env.DB.prepare(`SELECT id, award_id, period, athlete, group_name, count, note, hidden FROM recognitions ORDER BY period DESC, athlete LIMIT 5000`).all(),
    ]);
    const list = entries.results.map((e) => ({ ...e, hidden: !!e.hidden }));
    return json({ awards: awards.results.map((a) => ({ ...a, active: !!a.active })), entries: list, groups: GROUPS, now: today().slice(0, 7) });
  }
  if (method === 'POST' && path === '/content/recognition/awards') {
    const a = parseAward(body);
    if (a.error) return fail(400, a.error);
    try {
      if (body.id) {
        await env.DB.prepare(`UPDATE recognition_awards SET name=?, description=?, sort=?, active=? WHERE id=?`).bind(a.name, a.description, a.sort, a.active, Number(body.id)).run();
        await audit('content', 'edit award', a.name);
      } else {
        await env.DB.prepare(`INSERT INTO recognition_awards (name, description, sort, active) VALUES (?, ?, ?, ?)`).bind(a.name, a.description, a.sort, a.active).run();
        await audit('content', 'add award', a.name);
      }
    } catch (e) { if (/UNIQUE/i.test(String(e))) return fail(400, 'There is already an award with that name.'); throw e; }
    return json({ ok: true });
  }
  m = path.match(/^\/content\/recognition\/awards\/(\d+)\/delete$/);
  if (method === 'POST' && m) {
    const a = await env.DB.prepare(`SELECT id, name, (SELECT COUNT(*) FROM recognitions WHERE award_id = recognition_awards.id) AS n FROM recognition_awards WHERE id = ?`).bind(m[1]).first();
    if (!a) return fail(404, 'That award no longer exists.');
    if (a.n) return fail(400, 'This award has entries. Switch it to inactive instead of deleting it.');
    await env.DB.prepare(`DELETE FROM recognition_awards WHERE id = ?`).bind(a.id).run();
    await audit('content', 'delete award', a.name);
    return json({ ok: true });
  }
  // Paste a month's list for one award. Existing athletes for that award + month are updated, not duplicated.
  if (method === 'POST' && path === '/content/recognition/entries') {
    const award = await env.DB.prepare(`SELECT id, name FROM recognition_awards WHERE id = ?`).bind(Number(body.award_id) || 0).first();
    if (!award) return fail(400, 'Please choose an award.');
    const period = clean(body.period, 7);
    if (!MONTH.test(period)) return fail(400, 'Month must look like 2026-11.');
    const group = GROUPS.includes(body.group_name) ? body.group_name : '';
    const { entries, bad } = parseBulk(body.text);
    if (!entries.length) return fail(400, bad.length ? 'None of those lines look like a first name: ' + bad.slice(0, 3).join(' | ') : 'Paste at least one name.');
    if (entries.length > 300) return fail(400, 'That is more than 300 names. Please paste fewer at once.');
    if (body.preview) return json({ ok: true, preview: true, entries, bad });
    const before = (await env.DB.prepare(`SELECT athlete FROM recognitions WHERE award_id = ? AND period = ?`).bind(award.id, period).all()).results.map((r) => r.athlete.toLowerCase());
    await env.DB.batch(entries.map((e) => env.DB.prepare(
      `INSERT INTO recognitions (award_id, period, athlete, group_name, count, created_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(award_id, period, athlete) DO UPDATE SET count = excluded.count, group_name = CASE WHEN excluded.group_name != '' THEN excluded.group_name ELSE recognitions.group_name END`)
      .bind(award.id, period, e.athlete, group, e.count, me.email)));
    const updated = entries.filter((e) => before.includes(e.athlete.toLowerCase())).length;
    await audit('content', 'add recognition', `${award.name} ${period}: ${entries.length - updated} new, ${updated} updated`);
    return json({ ok: true, added: entries.length - updated, updated, bad });
  }
  m = path.match(/^\/content\/recognition\/entries\/(\d+)\/(hide|show|delete)$/);
  if (method === 'POST' && m) {
    const e = await env.DB.prepare(`SELECT r.id, r.athlete, r.period, a.name AS award FROM recognitions r JOIN recognition_awards a ON a.id = r.award_id WHERE r.id = ?`).bind(m[1]).first();
    if (!e) return fail(404, 'That entry no longer exists.');
    if (m[2] === 'delete') await env.DB.prepare(`DELETE FROM recognitions WHERE id = ?`).bind(e.id).run();
    else await env.DB.prepare(`UPDATE recognitions SET hidden = ? WHERE id = ?`).bind(m[2] === 'hide' ? 1 : 0, e.id).run();
    await audit('content', m[2] + ' recognition', `${e.award} ${e.period}: ${e.athlete}`);
    return json({ ok: true });
  }
  return null;
}
