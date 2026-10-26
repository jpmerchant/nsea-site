// NSEA Swim admin console API (/api/admin/*). One login, per-module roles, audit log.
// Sign-in: Cloudflare Access (when ACCESS_TEAM_DOMAIN and ACCESS_AUD are set) or, until then, single-use admin invite links.
import { json, fail, sha, rand, clean, EMAIL, cookieOf, setCookie, readRequest } from './util.mjs';
import { newMemberInvite } from './carpool.mjs';
import { handleContentAdmin } from './content.mjs';
import { eventsData, eventsPublish, configured as eventsConfigured } from './events.mjs';

export const MODULES = ['carpool', 'events', 'content'];
const ROLE_NAMES = ['owner', ...MODULES];

// ---------- Cloudflare Access JWT ----------
let jwksCache = { at: 0, keys: null };
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
export async function accessEmail(req, env, fetchImpl = fetch) {
  const tok = req.headers.get('cf-access-jwt-assertion');
  if (!tok) return null;
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64(parts[1])));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (header.alg !== 'RS256') return null;
    if (!jwksCache.keys || Date.now() - jwksCache.at > 3600_000) {
      const r = await fetchImpl(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
    }
    const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return ok && payload.email ? String(payload.email).toLowerCase() : null;
  } catch { return null; }
}
export const _resetJwksCache = () => { jwksCache = { at: 0, keys: null }; };

const accessOn = (env) => !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
const cookie = (token, maxAge) => setCookie('nsea_admin', token, maxAge);

async function currentAdmin(req, env) {
  let email = null, via = 'link';
  if (accessOn(env)) { email = await accessEmail(req, env); via = 'access'; }
  else {
    const t = cookieOf(req, 'nsea_admin');
    if (t) {
      const s = await env.DB.prepare(`SELECT email FROM admin_sessions WHERE token_hash = ? AND expires_at > datetime('now')`).bind(await sha(t)).first();
      email = s ? s.email : null;
    }
  }
  if (!email) return null;
  const a = await env.DB.prepare(`SELECT email, name, roles FROM admin_users WHERE email = ?`).bind(email).first();
  if (!a) return null;
  return { email: a.email.toLowerCase(), name: a.name, roles: a.roles ? a.roles.split(',') : [], via };
}
const can = (a, module) => a.roles.includes('owner') || a.roles.includes(module);
const isOwner = (a) => a.roles.includes('owner');
async function audit(env, a, module, action, detail) {
  await env.DB.prepare(`INSERT INTO audit_log (admin_email, module, action, detail) VALUES (?, ?, ?, ?)`)
    .bind(a.email, module, action, detail ? clean(detail, 300) : null).run();
}
async function adminInvite(env, email, origin) {
  const token = rand();
  await env.DB.prepare(`INSERT INTO admin_invites (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+14 days'))`).bind(await sha(token), email).run();
  return `${origin}/admin/?k=${token}`;
}
const parseRoles = (r) => ROLE_NAMES.filter((x) => (Array.isArray(r) ? r : []).includes(x));

export async function handleAdmin(req, env, url) {
  const path = url.pathname.replace('/api/admin', '').replace(/\/$/, '') || '/';
  const method = req.method;
  const rq = await readRequest(req, url);
  if (rq.error) return rq.error;
  const body = rq.body;
  try {
    // ----- sign-in (link mode only) -----
    if (method === 'POST' && path === '/session') {
      if (accessOn(env)) return fail(404, 'Not found');
      const token = clean(body.token, 80);
      const h = await sha(token || 'x');
      const inv = token && await env.DB.prepare(
        `SELECT i.email FROM admin_invites i JOIN admin_users u ON u.email = i.email
          WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > datetime('now')`).bind(h).first();
      if (!inv) return fail(401, 'This link has expired or was already used. Ask an owner for a new one.');
      const st = rand();
      await env.DB.batch([
        env.DB.prepare(`UPDATE admin_invites SET used_at = datetime('now') WHERE token_hash = ?`).bind(h),
        env.DB.prepare(`INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).bind(await sha(st), inv.email),
        env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at < datetime('now')`),
      ]);
      return json({ ok: true }, 200, { 'set-cookie': cookie(st, 30 * 86400) });
    }
    if (method === 'POST' && path === '/logout') {
      const t = cookieOf(req, 'nsea_admin');
      if (t) await env.DB.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(await sha(t)).run();
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    }

    const me = await currentAdmin(req, env);
    if (!me) return fail(401, accessOn(env) ? 'Your account is not set up as an admin.' : 'Not signed in');
    await env.DB.prepare(`UPDATE admin_users SET last_seen = datetime('now') WHERE email = ?`).bind(me.email).run();

    if (method === 'GET' && path === '/me') return json({ email: me.email, name: me.name, roles: me.roles, owner: isOwner(me), via: me.via, modules: MODULES.filter((m) => can(me, m)) });

    if (method === 'GET' && path === '/overview') {
      const q = (sql) => env.DB.prepare(sql).first();
      const [pending, members, posts, conns, admins] = await Promise.all([
        q(`SELECT COUNT(*) n FROM members WHERE status = 'pending'`), q(`SELECT COUNT(*) n FROM members WHERE status = 'active'`),
        q(`SELECT COUNT(*) n FROM posts WHERE status = 'open' AND expires_at > datetime('now')`),
        q(`SELECT COUNT(*) n FROM connections WHERE status = 'accepted'`), q(`SELECT COUNT(*) n FROM admin_users`),
      ]);
      const recent = isOwner(me) ? (await env.DB.prepare(`SELECT at, admin_email, module, action, detail FROM audit_log ORDER BY id DESC LIMIT 8`).all()).results : [];
      return json({ carpool: can(me, 'carpool') ? { pending: pending.n, members: members.n, openPosts: posts.n, matches: conns.n } : null, admins: isOwner(me) ? admins.n : null, recent });
    }

    // ----- carpool module -----
    if (path.startsWith('/carpool')) {
      if (!can(me, 'carpool')) return fail(403, 'You do not have access to the Carpool module.');
      if (method === 'GET' && path === '/carpool') {
        const [members, posts, conns] = await Promise.all([
          env.DB.prepare(`SELECT id, email, family_name, phone, swimmers, note, status, created_at, approved_at FROM members ORDER BY status = 'pending' DESC, family_name`).all(),
          env.DB.prepare(`SELECT p.id, p.kind, p.days, p.time_label, p.direction, p.area, p.seats, p.swimmer, p.driver, p.groups, p.status, p.created_at, p.expires_at, m.family_name FROM posts p JOIN members m ON m.id = p.member_id ORDER BY p.created_at DESC LIMIT 200`).all(),
          env.DB.prepare(`SELECT c.id, c.status, c.created_at, c.updated_at, p.kind, p.area, pm.family_name AS poster, rm.family_name AS requester FROM connections c JOIN posts p ON p.id = c.post_id JOIN members pm ON pm.id = p.member_id JOIN members rm ON rm.id = c.requester_id ORDER BY c.updated_at DESC LIMIT 200`).all(),
        ]);
        return json({ members: members.results, posts: posts.results, connections: conns.results });
      }
      let m = path.match(/^\/carpool\/members\/(\d+)\/(approve|link|disable|enable|reject)$/);
      if (method === 'POST' && m) {
        const id = +m[1], act = m[2];
        const t = await env.DB.prepare(`SELECT id, family_name, status FROM members WHERE id = ?`).bind(id).first();
        if (!t) return fail(404, 'Member not found');
        const origin = url.origin;
        if (act === 'approve') {
          if (t.status !== 'pending') return fail(400, 'Not pending.');
          await env.DB.prepare(`UPDATE members SET status = 'active', approved_at = datetime('now') WHERE id = ?`).bind(id).run();
          await audit(env, me, 'carpool', 'approve family', t.family_name);
          return json({ ok: true, link: await newMemberInvite(env, id, origin) });
        }
        if (act === 'link') {
          if (t.status !== 'active') return fail(400, 'Member is not active.');
          await audit(env, me, 'carpool', 'new sign-in link', t.family_name);
          return json({ ok: true, link: await newMemberInvite(env, id, origin) });
        }
        if (act === 'reject') {
          if (t.status !== 'pending') return fail(400, 'Not pending.');
          await env.DB.prepare(`DELETE FROM members WHERE id = ?`).bind(id).run();
        }
        if (act === 'disable') {
          await env.DB.batch([
            env.DB.prepare(`UPDATE members SET status = 'disabled' WHERE id = ?`).bind(id),
            env.DB.prepare(`DELETE FROM sessions WHERE member_id = ?`).bind(id),
            env.DB.prepare(`UPDATE posts SET status = 'closed' WHERE member_id = ?`).bind(id),
          ]);
        }
        if (act === 'enable') await env.DB.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'disabled'`).bind(id).run();
        await audit(env, me, 'carpool', act + ' family', t.family_name);
        return json({ ok: true });
      }
      m = path.match(/^\/carpool\/posts\/(\d+)\/close$/);
      if (method === 'POST' && m) {
        await env.DB.prepare(`UPDATE posts SET status = 'closed' WHERE id = ?`).bind(+m[1]).run();
        await audit(env, me, 'carpool', 'close post', '#' + m[1]);
        return json({ ok: true });
      }
    }

    // ----- events module -----
    if (path.startsWith('/events')) {
      if (!can(me, 'events')) return fail(403, 'You do not have access to the Events module.');
      if (method === 'GET' && path === '/events/status') return json({ configured: eventsConfigured(env) });
      if (method === 'GET' && path === '/events/data') return eventsData(env);
      if (method === 'POST' && path === '/events/publish') return eventsPublish(env, me, body, (m, a, d) => audit(env, me, m, a, d));
    }

    // ----- content module -----
    if (path.startsWith('/content')) {
      if (!can(me, 'content')) return fail(403, 'You do not have access to the Content module.');
      const r = await handleContentAdmin(env, me, method, path, body, (module, action, detail) => audit(env, me, module, action, detail));
      if (r) return r;
    }

    // ----- admins (owner only) -----
    if (path.startsWith('/admins')) {
      if (!isOwner(me)) return fail(403, 'Owners only.');
      if (method === 'GET' && path === '/admins') {
        return json({ admins: (await env.DB.prepare(`SELECT email, name, roles, created_at, last_seen FROM admin_users ORDER BY name`).all()).results, via: me.via });
      }
      if (method === 'POST' && path === '/admins') {
        const email = clean(body.email, 120).toLowerCase(), name = clean(body.name, 60);
        const roles = parseRoles(body.roles);
        if (!EMAIL.test(email) || !name || !roles.length) return fail(400, 'Please give a name, an email and at least one role.');
        const exists = await env.DB.prepare(`SELECT email FROM admin_users WHERE email = ?`).bind(email).first();
        if (exists) return fail(409, 'That person is already an admin. Edit their roles instead.');
        await env.DB.prepare(`INSERT INTO admin_users (email, name, roles) VALUES (?, ?, ?)`).bind(email, name, roles.join(',')).run();
        await audit(env, me, 'admins', 'add admin', `${email} (${roles.join(', ')})`);
        return json({ ok: true, link: me.via === 'link' ? await adminInvite(env, email, url.origin) : null });
      }
      const m = path.match(/^\/admins\/([^/]+)\/(roles|link|remove)$/);
      if (method === 'POST' && m) {
        const email = decodeURIComponent(m[1]).toLowerCase();
        const t = await env.DB.prepare(`SELECT email, roles FROM admin_users WHERE email = ?`).bind(email).first();
        if (!t) return fail(404, 'Admin not found');
        const owners = (await env.DB.prepare(`SELECT COUNT(*) n FROM admin_users WHERE ','||roles||',' LIKE '%,owner,%'`).first()).n;
        const wasOwner = t.roles.split(',').includes('owner');
        if (m[2] === 'link') {
          if (me.via !== 'link') return fail(400, 'Sign-in links are not used when Cloudflare Access is on.');
          await audit(env, me, 'admins', 'new admin link', email);
          return json({ ok: true, link: await adminInvite(env, email, url.origin) });
        }
        if (m[2] === 'roles') {
          const roles = parseRoles(body.roles);
          if (!roles.length) return fail(400, 'Choose at least one role.');
          if (wasOwner && !roles.includes('owner') && owners <= 1) return fail(400, 'There must be at least one owner.');
          await env.DB.prepare(`UPDATE admin_users SET roles = ? WHERE email = ?`).bind(roles.join(','), email).run();
          await audit(env, me, 'admins', 'change roles', `${email} → ${roles.join(', ')}`);
          return json({ ok: true });
        }
        if (email === me.email) return fail(400, "You can't remove yourself.");
        if (wasOwner && owners <= 1) return fail(400, 'There must be at least one owner.');
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM admin_users WHERE email = ?`).bind(email),
          env.DB.prepare(`DELETE FROM admin_sessions WHERE email = ?`).bind(email),
        ]);
        await audit(env, me, 'admins', 'remove admin', email);
        return json({ ok: true });
      }
    }

    if (method === 'GET' && path === '/audit') {
      if (!isOwner(me)) return fail(403, 'Owners only.');
      return json((await env.DB.prepare(`SELECT at, admin_email, module, action, detail FROM audit_log ORDER BY id DESC LIMIT 200`).all()).results);
    }

    return fail(404, 'Not found');
  } catch (e) {
    console.error('admin error', e && e.message);
    return fail(500, 'Something went wrong. Please try again.');
  }
}
