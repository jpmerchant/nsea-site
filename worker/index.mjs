// NSEA Swim Worker. Only /api/* reaches this code; everything else is static assets.
import { fail } from './util.mjs';
import { handleCarpool } from './carpool.mjs';
import { handleAdmin } from './admin.mjs';
import { handleContent } from './content.mjs';
import { syncAll } from './alumni.mjs';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/carpool/')) return handleCarpool(req, env, url);
    if (url.pathname.startsWith('/api/content/')) return handleContent(req, env, url);
    if (url.pathname.startsWith('/api/admin/')) return handleAdmin(req, env, url);
    return fail(404, 'Not found');
  },
  // Daily cron (see wrangler.jsonc): refresh alumni roster pages.
  async scheduled(_event, env, ctx) { ctx.waitUntil(syncAll(env)); },
};
