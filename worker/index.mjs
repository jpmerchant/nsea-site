// NSEA Swim Worker. Only /api/* reaches this code; everything else is static assets.
import { fail } from './util.mjs';
import { handleCarpool } from './carpool.mjs';
import { handleAdmin } from './admin.mjs';
import { handleContent } from './content.mjs';
import { handleAssessmentPublic } from './assessment-public.mjs';
import { syncAll } from './alumni.mjs';
import { handleMeetdayNotify } from './meetday.mjs';
import { handleHub } from './hub.mjs';
import { runCheck } from './schedule.mjs';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/carpool/')) return handleCarpool(req, env, url);
    if (url.pathname.startsWith('/api/assessment/')) return handleAssessmentPublic(req, env, url);
    if (url.pathname.startsWith('/api/content/')) return handleContent(req, env, url);
    if (url.pathname === '/api/meetday/notify') return handleMeetdayNotify(req, env, url);
    if (url.pathname.startsWith('/api/admin/')) return handleAdmin(req, env, url);
    if (url.pathname.startsWith('/api/hub/')) return handleHub(req, env, url);
    return fail(404, 'Not found');
  },
  // Crons (see wrangler.jsonc): daily alumni roster refresh; Wednesday night practice schedule check
  // ("0 2 * * 4" UTC = Wednesday 9 PM Eastern in winter, 10 PM in summer), ready for the Thursday newsletter.
  async scheduled(event, env, ctx) {
    if (event.cron === '0 2 * * 4') ctx.waitUntil(runCheck(env, 'cron').catch((e) => console.error('schedule check', e && e.message)));
    else ctx.waitUntil(syncAll(env));
  },
};
