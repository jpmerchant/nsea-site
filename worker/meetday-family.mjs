// Meet Day family side (JP, Nov 26 2026; first test with a few families at 2026 STAR Triad Tropic).
//
// A family opens a private link (/meetday/#k=<token>) that a coach made in Meet Day › Tools › Families. The link
// belongs to a roster family (roster_family email) and lasts the season: at every meet whose family view is on, the
// family sees its own swimmers (matched by USA Swimming ID, then name). Everything a family sees is built here on the
// server from the coaches' package + ops (worker/meetday-family-view.mjs), so nothing private reaches the phone.
//
// Public (token in the x-family-key header, or ?k= for the service worker):
//   GET  /api/meetday/family/me            the family's swimmers and the meets they can open
//   GET  /api/meetday/family/meet?id=&v=   one meet's family view ({ same: true } when v is still current)
//   POST /api/meetday/family/feedback      { meet, page, text }
//   GET  /api/meetday/family/push-key      Web Push public key
//   POST /api/meetday/family/push          { sub } subscribe this phone / { sub, off: true } unsubscribe
//   GET  /api/meetday/family/alerts        recent alerts (the service worker shows them when a push arrives)
// Coach (inside /api/admin, Meet Day roles): see handleFamilyAdmin.
import { json, fail, clean, rand } from './util.mjs';
import { derive } from '../public/admin/meet/lib/model.mjs';
import { familyView, findSwimmers, familyViewOn, infoText, familyInfo } from './meetday-family-view.mjs';
import { familySwimmers } from './families.mjs';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const MEET = /^[a-z0-9][a-z0-9-]{2,60}$/;

// ---------- meet cache: derive once per meet version, shared by every family on this isolate ----------
const cache = new Map();
async function meetState(env, id) {
  const m = await env.DB.prepare(`SELECT updated_at, (SELECT MAX(seq) FROM meetday_op WHERE meet_id = ?) AS seq FROM meetday_meet WHERE id = ?`).bind(id, id).first();
  if (!m) return null;
  const v = `${m.updated_at}|${m.seq || 0}`;
  const hit = cache.get(id);
  if (hit && hit.v === v) return hit;
  const row = await env.DB.prepare(`SELECT pkg FROM meetday_meet WHERE id = ?`).bind(id).first();
  const r = await env.DB.prepare(`SELECT op_id AS id, at, by_name AS by, type, data FROM meetday_op WHERE meet_id = ? ORDER BY seq`).bind(id).all();
  const ops = r.results.map((o) => ({ ...o, data: JSON.parse(o.data) }));
  const pkg = JSON.parse(row.pkg);
  const st = { v, pkg, ops, model: derive(pkg, ops), on: familyViewOn(ops) };
  cache.set(id, st);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return st;
}
export const _clearFamilyCache = () => cache.clear();

async function linkOf(env, req, url) {
  const k = String(req.headers.get('x-family-key') || url.searchParams.get('k') || '');
  if (!TOKEN.test(k)) return null;
  const l = await env.DB.prepare(`SELECT id, email, label, revoked_at, last_seen_at FROM meetday_family_link WHERE token = ?`).bind(k).first();
  if (!l || l.revoked_at) return null;
  return l;
}
// Meets this family can open: family view on, not long over, with at least one of their swimmers in it.
async function familyMeets(env, roster) {
  const r = await env.DB.prepare(`SELECT id, name, start_date, end_date FROM meetday_meet WHERE end_date >= date('now', '-14 days') ORDER BY start_date`).all();
  const out = [];
  for (const m of r.results) {
    const st = await meetState(env, m.id);
    if (!st || !st.on) continue;
    const mine = findSwimmers(st.pkg, roster);
    if (!mine.size) continue;
    out.push({ id: m.id, name: st.pkg.name, short: st.pkg.short || st.pkg.name, start: m.start_date, end: m.end_date, swims: st.model.rows.filter((x) => mine.has(x.swimmerId) && !x.scratched).length, st, mine });
  }
  return out;
}

export async function handleMeetdayFamily(req, env, url) {
  const path = url.pathname.replace(/^\/api\/meetday\/family/, '') || '/';
  if (path === '/push-key' && req.method === 'GET') return json({ key: (await vapidKeys(env)).pub });
  const link = await linkOf(env, req, url);
  if (!link) return fail(401, 'This family link is not valid any more. Ask a coach for a new one.');
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== url.host) return fail(403, 'Bad origin');
  }
  // Seen (at most once every 5 minutes, so polling doesn't write on every request).
  if (!link.last_seen_at || Date.parse(link.last_seen_at + 'Z') < Date.now() - 300_000) {
    await env.DB.prepare(`UPDATE meetday_family_link SET last_seen_at = datetime('now'), views = views + 1 WHERE id = ?`).bind(link.id).run();
  }
  const roster = await familySwimmers(env, link.email);

  // Home-screen install: the start address carries the key (an iPhone's home-screen app has its own storage).
  if (req.method === 'GET' && path === '/manifest') {
    const k = String(req.headers.get('x-family-key') || url.searchParams.get('k') || '');
    return new Response(JSON.stringify({ name: 'NSEA Meet Day', short_name: 'Meet Day', description: 'NSEA Swim Meet Day for families', start_url: `/meetday/#k=${k}`, scope: '/meetday/', display: 'standalone', background_color: '#FAFBFB', theme_color: '#008675',
      icons: [{ src: '/meetday/icon.svg', sizes: 'any', type: 'image/svg+xml' }, { src: '/meetday/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/meetday/icon-512.png', sizes: '512x512', type: 'image/png' }] }), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'private, no-store' } });
  }
  if (req.method === 'GET' && path === '/me') {
    const meets = await familyMeets(env, roster);
    return json({ family: link.label || '', swimmers: roster.map((s) => s.name), meets: meets.map(({ st, mine, ...m }) => m) });
  }
  if (req.method === 'GET' && path === '/meet') {
    const id = String(url.searchParams.get('id') || '');
    if (!MEET.test(id)) return fail(400, 'Bad meet');
    const st = await meetState(env, id);
    if (!st || !st.on) return fail(404, 'This meet is not open to families.');
    const mine = findSwimmers(st.pkg, roster);
    if (!mine.size) return fail(404, 'None of your swimmers are in this meet.');
    const v = `${st.v}|${[...mine].sort().join('.')}`;
    if (url.searchParams.get('v') === v) return json({ same: true, v });
    return json({ v, at: new Date().toISOString(), ...familyView(st.pkg, st.model, mine, st.ops) });
  }
  if (req.method === 'POST' && path === '/feedback') {
    let b = {}; try { b = await req.json(); } catch { /* empty */ }
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) return fail(400, 'Type your feedback first.');
    await env.DB.prepare(`INSERT INTO meetday_feedback (link_id, meet_id, page, text) VALUES (?, ?, ?, ?)`).bind(link.id, MEET.test(String(b.meet || '')) ? b.meet : null, clean(b.page, 40) || null, text).run();
    return json({ ok: true });
  }
  if (req.method === 'POST' && path === '/push') {
    let b = {}; try { b = await req.json(); } catch { /* empty */ }
    const ep = String((b.sub && b.sub.endpoint) || '');
    let u; try { u = new URL(ep); } catch { return fail(400, 'Bad subscription'); }
    if (u.protocol !== 'https:' || ep.length > 1000) return fail(400, 'Bad subscription');
    if (b.off) { await env.DB.prepare(`DELETE FROM meetday_push WHERE endpoint = ? AND link_id = ?`).bind(ep, link.id).run(); return json({ ok: true }); }
    await env.DB.prepare(`INSERT INTO meetday_push (link_id, endpoint) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET link_id = excluded.link_id, fails = 0`).bind(link.id, ep).run();
    return json({ ok: true });
  }
  if (req.method === 'GET' && path === '/alerts') {
    const r = await env.DB.prepare(`SELECT key, meet_id AS meet, title, body, sent_at AS at FROM meetday_push_sent WHERE link_id = ? AND title IS NOT NULL AND sent_at >= datetime('now', '-3 hours') ORDER BY sent_at DESC LIMIT 10`).bind(link.id).all();
    return json({ alerts: r.results });
  }
  return fail(404, 'Not found');
}

// ---------- coach side: /api/admin/meetday/families… ----------
export async function handleFamilyAdmin(env, me, method, path, body, audit, url) {
  if (method === 'GET' && path === '/meetday/families') {
    const meet = String(url.searchParams.get('meet') || '');
    const links = (await env.DB.prepare(`SELECT l.id, l.token, l.email, l.label, l.created_at, l.created_by, l.revoked_at, l.last_seen_at, l.views,
        (SELECT COUNT(*) FROM meetday_push p WHERE p.link_id = l.id) AS phones, r.family_name
        FROM meetday_family_link l LEFT JOIN roster_family r ON r.email = l.email ORDER BY l.revoked_at IS NOT NULL, coalesce(l.label, r.family_name)`).all()).results;
    const st = MEET.test(meet) ? await meetState(env, meet) : null;
    // Each swimmer in the meet with their roster family (by USA Swimming ID or name), for the "make a link" picker.
    const roster = (await env.DB.prepare(`SELECT s.usa_id, s.name, f.email, r.family_name FROM roster_swimmer s JOIN family_swimmer f ON f.usa_id = s.usa_id
        LEFT JOIN roster_family r ON r.email = f.email`).all()).results;
    const out = [];
    for (const l of links) {
      const sw = roster.filter((x) => x.email.toLowerCase() === l.email.toLowerCase());
      const mine = st ? findSwimmers(st.pkg, sw) : new Set();
      out.push({ id: l.id, url: `${url.origin}/meetday/#k=${l.token}`, email: l.email, label: l.label || l.family_name || l.email, swimmers: sw.map((x) => x.name),
        inMeet: st ? st.model.rows.filter((x) => mine.has(x.swimmerId) && !x.scratched).length : null, created: l.created_at, by: l.created_by, revoked: l.revoked_at, seen: l.last_seen_at, views: l.views, phones: l.phones });
    }
    const swimmers = st ? st.pkg.swimmers.map((s) => {
      const fams = [...new Map(roster.filter((x) => findSwimmers({ swimmers: [s] }, [x]).size).map((x) => [x.email.toLowerCase(), { email: x.email, family: x.family_name || x.email, hasLink: links.some((l) => !l.revoked_at && l.email.toLowerCase() === x.email.toLowerCase()) }])).values()];
      return { id: s.id, name: s.name, families: fams };
    }).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const fb = (await env.DB.prepare(`SELECT f.id, f.meet_id AS meet, f.page, f.text, f.created_at AS at, coalesce(l.label, r.family_name, l.email) AS family
        FROM meetday_feedback f JOIN meetday_family_link l ON l.id = f.link_id LEFT JOIN roster_family r ON r.email = l.email ORDER BY f.id DESC LIMIT 100`).all()).results;
    return json({ links: out, swimmers, feedback: fb, on: st ? st.on : false, infoText: st ? infoText(familyInfo(st.pkg, st.ops, { fallback: true })) : '', infoSaved: st ? familyInfo(st.pkg, st.ops).length > 0 : false });
  }
  if (method === 'POST' && path === '/meetday/family-link') {
    const email = String(body.email || '').toLowerCase().trim();
    const fam = await env.DB.prepare(`SELECT email, family_name FROM roster_family WHERE email = ?`).bind(email).first();
    if (!fam) return fail(404, 'That family is not on the roster.');
    const token = rand(18);
    const label = clean(body.label, 60) || fam.family_name || email;
    await env.DB.prepare(`INSERT INTO meetday_family_link (token, email, label, created_by) VALUES (?, ?, ?, ?)`).bind(token, fam.email, label, me.email).run();
    await audit('meetday', 'family link', label);
    return json({ ok: true, url: `${url.origin}/meetday/#k=${token}` });
  }
  if (method === 'POST' && path === '/meetday/family-link/revoke') {
    const id = +body.id;
    const l = await env.DB.prepare(`SELECT id, label, email FROM meetday_family_link WHERE id = ?`).bind(id).first();
    if (!l) return fail(404, 'Link not found');
    await env.DB.batch([
      env.DB.prepare(`UPDATE meetday_family_link SET revoked_at = datetime('now') WHERE id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM meetday_push WHERE link_id = ?`).bind(id),
    ]);
    await audit('meetday', 'revoke family link', l.label || l.email);
    return json({ ok: true });
  }
  return null;
}

// ---------- phone notifications (trial) ----------
// Web Push with no payload: the push only wakes the family app's service worker, which fetches /alerts and shows them.
// So only VAPID signing is needed (no payload encryption). The key pair is made on first use and kept in meetday_setting.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function vapidKeys(env) {
  const row = await env.DB.prepare(`SELECT v FROM meetday_setting WHERE k = 'vapid'`).first();
  if (row) return JSON.parse(row.v);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await env.DB.prepare(`INSERT OR IGNORE INTO meetday_setting (k, v) VALUES ('vapid', ?)`).bind(JSON.stringify(keys)).run();
  return JSON.parse((await env.DB.prepare(`SELECT v FROM meetday_setting WHERE k = 'vapid'`).first()).v);
}
async function vapidAuth(keys, endpoint) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:team@nseaswim.com' })}`;
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.pub}`;
}
void unb64u;

// Clock in the meet's time zone (America/New_York unless the package says otherwise).
function meetNow(tz, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const clockMin = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if (!m) return null; let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
const fmt = (cs) => { if (cs == null) return ''; const m = Math.floor(cs / 6000), s = ((cs % 6000) / 100).toFixed(2); return m ? `${m}:${s.padStart(5, '0')}` : s; };
const shortEv = (s) => String(s.title || '').replace(/^(Girls|Boys|Women|Men|Mixed)\s+/i, '').replace(/^(\d+ & (Under|Over)|\d+-\d+|Open)\s+/i, '');

// Alerts for one family's swims right now. Returns [{ key, title, body, silent }]; `silent` ones are recorded only
// (a baseline for heat/lane changes). Exported for tests.
export function alertsFor(view, now, recentResult) {
  const out = [];
  for (const s of view.swims) {
    if (s.scratched) continue;
    const who = s.name.split(' ')[0];
    const where = [s.heat ? `heat ${s.heat}${s.of ? ' of ' + s.of : ''}` : '', s.lane ? `lane ${s.lane}` : '', s.pool].filter(Boolean).join(', ');
    const st = clockMin(s.start);
    if (s.day === now.day && st != null && !s.result && st > now.min && st - now.min <= 15) {
      out.push({ key: `up|${s.id}`, title: `${who} swims soon: ${shortEv(s)}`, body: `${where}${where ? ' · ' : ''}about ${s.start.replace(/^0/, '')}${s.est ? ' (estimated)' : ''}` });
    }
    if (s.result && recentResult(s.id)) {
      const r = s.result;
      const txt = r.time != null ? `${fmt(r.time)}${s.dEntry != null ? ` (${s.dEntry < 0 ? '−' : '+'}${fmt(Math.abs(s.dEntry))} vs entry)` : ''}` : (r.status || 'result in');
      const extra = s.cuts.length ? ` · New cut: ${s.cuts.map((c) => c.label).join(', ')}` : '';
      out.push({ key: `res|${s.id}|${r.time ?? r.status}`, title: `${who}: ${shortEv(s)} ${txt}`, body: `${r.official ? 'Official' : 'Unofficial'}${extra}` });
    }
    if (s.isFinal && s.heat && s.lane && s.day === now.day) {
      out.push({ key: `fin|${s.id}`, title: `${who} made finals: ${shortEv(s)}`, body: `${where}${s.start ? ` · about ${s.start.replace(/^0/, '')}` : ''}` });
    }
    if (s.heat && s.lane && s.day === now.day) out.push({ key: `hl|${s.id}|${s.heat}|${s.lane}`, base: `hl|${s.id}|`, title: `${who}: heat/lane changed for ${shortEv(s)}`, body: where, silent: true });
  }
  return out;
}

// Cron (every minute): for meets running today with family view on and at least one subscribed phone, send new alerts.
export async function runFamilyAlerts(env, fetchImpl = fetch, date = new Date()) {
  const subs = (await env.DB.prepare(`SELECT p.id, p.link_id, p.endpoint, l.email FROM meetday_push p JOIN meetday_family_link l ON l.id = p.link_id WHERE l.revoked_at IS NULL AND p.fails < 5`).all()).results;
  if (!subs.length) return { sent: 0 };
  const meets = (await env.DB.prepare(`SELECT id FROM meetday_meet WHERE start_date <= date('now', '+1 day') AND end_date >= date('now', '-1 day')`).all()).results;
  if (!meets.length) return { sent: 0 };
  let keys = null, sent = 0;
  const byLink = new Map();
  for (const s of subs) (byLink.get(s.link_id) || byLink.set(s.link_id, { email: s.email, subs: [] }).get(s.link_id)).subs.push(s);
  for (const m of meets) {
    const st = await meetState(env, m.id);
    if (!st || !st.on) continue;
    const now = meetNow(st.pkg.tz, date);
    const resAt = new Map([...st.model.results.values()].map((r) => [r.entry, r.at]));
    const recent = (id) => { const at = resAt.get(id); return at && Date.parse(at) > date.getTime() - 30 * 60_000; };
    for (const [linkId, L] of byLink) {
      const roster = await familySwimmers(env, L.email);
      const mine = findSwimmers(st.pkg, roster);
      if (!mine.size) continue;
      const view = familyView(st.pkg, st.model, mine, st.ops);
      const list = alertsFor(view, now, recent);
      if (!list.length) continue;
      const had = new Set((await env.DB.prepare(`SELECT key FROM meetday_push_sent WHERE link_id = ? AND meet_id = ?`).bind(linkId, m.id).all()).results.map((x) => x.key));
      let fresh = 0;
      for (const a of list) {
        if (had.has(a.key)) continue;
        // Heat/lane: the first one seen is only a baseline; a different one later is a change worth sending.
        const show = !a.silent || [...had].some((k) => k.startsWith(a.base));
        await env.DB.prepare(`INSERT OR IGNORE INTO meetday_push_sent (link_id, key, meet_id, title, body) VALUES (?, ?, ?, ?, ?)`).bind(linkId, a.key, m.id, show ? a.title : null, show ? a.body : null).run();
        had.add(a.key);
        if (show) fresh++;
      }
      if (!fresh) continue;
      keys ||= await vapidKeys(env);
      for (const s of L.subs) {
        let ok = false;
        try {
          const r = await fetchImpl(s.endpoint, { method: 'POST', headers: { TTL: '600', Urgency: 'high', Authorization: await vapidAuth(keys, s.endpoint), 'Content-Length': '0' } });
          ok = r.status < 300;
          if (r.status === 404 || r.status === 410) { await env.DB.prepare(`DELETE FROM meetday_push WHERE id = ?`).bind(s.id).run(); continue; }
        } catch { ok = false; }
        await env.DB.prepare(ok ? `UPDATE meetday_push SET last_ok_at = datetime('now'), fails = 0 WHERE id = ?` : `UPDATE meetday_push SET fails = fails + 1 WHERE id = ?`).bind(s.id).run();
        if (ok) sent++;
      }
    }
  }
  return { sent };
}
