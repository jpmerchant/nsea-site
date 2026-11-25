// Family Thanks. Families send a note of thanks from the public form (/embeds/share-thanks.html → POST /api/thanks/submit).
// Each note waits for approval in the admin console (Content > Family Thanks); only approved notes reach the public
// Thanks Wall (/api/content/thanks → /embeds/thanks-wall.html). When a note arrives, a push notification goes to the
// ntfy topic stored in the settings (the console shows how to subscribe on a phone). The sender's email is never public.
import { json, fail, clean, EMAIL, sha, rand, readRequest } from './util.mjs';

export const MAX_NOTE = 700, MAX_SIGNED = 60;
const MAX_PENDING = 300, MAX_PER_SENDER_DAY = 5;
const KEY = 'thanks-settings';
const TOPIC_OK = /^[A-Za-z0-9_-]{12,64}$/;
const ACTIONS = ['approve', 'reject', 'pending', 'feature', 'unfeature', 'delete'];

// Keeps paragraphs (single blank lines), drops other extra whitespace and control characters.
export function cleanNote(v, max = MAX_NOTE) {
  return String(v ?? '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trim();
}
export const newTopic = () => 'nsea-thanks-' + rand(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 14).toLowerCase();

export async function thanksSettings(env) {
  const r = await env.DB.prepare(`SELECT json FROM site_data WHERE key = ?`).bind(KEY).first();
  let s = {};
  try { s = r ? JSON.parse(r.json) : {}; } catch { s = {}; }
  return { open: s.open !== false, ntfy_topic: TOPIC_OK.test(s.ntfy_topic || '') ? s.ntfy_topic : '', notify: s.notify !== false };
}
async function saveSettings(env, s, by) {
  await env.DB.prepare(`INSERT INTO site_data (key, json, updated_by) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = datetime('now'), updated_by = excluded.updated_by`)
    .bind(KEY, JSON.stringify(s), by).run();
}

// Push notification through ntfy (https://ntfy.sh). Only the signature goes in the alert, not the note itself.
export async function notifyNew(env, settings, signed, origin, fetchImpl = fetch) {
  if (!settings.notify || !settings.ntfy_topic) return false;
  try {
    const r = await fetchImpl('https://ntfy.sh/' + settings.ntfy_topic, {
      method: 'POST',
      headers: { Title: 'New family thank-you note', Tags: 'fallen_leaf', Click: origin + '/admin/', Priority: 'default' },
      body: `From ${signed}. It is waiting for your approval (Content > Family Thanks).`,
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    });
    return r.ok;
  } catch { return false; }
}

// ---------- public: /api/thanks/* ----------
export async function handleThanksPublic(req, env, url, fetchImpl = fetch) {
  const path = url.pathname.replace('/api/thanks', '').replace(/\/$/, '') || '/';
  const rq = await readRequest(req, url);
  if (rq.error) return rq.error;
  try {
    if (req.method === 'GET' && path === '/status') return json({ open: (await thanksSettings(env)).open, maxNote: MAX_NOTE });
    if (req.method === 'POST' && path === '/submit') return await submit(req, env, rq.body, url, fetchImpl);
  } catch (e) {
    console.error('thanks error', e && e.message);
    return fail(500, 'Something went wrong on our side. Please try again, or email team@nseaswim.com.');
  }
  return fail(404, 'Not found');
}

async function submit(req, env, b, url, fetchImpl) {
  if (clean(b.website, 50)) return json({ ok: true }); // honeypot: bots fill every field
  const settings = await thanksSettings(env);
  if (!settings.open) return fail(403, 'We are not collecting notes right now. Thank you for thinking of us!');
  const body = cleanNote(b.note), signed = clean(b.signed, MAX_SIGNED), email = clean(b.email, 120).toLowerCase();
  if (body.length < 3) return fail(400, 'Please write your note of thanks.');
  if (!signed) return fail(400, 'Please tell us how to sign your note (for example, “The Rivera family”).');
  if (email && !EMAIL.test(email)) return fail(400, 'That email address does not look right. You can also leave it blank.');
  const day = new Date().toISOString().slice(0, 10);
  const sender = await sha((req.headers.get('cf-connecting-ip') || 'unknown') + '|' + day + '|thanks');
  const mine = await env.DB.prepare(`SELECT COUNT(*) n FROM family_thanks WHERE sender_hash = ? AND created_at > datetime('now', '-1 day')`).bind(sender).first();
  if (mine.n >= MAX_PER_SENDER_DAY) return fail(429, 'Thank you! We already have several notes from you today. Please send more tomorrow.');
  const waiting = await env.DB.prepare(`SELECT COUNT(*) n FROM family_thanks WHERE status = 'pending'`).first();
  if (waiting.n >= MAX_PENDING) return fail(429, 'We have a lot of notes waiting to be read. Please try again in a day or two.');
  await env.DB.prepare(`INSERT INTO family_thanks (body, original, signed, email, sender_hash) VALUES (?, ?, ?, ?, ?)`)
    .bind(body, body, signed, email || null, sender).run();
  await notifyNew(env, settings, signed, url.origin, fetchImpl);
  return json({ ok: true });
}

// ---------- public read: /api/content/thanks ----------
export async function publicThanks(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, body, signed, featured, substr(coalesce(decided_at, created_at), 1, 10) AS posted_on
       FROM family_thanks WHERE status = 'approved' ORDER BY featured DESC, coalesce(decided_at, created_at) DESC, id DESC LIMIT 300`).all();
  return json({ notes: results.map((r) => ({ ...r, featured: !!r.featured })) }, 200, { 'cache-control': 'public, max-age=30' });
}

// ---------- admin: /api/admin/content/thanks* (Content role) ----------
// Returns a Response, or null if the path is not a Family Thanks path.
export async function handleThanksAdmin(env, me, method, path, body, audit, origin, fetchImpl = fetch) {
  if (method === 'GET' && path === '/content/thanks') {
    let s = await thanksSettings(env);
    if (!s.ntfy_topic) { s = { ...s, ntfy_topic: newTopic() }; await saveSettings(env, s, me.email); }
    const { results } = await env.DB.prepare(
      `SELECT id, body, original, signed, email, status, featured, created_at, decided_at, decided_by FROM family_thanks
        ORDER BY status = 'pending' DESC, created_at DESC, id DESC LIMIT 500`).all();
    return json({ notes: results.map((r) => ({ ...r, featured: !!r.featured, edited: r.body !== r.original })), settings: s, maxNote: MAX_NOTE });
  }
  if (method === 'POST' && path === '/content/thanks/settings') {
    const cur = await thanksSettings(env);
    const s = { open: body.open === undefined ? cur.open : !!body.open, notify: body.notify === undefined ? cur.notify : !!body.notify,
      ntfy_topic: body.newTopic || !cur.ntfy_topic ? newTopic() : cur.ntfy_topic };
    await saveSettings(env, s, me.email);
    await audit('content', 'family thanks settings', `form ${s.open ? 'open' : 'closed'}, alerts ${s.notify ? 'on' : 'off'}${body.newTopic ? ', new alert topic' : ''}`);
    return json({ ok: true, settings: s });
  }
  if (method === 'POST' && path === '/content/thanks/test') {
    const s = await thanksSettings(env);
    if (!s.ntfy_topic) return fail(400, 'There is no alert topic yet. Reload this page.');
    const ok = await notifyNew(env, { ...s, notify: true }, 'a test (nothing new is waiting)', origin, fetchImpl);
    return ok ? json({ ok: true }) : fail(502, 'The alert service did not answer. Try again in a minute.');
  }
  let m = path.match(/^\/content\/thanks\/(\d+)\/edit$/);
  if (method === 'POST' && m) {
    const t = await env.DB.prepare(`SELECT id, signed FROM family_thanks WHERE id = ?`).bind(Number(m[1])).first();
    if (!t) return fail(404, 'That note no longer exists.');
    const note = cleanNote(body.note), signed = clean(body.signed, MAX_SIGNED);
    if (note.length < 3) return fail(400, 'The note cannot be empty.');
    if (!signed) return fail(400, 'Please keep a signature.');
    await env.DB.prepare(`UPDATE family_thanks SET body = ?, signed = ? WHERE id = ?`).bind(note, signed, t.id).run();
    await audit('content', 'edit family thanks', `#${t.id} (${signed})`);
    return json({ ok: true });
  }
  m = path.match(/^\/content\/thanks\/(\d+)\/([a-z]+)$/);
  if (method === 'POST' && m && ACTIONS.includes(m[2])) {
    const t = await env.DB.prepare(`SELECT id, signed FROM family_thanks WHERE id = ?`).bind(Number(m[1])).first();
    if (!t) return fail(404, 'That note no longer exists.');
    const act = m[2];
    if (act === 'delete') await env.DB.prepare(`DELETE FROM family_thanks WHERE id = ?`).bind(t.id).run();
    else if (act === 'feature' || act === 'unfeature') await env.DB.prepare(`UPDATE family_thanks SET featured = ? WHERE id = ?`).bind(act === 'feature' ? 1 : 0, t.id).run();
    else {
      const status = act === 'approve' ? 'approved' : act === 'reject' ? 'rejected' : 'pending';
      await env.DB.prepare(`UPDATE family_thanks SET status = ?, decided_at = CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END, decided_by = CASE WHEN ? = 'pending' THEN NULL ELSE ? END WHERE id = ?`)
        .bind(status, status, status, me.email, t.id).run();
    }
    await audit('content', act + ' family thanks', `#${t.id} (${t.signed})`);
    return json({ ok: true });
  }
  return null;
}

export async function pendingThanks(env) {
  return (await env.DB.prepare(`SELECT COUNT(*) n FROM family_thanks WHERE status = 'pending'`).first()).n;
}
