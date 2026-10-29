// Coach's Corner admin API (called from admin.mjs). Roles: owner/content = editors (everything); coach = own posts only (draft or send for review).
import { json, fail, clean } from './util.mjs';
import { COACH_TOPICS } from '../src/data/site-data-defaults.mjs';

export const GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers', 'Surge', 'Senior'];
const STATUS = ['draft', 'review', 'published'];
const URL_OK = /^(https?:\/\/|\/)[^\s]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'post';

export const isEditor = (me) => me.roles.includes('owner') || me.roles.includes('content');

async function topicsOf(env) {
  const r = await env.DB.prepare(`SELECT json FROM site_data WHERE key = 'coach-topics'`).first();
  try { return JSON.parse(r.json).topics; } catch { return COACH_TOPICS; }
}
const myAuthor = (env, me) => env.DB.prepare(`SELECT id, name FROM coach_authors WHERE email = ? AND active = 1`).bind(me.email).first();

export async function handleCoachAdmin(env, me, method, path, body, audit) {
  const editor = isEditor(me);
  const mine = await myAuthor(env, me);

  if (method === 'GET' && path === '/coach') {
    const posts = (await env.DB.prepare(
      `SELECT p.id, p.slug, p.title, p.summary, p.body, p.topic, p.groups, p.pinned, p.status, p.publish_on, p.related_label, p.related_url, p.author_id,
              p.updated_at, p.updated_by, a.name AS author
         FROM coach_posts p JOIN coach_authors a ON a.id = p.author_id ${editor ? '' : 'WHERE p.author_id = ?'} ORDER BY p.status = 'review' DESC, p.publish_on DESC, p.id DESC LIMIT 300`)
      .bind(...(editor ? [] : [mine ? mine.id : -1])).all()).results;
    const authors = editor
      ? (await env.DB.prepare(`SELECT id, name, role, bio, photo_url, email, active FROM coach_authors ORDER BY active DESC, name`).all()).results
      : (mine ? [{ id: mine.id, name: mine.name }] : []);
    return json({ posts: posts.map((p) => ({ ...p, pinned: !!p.pinned, groups: p.groups ? p.groups.split(',') : [] })), authors, topics: await topicsOf(env), groups: GROUPS, editor, mineId: mine ? mine.id : null, today: new Date().toISOString().slice(0, 10) });
  }

  if (method === 'POST' && path === '/coach/posts') {
    const id = body.id ? Number(body.id) : null;
    const existing = id ? await env.DB.prepare(`SELECT id, author_id, status, slug FROM coach_posts WHERE id = ?`).bind(id).first() : null;
    if (id && !existing) return fail(404, 'That post no longer exists.');
    if (!editor) {
      if (!mine) return fail(403, 'You are not on the author list yet. Ask an editor to add you.');
      if (existing && (existing.author_id !== mine.id || existing.status === 'published')) return fail(403, 'You can edit your own drafts and posts in review. Ask an editor to change a published post.');
    }
    const title = clean(body.title, 120), text = String(body.body ?? '').replace(/\r/g, '').trim();
    if (!title) return fail(400, 'Please enter a title.');
    if (!text) return fail(400, 'Please write the post.');
    if (text.length > 12000) return fail(400, 'The post is too long (12,000 characters maximum).');
    const topics = await topicsOf(env);
    const topic = topics.includes(body.topic) ? body.topic : '';
    const groups = (Array.isArray(body.groups) ? body.groups : []).filter((g) => GROUPS.includes(g));
    const publish_on = DATE.test(body.publish_on || '') ? body.publish_on : new Date().toISOString().slice(0, 10);
    const url = clean(body.related_url, 300), label = clean(body.related_label, 60);
    if (url && !URL_OK.test(url)) return fail(400, 'The related link must start with https:// or /.');
    if (url && !label) return fail(400, 'Please label the related link button.');
    let status = STATUS.includes(body.status) ? body.status : 'draft';
    if (!editor && status === 'published') status = 'review';
    let authorId = mine ? mine.id : null;
    if (editor) {
      authorId = Number(body.author_id) || (existing ? existing.author_id : null);
      const a = authorId && await env.DB.prepare(`SELECT id FROM coach_authors WHERE id = ?`).bind(authorId).first();
      if (!a) return fail(400, 'Please choose an author.');
    } else if (existing) authorId = existing.author_id;
    const pinned = editor && body.pinned ? 1 : 0;
    const f = [title, authorId, clean(body.summary, 300), text, topic, groups.join(','), pinned, status, publish_on, label, url, me.email];
    if (existing) {
      await env.DB.prepare(`UPDATE coach_posts SET title=?, author_id=?, summary=?, body=?, topic=?, groups=?, pinned=?, status=?, publish_on=?, related_label=?, related_url=?, updated_by=?, updated_at=datetime('now') WHERE id=?`).bind(...f, existing.id).run();
      await audit('coach', status === 'published' ? 'update post' : 'edit post (' + status + ')', title);
      return json({ ok: true, id: existing.id, status });
    }
    let slug = slugify(title), n = 1;
    while (await env.DB.prepare(`SELECT 1 x FROM coach_posts WHERE slug = ?`).bind(slug).first()) slug = slugify(title).slice(0, 44) + '-' + (++n);
    const r = await env.DB.prepare(`INSERT INTO coach_posts (title, author_id, summary, body, topic, groups, pinned, status, publish_on, related_label, related_url, created_by, updated_by, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...f, me.email, slug).run();
    await audit('coach', 'new post (' + status + ')', title);
    return json({ ok: true, id: r.meta.last_row_id, status });
  }

  let m = path.match(/^\/coach\/posts\/(\d+)\/(delete|status)$/);
  if (method === 'POST' && m) {
    const p = await env.DB.prepare(`SELECT id, title, author_id, status FROM coach_posts WHERE id = ?`).bind(m[1]).first();
    if (!p) return fail(404, 'That post no longer exists.');
    if (!editor && (!mine || p.author_id !== mine.id || p.status === 'published')) return fail(403, 'You can only change your own drafts and posts in review.');
    if (m[2] === 'delete') {
      await env.DB.prepare(`DELETE FROM coach_posts WHERE id = ?`).bind(p.id).run();
      await audit('coach', 'delete post', p.title);
      return json({ ok: true });
    }
    let status = STATUS.includes(body.status) ? body.status : null;
    if (!status) return fail(400, 'Bad status.');
    if (!editor && status === 'published') return fail(403, 'An editor publishes posts.');
    await env.DB.prepare(`UPDATE coach_posts SET status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, me.email, p.id).run();
    await audit('coach', status === 'published' ? 'publish post' : status === 'review' ? 'send post for review' : 'move post to draft', p.title);
    return json({ ok: true });
  }

  if (path.startsWith('/coach/authors')) {
    if (!editor) return fail(403, 'Editors only.');
    if (method === 'POST' && path === '/coach/authors') {
      const name = clean(body.name, 60);
      if (!name) return fail(400, 'Please enter a name.');
      const email = clean(body.email, 120).toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'That email does not look right.');
      const photo = clean(body.photo_url, 300);
      if (photo && !URL_OK.test(photo)) return fail(400, 'The photo link must start with https:// or /.');
      const vals = [name, clean(body.role, 60), clean(body.bio, 500), photo, email, body.active === false ? 0 : 1];
      try {
        if (body.id) {
          await env.DB.prepare(`UPDATE coach_authors SET name=?, role=?, bio=?, photo_url=?, email=?, active=? WHERE id=?`).bind(...vals, Number(body.id)).run();
          await audit('coach', 'edit author', name);
        } else {
          await env.DB.prepare(`INSERT INTO coach_authors (name, role, bio, photo_url, email, active) VALUES (?, ?, ?, ?, ?, ?)`).bind(...vals).run();
          await audit('coach', 'add author', name);
        }
      } catch (e) { if (/UNIQUE/i.test(String(e))) return fail(400, 'Another author already uses that email.'); throw e; }
      return json({ ok: true });
    }
  }
  return null;
}
