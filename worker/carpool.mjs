// NSEA Swim carpool board API (family-facing). Admin tools live in admin.mjs.
// Sign-in is by single-use invite link created by an admin; a link is exchanged for a 90-day session cookie.
import { json, fail, sha, rand, clean, EMAIL, cookieOf, setCookie, readRequest } from './util.mjs';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers', 'Surge', 'Senior'];
const sessionCookie = (token, maxAge) => setCookie('nsea_cp', token, maxAge);

async function authed(req, env) {
  const t = cookieOf(req, 'nsea_cp');
  if (!t) return null;
  return await env.DB.prepare(
    `SELECT m.id, m.email, m.family_name, m.phone
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND m.status = 'active'`
  ).bind(await sha(t)).first();
}

export async function newMemberInvite(env, memberId, origin) {
  const token = rand();
  await env.DB.prepare(
    `INSERT INTO invites (token_hash, member_id, expires_at) VALUES (?, ?, datetime('now', '+14 days'))`
  ).bind(await sha(token), memberId).run();
  return `${origin}/families/carpool/?k=${token}`;
}

export async function handleCarpool(req, env, url) {
  {
    const path = url.pathname.replace('/api/carpool', '').replace(/\/$/, '') || '/';
    const method = req.method;

    const rq = await readRequest(req, url);
    if (rq.error) return rq.error;
    const body = rq.body;

    try {
      // ---------- public ----------
      if (method === 'POST' && path === '/request-access') {
        if (clean(body.website, 50)) return json({ ok: true }); // honeypot
        const email = clean(body.email, 120).toLowerCase();
        const family = clean(body.family, 60);
        const swimmers = clean(body.swimmers, 160);
        if (!EMAIL.test(email) || !family || !swimmers) return fail(400, 'Please fill in your family name, email and your swimmers.');
        const pending = await env.DB.prepare(`SELECT COUNT(*) n FROM members WHERE status = 'pending'`).first();
        if (pending.n >= 30) return fail(429, 'Too many requests are waiting. Please email team@nseaswim.com.');
        await env.DB.prepare(
          `INSERT OR IGNORE INTO members (email, family_name, phone, swimmers, note) VALUES (?, ?, ?, ?, ?)`
        ).bind(email, family, clean(body.phone, 30) || null, swimmers, clean(body.note, 300) || null).run();
        return json({ ok: true }); // same answer whether or not the email already exists
      }

      if (method === 'POST' && path === '/session') {
        const token = clean(body.token, 80);
        if (!token) return fail(401, 'Invalid or expired link.');
        const h = await sha(token);
        const inv = await env.DB.prepare(
          `SELECT i.member_id FROM invites i JOIN members m ON m.id = i.member_id
            WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > datetime('now') AND m.status = 'active'`
        ).bind(h).first();
        if (!inv) return fail(401, 'This link has expired or was already used. Ask an admin for a new one.');
        const st = rand();
        await env.DB.batch([
          env.DB.prepare(`UPDATE invites SET used_at = datetime('now') WHERE token_hash = ?`).bind(h),
          env.DB.prepare(`INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, datetime('now', '+90 days'))`)
            .bind(await sha(st), inv.member_id),
          env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
          env.DB.prepare(`DELETE FROM invites WHERE expires_at < datetime('now', '-30 days')`),
        ]);
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie(st, 90 * 86400) });
      }

      if (method === 'POST' && path === '/logout') {
        const t = cookieOf(req, 'nsea_cp');
        if (t) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha(t)).run();
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
      }

      // ---------- members ----------
      const me = await authed(req, env);
      if (!me) return fail(401, 'Not signed in');

      if (method === 'GET' && path === '/me') {
        return json({ id: me.id, family: me.family_name, email: me.email, phone: me.phone });
      }

      if (method === 'POST' && path === '/me') {
        await env.DB.prepare(`UPDATE members SET phone = ? WHERE id = ?`).bind(clean(body.phone, 30) || null, me.id).run();
        return json({ ok: true });
      }

      if (method === 'GET' && path === '/posts') {
        const { results } = await env.DB.prepare(
          `SELECT p.id, p.kind, p.days, p.time_label, p.direction, p.area, p.seats, p.cost_note, p.note, p.swimmer, p.driver, p.groups, p.created_at,
                  p.member_id, m.family_name,
                  (SELECT status FROM connections c WHERE c.post_id = p.id AND c.requester_id = ?1) AS my_connection,
                  (SELECT COUNT(*) FROM connections c WHERE c.post_id = p.id AND c.status = 'requested') AS open_requests
             FROM posts p JOIN members m ON m.id = p.member_id
            WHERE p.status = 'open' AND p.expires_at > datetime('now') AND m.status = 'active'
            ORDER BY p.created_at DESC LIMIT 200`
        ).bind(me.id).all();
        return json(results.map((p) => ({
          id: p.id, kind: p.kind, days: p.days.split(','), time: p.time_label, direction: p.direction, area: p.area,
          seats: p.seats, cost: p.cost_note, note: p.note, swimmer: p.swimmer, driver: p.driver, groups: p.groups ? p.groups.split(',') : [], family: p.family_name, created: p.created_at,
          mine: p.member_id === me.id, myConnection: p.my_connection, openRequests: p.member_id === me.id ? p.open_requests : undefined,
        })));
      }

      if (method === 'POST' && path === '/posts') {
        const kind = body.kind === 'offer' ? 'offer' : body.kind === 'need' ? 'need' : null;
        const direction = ['to', 'from', 'both'].includes(body.direction) ? body.direction : null;
        const days = (Array.isArray(body.days) ? body.days : []).filter((d) => DAYS.includes(d));
        const time = clean(body.time, 60), area = clean(body.area, 60);
        const driver = kind === 'offer' ? (['parent', 'swimmer'].includes(body.driver) ? body.driver : null) : null;
        if (kind === 'offer' && !driver) return fail(400, 'Please say whether a parent or a swimmer would be driving.');
        if (driver === 'swimmer' && body.guardianOk !== true) return fail(400, 'A swimmer driver needs a parent or guardian who knows about and agrees to the arrangement. Please check the box.');
        const groups = GROUPS.filter((g) => (Array.isArray(body.groups) ? body.groups : []).includes(g));
        const seats = Math.min(Math.max(parseInt(body.seats, 10) || 1, 1), 8);
        if (!kind || !direction || !days.length || !time || !area) return fail(400, 'Please choose offer or need, days, a time, direction and a general area.');
        const mine = await env.DB.prepare(`SELECT COUNT(*) n FROM posts WHERE member_id = ? AND status = 'open'`).bind(me.id).first();
        if (mine.n >= 12) return fail(400, 'You have 12 open posts. Close one before adding another.');
        await env.DB.prepare(
          `INSERT INTO posts (member_id, kind, days, time_label, direction, area, seats, cost_note, note, swimmer, driver, groups, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+60 days'))`
        ).bind(me.id, kind, DAYS.filter((d) => days.includes(d)).join(','), time, direction, area, seats,
          clean(body.cost, 80) || null, clean(body.note, 200) || null, clean(body.swimmer, 60) || null, driver, groups.join(',') || null).run();
        return json({ ok: true });
      }

      let m = path.match(/^\/posts\/(\d+)\/(close|connect)$/);
      if (method === 'POST' && m) {
        const id = +m[1];
        const post = await env.DB.prepare(`SELECT id, member_id, status, expires_at > datetime('now') AS live FROM posts WHERE id = ?`).bind(id).first();
        if (!post) return fail(404, 'Post not found');
        if (m[2] === 'close') {
          if (post.member_id !== me.id) return fail(403, 'Not your post');
          await env.DB.prepare(`UPDATE posts SET status = 'closed' WHERE id = ?`).bind(id).run();
          return json({ ok: true });
        }
        if (post.member_id === me.id) return fail(400, 'This is your own post.');
        if (post.status !== 'open' || !post.live) return fail(400, 'This post is closed.');
        const prior = await env.DB.prepare(`SELECT id, status FROM connections WHERE post_id = ? AND requester_id = ?`).bind(id, me.id).first();
        if (prior && prior.status !== 'cancelled') return fail(409, 'You already sent a request for this post.');
        const msg = clean(body.message, 200) || null;
        if (prior) await env.DB.prepare(`UPDATE connections SET status = 'requested', message = ?, updated_at = datetime('now') WHERE id = ?`).bind(msg, prior.id).run();
        else await env.DB.prepare(`INSERT INTO connections (post_id, requester_id, message) VALUES (?, ?, ?)`).bind(id, me.id, msg).run();
        return json({ ok: true });
      }

      if (method === 'GET' && path === '/connections') {
        const { results } = await env.DB.prepare(
          `SELECT c.id, c.status, c.message, c.created_at, c.requester_id,
                  p.id AS post_id, p.kind, p.days, p.time_label, p.direction, p.area, p.swimmer, p.driver, p.groups, p.member_id AS poster_id,
                  pm.family_name AS poster_family, pm.email AS poster_email, pm.phone AS poster_phone,
                  rm.family_name AS requester_family, rm.email AS requester_email, rm.phone AS requester_phone
             FROM connections c
             JOIN posts p ON p.id = c.post_id
             JOIN members pm ON pm.id = p.member_id
             JOIN members rm ON rm.id = c.requester_id
            WHERE (c.requester_id = ?1 OR p.member_id = ?1) AND c.status IN ('requested','accepted')
            ORDER BY c.updated_at DESC LIMIT 100`
        ).bind(me.id).all();
        return json(results.map((c) => {
          const asPoster = c.poster_id === me.id;
          const other = asPoster
            ? { family: c.requester_family, email: c.requester_email, phone: c.requester_phone }
            : { family: c.poster_family, email: c.poster_email, phone: c.poster_phone };
          if (c.status !== 'accepted') { delete other.email; delete other.phone; }
          return {
            id: c.id, status: c.status, role: asPoster ? 'poster' : 'requester', message: asPoster ? c.message : undefined,
            post: { id: c.post_id, kind: c.kind, days: c.days.split(','), time: c.time_label, direction: c.direction, area: c.area, swimmer: c.swimmer, driver: c.driver, groups: c.groups ? c.groups.split(',') : [] },
            other, created: c.created_at,
          };
        }));
      }

      m = path.match(/^\/connections\/(\d+)\/(accept|decline|cancel)$/);
      if (method === 'POST' && m) {
        const c = await env.DB.prepare(
          `SELECT c.id, c.status, c.requester_id, p.member_id AS poster_id FROM connections c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`
        ).bind(+m[1]).first();
        if (!c) return fail(404, 'Not found');
        const isPoster = c.poster_id === me.id, isRequester = c.requester_id === me.id;
        let next = null;
        if (m[2] === 'accept' && isPoster && c.status === 'requested') next = 'accepted';
        if (m[2] === 'decline' && isPoster && c.status === 'requested') next = 'declined';
        if (m[2] === 'cancel' && (isPoster || isRequester) && ['requested', 'accepted'].includes(c.status)) next = 'cancelled';
        if (!next) return fail(400, 'That action is not available.');
        await env.DB.prepare(`UPDATE connections SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(next, c.id).run();
        return json({ ok: true });
      }

      return fail(404, 'Not found');
    } catch (e) {
      console.error('carpool error', e && e.message);
      return fail(500, 'Something went wrong. Please try again.');
    }
  }
}
