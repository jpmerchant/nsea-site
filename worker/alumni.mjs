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

// ---- Plain-text bios (Mount St. Mary's, FSU, NKU, W&L and others write the bio as free text) ----
// Turns an HTML fragment into trimmed, non-empty text lines, keeping block boundaries as line breaks.
export function lines(html) {
  return String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|li|ul|ol|br|h[1-6]|tr|table|section|article|dd|dt|dl)\b[^>]*>/gi, '\n')
    .split('\n').map(text).filter(Boolean);
}
// Same person if the last name matches and the first names start with the same letter (Madi / Madison).
export function sameName(heading, name) {
  const a = text(heading).toLowerCase().split(' ').filter(Boolean), b = name.toLowerCase().split(' ').filter(Boolean);
  return a.length > 1 && b.length > 1 && a[a.length - 1] === b[b.length - 1] && a[0][0] === b[0][0];
}
const TIME = /^(\d{2,4}\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+[-–]\s+(\d{1,2}:\d{2}\.\d{2}|\d{2}\.\d{2})(?:\s+[-–]\s+(.+))?$/;
const SEASON_HEAD = /^((?:(?:Summer|Fall|Winter|Spring)\s+)?20\d\d(?:-\d{2})?(?:\s*\([^)]*\))?)(\s+season)?(\s+top times)?(?:\s*:\s*(.*))?$/i;
const SKIP_HEAD = /^(high school|prep|club|personal|prior|before)\b/i;
const sentences = (t) => t.split(/…|\.{3}/).map((x) => x.replace(/^[\s.:;,-]+|[\s;,-]+$/g, '')).filter((x) => x.length >= 8);

// Returns { marks:[{event,time,meet?}], seasons:[{label,items[]}], swimcloud } from the player's bio, or empty.
export function parseBioText(html, a) {
  const out = { marks: [], seasons: [], swimcloud: (html.match(/https:\/\/(?:www\.)?swimcloud\.com\/swimmer\/\d+\/?/i) || [''])[0] };
  const hs = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  const k = hs.findIndex((m) => sameName(m[1], a.name));
  if (k < 0) return out;
  const seg = lines(html.slice(hs[k].index + hs[k][0].length, hs[k + 1] ? hs[k + 1].index : undefined));
  const TAB = /^(bio|biography|media|bio media|related|historical|related historical|swimcloud profile)$/i;
  let start = 0;
  for (let i = 0; i < Math.min(seg.length, 40); i++) if (TAB.test(seg[i])) start = i + 1;
  let mode = 'notes', season = null, skip = false;
  const bucket = (label) => { let s = out.seasons.find((x) => x.label === label); if (!s) out.seasons.push((s = { label, items: [] })); return s; };
  for (const line of seg.slice(start)) {
    if (/^(related (content|headlines|press|videos|photos)|historical player information|no related content)/i.test(line)) break;
    if (TAB.test(line)) continue;
    if (/^top times:?$/i.test(line)) { mode = 'marks'; skip = false; continue; }
    const sh = line.match(SEASON_HEAD);
    if (/^skip ad$/i.test(line)) continue;
    if (sh) {
      season = sh[1].replace(/\s+/g, ' ').trim(); skip = false;
      mode = sh[3] ? 'seasonTimes' : 'notes';
      if (sh[4]) for (const t of sentences(sh[4])) bucket(season).items.push(t);
      else if (!sh[3]) bucket(season);
      continue;
    }
    if (SKIP_HEAD.test(line)) { skip = true; mode = 'notes'; continue; }
    if (skip) continue;
    const tm = line.match(TIME);
    if (tm && mode === 'marks') { out.marks.push({ event: tm[1], time: tm[2], ...(tm[3] ? { meet: tm[3] } : {}) }); continue; }
    if (tm && mode === 'seasonTimes' && season) { bucket(season).items.push(`${tm[1]}: ${tm[2]}${tm[3] ? ' (' + tm[3] + ')' : ''}`); continue; }
    if (mode === 'marks') { mode = 'notes'; }
    for (const t of sentences(line)) bucket(season || 'Bio').items.push(t);
  }
  out.seasons = out.seasons.filter((s) => s.items.length);
  return out;
}

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Roster pages get a new id every season, so find this season's link on the team roster list.
// Matches on last name + first initial (Madi/Madison) unless a.roster_slug pins the exact page name.
export function findRosterLink(html, a) {
  const [first, ...rest] = slugOf(a.name).split('-'), last = rest[rest.length - 1];
  const re = new RegExp(`/sports/${a.sport_path}/roster/([a-z0-9-]+)/(\\d+)`, 'g');
  const hits = [...html.matchAll(re)].filter((m) => {
    if (a.roster_slug) return m[1] === a.roster_slug;
    const parts = m[1].split('-');
    return parts[parts.length - 1] === last && parts[0][0] === first[0];
  });
  if (!hits.length) return null;
  const best = hits.reduce((x, y) => (+y[2] > +x[2] ? y : x));
  return `${a.base_url}/sports/${a.sport_path}/roster/${best[1]}/${best[2]}`;
}

function sameHost(url, base) { try { return new URL(url).host === new URL(base).host && new URL(url).protocol === 'https:'; } catch { return false; } }
async function getHtml(url, base, fetchImpl) {
  if (!sameHost(url, base)) throw new Error('Link is not on the school site');
  const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const looksRight = (html, a) => html.includes(a.name) || [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].some((m) => sameName(m[1], a.name));
const read = (html, a) => {
  const p = parseRoster(html);
  if (p.marks.length || p.seasons.length) return { ...p, swimcloud: (html.match(/https:\/\/(?:www\.)?swimcloud\.com\/swimmer\/\d+\/?/i) || [''])[0] };
  return parseBioText(html, a);
};
const empty = (p) => !p || (!p.marks.length && !p.seasons.length);

export async function syncAlumnus(env, a, fetchImpl = fetch) {
  let url = a.roster_url, html = null, parsed = null;
  try { if (url) { html = await getHtml(url, a.base_url, fetchImpl); parsed = looksRight(html, a) ? read(html, a) : null; } } catch { html = null; }
  if (empty(parsed)) {
    try {
      const list = await getHtml(`${a.base_url}/sports/${a.sport_path}/roster`, a.base_url, fetchImpl);
      const found = findRosterLink(list, a);
      if (!found) return finish(env, a, 'not on the current roster list');
      url = found; html = await getHtml(url, a.base_url, fetchImpl);
      parsed = looksRight(html, a) ? read(html, a) : null;
    } catch (e) { return finish(env, a, 'fetch failed: ' + e.message); }
  }
  if (empty(parsed)) return finish(env, a, 'page found but nothing to show yet');
  const stmts = [env.DB.prepare(`UPDATE alumni SET roster_url = ?, marks = ?, swimcloud_url = ?, synced_at = datetime('now'), sync_status = 'ok' WHERE id = ?`).bind(url, JSON.stringify(parsed.marks), parsed.swimcloud || '', a.id)];
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
  const { results: people } = await env.DB.prepare(`SELECT id, slug, name, school, class_year, roster_url, swimcloud_url, marks, synced_at FROM alumni WHERE consent = 1 AND current = 1 ORDER BY name`).all();
  const { results: items } = await env.DB.prepare(`SELECT alumni_id, season, text FROM alumni_items WHERE status = 'approved' ORDER BY season DESC, id`).all();
  return json({ alumni: people.map((p) => ({
    slug: p.slug, name: p.name, school: p.school, class_year: p.class_year, source: p.roster_url, swimcloud: p.swimcloud_url, updated: p.synced_at,
    marks: JSON.parse(p.marks || '[]'), updates: items.filter((i) => i.alumni_id === p.id).map((i) => ({ season: i.season, text: i.text })),
  })) }, 200, { 'cache-control': 'public, max-age=300' });
}

// Admin (Content module). Returns a Response or null.
export async function handleAlumniAdmin(env, me, method, path, body, audit, fetchImpl = fetch) {
  if (method === 'GET' && path === '/content/alumni') {
    const { results: people } = await env.DB.prepare(`SELECT id, slug, name, school, class_year, roster_url, swimcloud_url, current, consent, marks, synced_at, sync_status FROM alumni ORDER BY name`).all();
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
