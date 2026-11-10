// Coach reports (/api/admin/reports/*). Report pages contain swimmer names and times, so they live in a
// private R2 bucket (never in the repo or static assets) and are served only to signed-in admins with the
// "reports" role (or an owner). Every view, upload and delete is written to the audit log.
import { json, fail } from './util.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()&-]{0,80}\.html$/;
const MAX_BYTES = 8 * 1024 * 1024;
const PREFIX = 'reports/';

export async function handleReportsAdmin(env, me, method, path, body, audit, req) {
  if (!env.REPORTS) return fail(503, 'The reports bucket is not connected yet.');
  const isOwner = me.roles.includes('owner');

  if (method === 'GET' && path === '/reports') {
    const l = await env.REPORTS.list({ prefix: PREFIX });
    return json({
      owner: isOwner,
      reports: l.objects.map((o) => ({ name: o.key.slice(PREFIX.length), size: o.size, uploaded: o.uploaded.toISOString() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  const v = path.match(/^\/reports\/view\/(.+)$/);
  if (method === 'GET' && v) {
    const name = decodeURIComponent(v[1]);
    if (!NAME.test(name)) return fail(404, 'Not found');
    const o = await env.REPORTS.get(PREFIX + name);
    if (!o) return fail(404, 'Report not found');
    await audit('reports', 'view report', name);
    return new Response(o.body, { headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    } });
  }

  // Uploading and deleting are owner-only: an owner uploads after each rebuild of the results database.
  if (method === 'POST' && path === '/reports/upload') {
    if (!isOwner) return fail(403, 'Only an owner can upload reports.');
    const name = String(body.name || '').trim();
    const html = typeof body.html === 'string' ? body.html : '';
    if (!NAME.test(name)) return fail(400, 'Use a file name made of letters, numbers, spaces, dots or dashes, ending in .html.');
    if (!/<html|<!doctype/i.test(html.slice(0, 500))) return fail(400, 'That does not look like an HTML report.');
    if (html.length > MAX_BYTES) return fail(400, 'That file is too large (8 MB limit).');
    await env.REPORTS.put(PREFIX + name, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    await audit('reports', 'upload report', `${name} (${Math.round(html.length / 1024)} KB)`);
    return json({ ok: true });
  }
  const d = path.match(/^\/reports\/delete$/);
  if (method === 'POST' && d) {
    if (!isOwner) return fail(403, 'Only an owner can delete reports.');
    const name = String(body.name || '');
    if (!NAME.test(name)) return fail(400, 'Bad name.');
    await env.REPORTS.delete(PREFIX + name);
    await audit('reports', 'delete report', name);
    return json({ ok: true });
  }
  return null;
}
