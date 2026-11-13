// Meet Day (/api/admin/meetday/*): the coaches' meet-day app. Swimmer names and times, so coach-only
// (role "meetday", "coach" or owner) and never in the repo or static assets.
//
// Sync model: each meet has one package (heat sheets, entries, reference data) plus an append-only log of
// small operations (a result, a note, a re-seeded heat, "official results loaded"). Phones keep both in
// IndexedDB, queue their own ops while offline and push/pull when signal comes back. Ops carry a
// client-made id, so a retried push never duplicates anything.
import { json, fail, clean } from './util.mjs';

const ID = /^[a-z0-9][a-z0-9-]{2,60}$/;
const OP_TYPES = new Set(['result', 'note', 'entries', 'official', 'scratch', 'source', 'undo']);
const MAX_PKG = 1_500_000;
const MAX_OP = 200_000;

export const canMeetday = (me) => me.roles.includes('owner') || me.roles.includes('meetday') || me.roles.includes('coach');

export async function handleMeetdayAdmin(env, me, method, path, body, audit, url, fetchImpl = fetch) {
  const owner = me.roles.includes('owner');

  if (method === 'GET' && path === '/meetday/meets') {
    const r = await env.DB.prepare(`SELECT id, name, start_date, end_date, updated_at, updated_by,
        (SELECT COUNT(*) FROM meetday_op o WHERE o.meet_id = m.id) AS ops FROM meetday_meet m ORDER BY start_date DESC`).all();
    return json({ meets: r.results, me: { email: me.email, name: me.name, owner } });
  }

  const g = path.match(/^\/meetday\/meet\/([a-z0-9-]+)$/);
  if (method === 'GET' && g) {
    const m = await env.DB.prepare(`SELECT pkg, updated_at FROM meetday_meet WHERE id = ?`).bind(g[1]).first();
    if (!m) return fail(404, 'Meet not found');
    return new Response(`{"updated_at":${JSON.stringify(m.updated_at)},"pkg":${m.pkg}}`, { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
  }

  if (method === 'POST' && path === '/meetday/meet') {
    const pkg = body.pkg;
    if (!pkg || pkg.format !== 'nsea-meetday/1' || !ID.test(String(pkg.id || ''))) return fail(400, 'That is not a Meet Day package.');
    const text = JSON.stringify(pkg);
    if (text.length > MAX_PKG) return fail(400, 'That meet package is too large.');
    const ex = await env.DB.prepare(`SELECT id FROM meetday_meet WHERE id = ?`).bind(pkg.id).first();
    if (ex && !owner && !body.replace) return fail(409, 'This meet is already loaded.');
    await env.DB.prepare(`INSERT INTO meetday_meet (id, name, start_date, end_date, pkg, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, pkg = excluded.pkg, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(pkg.id, clean(pkg.name, 120), clean(pkg.start, 10), clean(pkg.end, 10), text, me.email).run();
    await audit('meetday', ex ? 'replace meet' : 'load meet', `${pkg.id} (${Math.round(text.length / 1024)} KB)`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/meetday/ops') {
    const meet = String(body.meet || '');
    if (!ID.test(meet)) return fail(400, 'Bad meet');
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 200) : [];
    const exists = await env.DB.prepare(`SELECT id FROM meetday_meet WHERE id = ?`).bind(meet).first();
    if (!exists) return fail(404, 'Meet not found');
    const stmts = [];
    for (const o of ops) {
      if (!o || !/^[A-Za-z0-9_-]{8,40}$/.test(String(o.id || '')) || !OP_TYPES.has(o.type)) continue;
      const data = JSON.stringify(o.data ?? null);
      if (data.length > MAX_OP) continue;
      const at = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(o.at || '')) ? o.at : new Date().toISOString();
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO meetday_op (meet_id, op_id, at, by_email, by_name, type, data) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(meet, o.id, at, me.email, clean(me.name, 60), o.type, data));
    }
    if (stmts.length) await env.DB.batch(stmts);
    const big = ops.filter((o) => o && (o.type === 'entries' || o.type === 'official')).length;
    if (big) await audit('meetday', 'update meet', `${meet}: ${big} heat sheet / official change(s)`);
    return json({ ok: true, accepted: stmts.length });
  }

  if (method === 'GET' && path === '/meetday/ops') {
    const meet = String(url.searchParams.get('meet') || '');
    const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
    if (!ID.test(meet)) return fail(400, 'Bad meet');
    const r = await env.DB.prepare(`SELECT seq, op_id AS id, at, by_email AS byEmail, by_name AS by, type, data FROM meetday_op WHERE meet_id = ? AND seq > ? ORDER BY seq LIMIT 1000`).bind(meet, since).all();
    const ops = r.results.map((o) => ({ ...o, data: JSON.parse(o.data) }));
    return json({ ops, last: ops.length ? ops[ops.length - 1].seq : since, more: ops.length === 1000 });
  }

  // Fetch a public live-results page for the app (browsers can't read other sites directly).
  if (method === 'POST' && path === '/meetday/fetch') {
    let u;
    try { u = new URL(String(body.url || '')); } catch { return fail(400, 'That is not a web address.'); }
    if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return fail(400, 'That address cannot be fetched.');
    let r;
    try {
      r = await fetchImpl(u.toString(), { headers: { 'user-agent': 'NSEA-MeetDay/1 (+coach live results reader)', accept: 'text/html,text/plain,application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    } catch { return fail(502, 'Could not reach that page.'); }
    if (!r.ok) return fail(502, `That page answered ${r.status}.`);
    const type = r.headers.get('content-type') || '';
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 4_000_000) return fail(502, 'That page is too large.');
    if (/pdf/i.test(type) || /\.pdf$/i.test(u.pathname)) return json({ url: r.url || u.toString(), type: 'pdf', base64: b64(buf) });
    return json({ url: r.url || u.toString(), type: 'text', text: new TextDecoder().decode(buf) });
  }

  if (method === 'POST' && path === '/meetday/delete') {
    if (!owner) return fail(403, 'Only an owner can delete a meet.');
    const id = String(body.id || '');
    if (!ID.test(id)) return fail(400, 'Bad meet');
    await env.DB.batch([env.DB.prepare(`DELETE FROM meetday_op WHERE meet_id = ?`).bind(id), env.DB.prepare(`DELETE FROM meetday_meet WHERE id = ?`).bind(id)]);
    await audit('meetday', 'delete meet', id);
    return json({ ok: true });
  }
  return null;
}

function b64(buf) {
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
export function blockedHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(::1|fc|fd|fe80)/.test(h) || !h.includes('.')) return true;
  return false;
}
