// Alumni results: reads each college roster page (Sidearm Sports sites), keeps the "Top Marks" snapshot and
// queues season highlights for approval. Public output only shows consented, approved items.
import { json, fail } from './util.mjs';

const UA = 'NSEASwimAlumniBot/1.0 (+https://nseaswimteam.com; one request per alumnus per day)';
const SEASONS_TO_IMPORT = 2; // newest seasons only, so the first check does not flood the queue
const SEASON = /^(?:(?:Summer|Fall|Winter|Spring)\s+)?\d{4}(?:-\d{2,4})?$/;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
export function text(html) {
  return String(html).replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ').trim();
}

// Roster bio sections look like <h2>Heading</h2><ul><li>…</li></ul>. Returns { marks:[{event,time}], seasons:[{label,items[]}] }.
export function parseRoster(html) {
  const out = { marks: [], seasons: [] };
  // The heading text may not contain another <h2>, otherwise an h2 with no list after it swallows the next section.
  const re = /<h2[^>]*>((?:(?!<\/?h2)[\s\S])*?)<\/h2>(?:\s|<!--[\s\S]*?-->)*<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  let m;
  while ((m = re.exec(html))) {
    const head = text(m[1]);
    const items = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => text(x[1])).filter(Boolean);
    if (!items.length) continue;
    if (/^top marks$/i.test(head)) {
      for (const it of items) {
        const mm = it.match(/^(.+?)\s+[-–]\s+(\d[\d:.,]*\d|\d)$/);
        if (mm) out.marks.push({ event: mm[1].trim(), time: mm[2] });
      }
    } else if (SEASON.test(head)) out.seasons.push({ label: head, items });
  }
  return out;
}

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Roster pages get a new id every season, so find this season's link on the team roster list.
export function findRosterLink(html, a) {
  const re = new RegExp(`/sports/${a.sport_path}/roster/${slugOf(a.name)}/(\\d+)`, 'g');
  const ids = [...html.matchAll(re)].map((x) => +x[1]);
  return ids.length ? `${a.base_url}/sports/${a.sport_path}/roster/${slugOf(a.name)}/${Math.max(...ids)}` : null;
}

function sameHost(url, base) { try { return new URL(url).host === new URL(base).host && new URL(url).protocol === 'https:'; } catch { return false; } }
async function getHtml(url, base, fetchImpl) {
  if (!sameHost(url, base)) throw new Error('Link is not on the school site');
  const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const looksRight = (html, a) => { const [first, ...rest] = a.name.split(' '); return html.includes(a.name) || html.includes(`${rest.join(' ')}, ${first}`); };

export async function syncAlumnus(env, a, fetchImpl = fetch) {
  let url = a.roster_url, html = null, parsed = null;
  try { if (url) { html = await getHtml(url, a.base_url, fetchImpl); parsed = looksRight(html, a) ? parseRoster(html) : null; } } catch { html = null; }
  if (!parsed || (!parsed.marks.length && !parsed.seasons.length)) {
    try {
      const list = await getHtml(`${a.base_url}/sports/${a.sport_path}/roster`, a.base_url, fetchImpl);
      const found = findRosterLink(list, a);
      if (!found) return finish(env, a, 'not on the current roster list');
      url = found; html = await getHtml(url, a.base_url, fetchImpl);
      parsed = looksRight(html, a) ? parseRoster(html) : null;
    } catch (e) { return finish(env, a, 'fetch failed: ' + e.message); }
  }
  if (!parsed || (!parsed.marks.length && !parsed.seasons.length)) return finish(env, a, 'page found but no results section recognised');
  const stmts = [env.DB.prepare(`UPDATE alumni SET roster_url = ?, marks = ?, synced_at = datetime('now'), sync_status = 'ok' WHERE id = ?`).bind(url, JSON.stringify(parsed.marks), a.id)];
  for (const s of parsed.seasons.slice(0, SEASONS_TO_IMPORT)) for (const t of s.items) {
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO alumni_items (alumni_id, season, text) VALUES (?, ?, ?)`).bind(a.id, s.label, t.slice(0, 400)));
  }
  const res = await env.DB.batch(stmts);
  const added = res.slice(1).reduce((n, r) => n + (r.meta?.changes || 0), 0);
  return { ok: true, marks: parsed.marks.length, added };
}
async function finish(env, a, status) {
  await env.DB.prepare(`UPDATE alumni SET synced_at = datetime('now'), sync_status = ? WHERE id = ?`).bind(status, a.id).run();
  return { ok: false, status };
}
export async function syncAll(env, fetchImpl = fetch) {
  const { results } = await env.DB.prepare(`SELECT * FROM alumni WHERE current = 1`).all();
  const out = [];
  for (const a of results) { try { out.push([a.slug, await syncAlumnus(env, a, fetchImpl)]); } catch (e) { out.push([a.slug, { ok: false, status: e.message }]); } }
  return out;
}

// Public: consented alumni only, approved notes only.
export async function publicAlumni(env) {
  const { results: people } = await env.DB.prepare(`SELECT id, slug, name, school, class_year, roster_url, marks, synced_at FROM alumni WHERE consent = 1 AND current = 1 ORDER BY name`).all();
  const { results: items } = await env.DB.prepare(`SELECT alumni_id, season, text FROM alumni_items WHERE status = 'approved' ORDER BY season DESC, id`).all();
  return json({ alumni: people.map((p) => ({
    slug: p.slug, name: p.name, school: p.school, class_year: p.class_year, source: p.roster_url, updated: p.synced_at,
    marks: JSON.parse(p.marks || '[]'), updates: items.filter((i) => i.alumni_id === p.id).map((i) => ({ season: i.season, text: i.text })),
  })) }, 200, { 'cache-control': 'public, max-age=300' });
}

// Admin (Content module). Returns a Response or null.
export async function handleAlumniAdmin(env, me, method, path, body, audit, fetchImpl = fetch) {
  if (method === 'GET' && path === '/content/alumni') {
    const { results: people } = await env.DB.prepare(`SELECT id, slug, name, school, class_year, roster_url, current, consent, marks, synced_at, sync_status FROM alumni ORDER BY name`).all();
    const { results: items } = await env.DB.prepare(`SELECT id, alumni_id, season, text, status, first_seen FROM alumni_items ORDER BY season DESC, id`).all();
    return json({ alumni: people.map((p) => ({ ...p, marks: JSON.parse(p.marks || '[]'), items: items.filter((i) => i.alumni_id === p.id) })) });
  }
  let m = path.match(/^\/content\/alumni\/(\d+)\/(sync|consent|approve-all)$/);
  if (m && method === 'POST') {
    const a = await env.DB.prepare(`SELECT * FROM alumni WHERE id = ?`).bind(+m[1]).first();
    if (!a) return fail(404, 'Alumnus not found');
    if (m[2] === 'sync') { const r = await syncAlumnus(env, a, fetchImpl); await audit('alumni', 'check roster page', a.name + ' — ' + (r.ok ? `${r.added} new` : r.status)); return json(r); }
    if (m[2] === 'consent') { const on = body.consent ? 1 : 0; await env.DB.prepare(`UPDATE alumni SET consent = ? WHERE id = ?`).bind(on, a.id).run(); await audit('alumni', on ? 'consent recorded' : 'consent removed', a.name); return json({ ok: true }); }
    const r = await env.DB.prepare(`UPDATE alumni_items SET status = 'approved', decided_by = ? WHERE alumni_id = ? AND status = 'pending'`).bind(me.email, a.id).run();
    await audit('alumni', 'approve all', `${a.name} (${r.meta?.changes || 0})`);
    return json({ ok: true });
  }
  m = path.match(/^\/content\/alumni\/items\/(\d+)\/(approve|hide|pending)$/);
  if (m && method === 'POST') {
    const status = { approve: 'approved', hide: 'hidden', pending: 'pending' }[m[2]];
    await env.DB.prepare(`UPDATE alumni_items SET status = ?, decided_by = ? WHERE id = ?`).bind(status, me.email, +m[1]).run();
    await audit('alumni', m[2] + ' update', '#' + m[1]);
    return json({ ok: true });
  }
  return null;
}
