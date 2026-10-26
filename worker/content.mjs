// Editable site content stored in D1. Public reads: /api/content/*. Admin writes go through handleContentAdmin (called from admin.mjs).
import { json, fail, clean } from './util.mjs';

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
  return fail(404, 'Not found');
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
  const m = path.match(/^\/content\/thoughts\/(\d{4}-\d{2})\/delete$/);
  if (method === 'POST' && m) {
    await env.DB.prepare(`DELETE FROM thoughts WHERE month = ?`).bind(m[1]).run();
    await audit('content', 'delete thought', m[1]);
    return json({ ok: true });
  }
  return null;
}
