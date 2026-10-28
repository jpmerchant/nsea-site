// Editable site content stored in D1. Public reads: /api/content/*. Admin writes go through handleContentAdmin (called from admin.mjs).
import { json, fail, clean } from './util.mjs';
import { defaults, FEE_GROUPS, OFFERINGS, COACH_TOPICS } from '../src/data/site-data-defaults.mjs';
import { publicAlumni, handleAlumniAdmin } from './alumni.mjs';

export const ART = ['path', 'lanes', 'steps', 'wave', 'clock', 'star'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const row = (r) => ({ month: r.month, quote: r.quote, emphasis: r.emphasis, author: r.author, tags: r.tags ? r.tags.split(',') : [], art: r.art });

export async function handleContent(req, env, url) {
  if (req.method !== 'GET') return fail(405, 'Method not allowed');
  const path = url.pathname.replace('/api/content', '').replace(/\/$/, '');
  if (path === '/thoughts') {
    const now = new Date().toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(`SELECT month, quote, emphasis, author, tags, art FROM thoughts WHERE month <= ? ORDER BY month DESC`).bind(now).all();
    return json({ thoughts: results.map(row) }, 200, { 'cache-control': 'public, max-age=60' });
  }
  if (path === '/alumni') return publicAlumni(env);
  if (path === '/coach') {
    const today = new Date().toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      `SELECT p.slug, p.title, p.summary, p.body, p.topic, p.groups, p.pinned, p.publish_on, p.related_label, p.related_url,
              a.name AS author, a.role AS author_role, a.bio AS author_bio, a.photo_url AS author_photo
         FROM coach_posts p JOIN coach_authors a ON a.id = p.author_id
        WHERE p.status = 'published' AND p.publish_on <= ?
        ORDER BY p.pinned DESC, p.publish_on DESC, p.id DESC LIMIT 100`).bind(today).all();
    const st = await storedSite(env);
    const topics = (st['coach-topics'] && st['coach-topics'].data.topics) || COACH_TOPICS;
    return json({ posts: results.map((r) => ({ ...r, pinned: !!r.pinned, groups: r.groups ? r.groups.split(',') : [] })), topics }, 200, { 'cache-control': 'public, max-age=60' });
  }
  if (path === '/site') return json(await mergedSite(env), 200, { 'cache-control': 'public, max-age=60' });
  return fail(404, 'Not found');
}

async function storedSite(env) {
  const { results } = await env.DB.prepare(`SELECT key, json, updated_at, updated_by FROM site_data`).all();
  const out = {};
  for (const r of results) { try { out[r.key] = { data: JSON.parse(r.json), updated_at: r.updated_at, updated_by: r.updated_by }; } catch {} }
  return out;
}
async function mergedSite(env) {
  const d = defaults(), st = await storedSite(env);
  for (const k of Object.keys(d)) if (st[k]) d[k] = st[k].data;
  return d;
}
const URL_OK = /^(https?:\/\/|mailto:|\/)[^\s]*$/;
function parseSite(key, b) {
  if (key === 'fees') {
    const rows = FEE_GROUPS.map((g) => {
      const r = (Array.isArray(b.rows) ? b.rows : []).find((x) => x && x.group === g) || {};
      const n = (v) => { const x = Number(v); return Number.isInteger(x) && x >= 0 && x <= 5000 ? x : NaN; };
      return { group: g, scy: n(r.scy), spring: n(r.spring), summer: n(r.summer) };
    });
    if (rows.some((r) => [r.scy, r.spring, r.summer].some(Number.isNaN))) return { error: 'Every fee must be a whole dollar amount.' };
    const pdf = clean(b.pdf_url, 300);
    if (pdf && !URL_OK.test(pdf)) return { error: 'The fee schedule link must start with https:// or /.' };
    return { data: { rows, note: clean(b.note, 300), pdf_url: pdf } };
  }
  if (key === 'coach-topics') {
    const t = [...new Set((Array.isArray(b.topics) ? b.topics : []).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 12);
    if (!t.length) return { error: 'Keep at least one topic.' };
    return { data: { topics: t } };
  }
  const m = key.match(/^offering:(.+)$/);
  if (m && OFFERINGS[m[1]]) {
    const url = clean(b.button_url, 300), label = clean(b.button_label, 60);
    if (url && !URL_OK.test(url)) return { error: 'The button link must start with https://, mailto: or /.' };
    if (url && !label) return { error: 'Please give the button a label.' };
    const headline = clean(b.headline, 200);
    if (!headline) return { error: 'Please enter the headline.' };
    return { data: { title: OFFERINGS[m[1]].title, headline, body: String(b.body ?? '').replace(/\r/g, '').trim().slice(0, 800), button_label: url ? label : '', button_url: url } };
  }
  return { error: 'Unknown block.' };
}

function parseThought(b) {
  const month = clean(b.month, 7);
  if (!MONTH.test(month)) return { error: 'Month must look like 2026-11.' };
  const quote = clean(b.quote, 600);
  if (!quote) return { error: 'Please enter the quote.' };
  const emphasis = clean(b.emphasis, 300);
  if (emphasis && !quote.includes(emphasis)) return { error: 'The bold part must match the quote exactly (or leave it empty).' };
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
    .map((t) => clean(t, 24).toLowerCase()).filter(Boolean))].slice(0, 6);
  const art = ART.includes(b.art) ? b.art : '';
  return { month, quote, emphasis, author: clean(b.author, 80), tags: tags.join(','), art };
}

// Returns a Response, or null if the path is not a content path.
export async function handleContentAdmin(env, me, method, path, body, audit) {
  const al = await handleAlumniAdmin(env, me, method, path, body, audit);
  if (al) return al;
  if (method === 'GET' && path === '/content/thoughts') {
    const { results } = await env.DB.prepare(`SELECT month, quote, emphasis, author, tags, art, updated_at, updated_by FROM thoughts ORDER BY month DESC`).all();
    return json({ thoughts: results.map((r) => ({ ...row(r), updated_at: r.updated_at, updated_by: r.updated_by })), art: ART, now: new Date().toISOString().slice(0, 7) });
  }
  if (method === 'POST' && path === '/content/thoughts') {
    const t = parseThought(body);
    if (t.error) return fail(400, t.error);
    const existed = await env.DB.prepare(`SELECT 1 x FROM thoughts WHERE month = ?`).bind(t.month).first();
    await env.DB.prepare(
      `INSERT INTO thoughts (month, quote, emphasis, author, tags, art, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET quote = excluded.quote, emphasis = excluded.emphasis, author = excluded.author,
         tags = excluded.tags, art = excluded.art, updated_at = datetime('now'), updated_by = excluded.updated_by`)
      .bind(t.month, t.quote, t.emphasis, t.author, t.tags, t.art, me.email).run();
    await audit('content', existed ? 'edit thought' : 'add thought', t.month);
    return json({ ok: true, updated: !!existed });
  }
  if (method === 'GET' && path === '/content/site') {
    return json({ defaults: defaults(), stored: await storedSite(env) });
  }
  let sm = path.match(/^\/content\/site\/([^/]+)$/);
  if (sm && (method === 'POST')) {
    const key = decodeURIComponent(sm[1]);
    const r = parseSite(key, body);
    if (r.error) return fail(400, r.error);
    await env.DB.prepare(`INSERT INTO site_data (key, json, updated_by) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = datetime('now'), updated_by = excluded.updated_by`)
      .bind(key, JSON.stringify(r.data), me.email).run();
    await audit('content', 'edit ' + (key === 'fees' ? 'fees' : key === 'coach-topics' ? 'coach topics' : 'program dates'), key);
    return json({ ok: true });
  }
  sm = path.match(/^\/content\/site\/([^/]+)\/reset$/);
  if (sm && method === 'POST') {
    await env.DB.prepare(`DELETE FROM site_data WHERE key = ?`).bind(decodeURIComponent(sm[1])).run();
    await audit('content', 'reset to starting values', decodeURIComponent(sm[1]));
    return json({ ok: true });
  }
  const m = path.match(/^\/content\/thoughts\/(\d{4}-\d{2})\/delete$/);
  if (method === 'POST' && m) {
    await env.DB.prepare(`DELETE FROM thoughts WHERE month = ?`).bind(m[1]).run();
    await audit('content', 'delete thought', m[1]);
    return json({ ok: true });
  }
  return null;
}
