// Events calendar admin. The calendar site itself stays on GitHub Pages (repo nsea-events). This module:
//  - serves that repo's own admin page (site-src/admin.html) inside the console, so edits to the editor in the repo show up here automatically;
//  - proxies the few GitHub calls that editor makes, using a token held as a Cloudflare secret (EVENTS_GITHUB_TOKEN), limited to the data files.
import { json, fail, clean } from './util.mjs';

export const configured = (env) => !!(env.EVENTS_GITHUB_TOKEN && env.EVENTS_REPO);
const branch = (env) => env.EVENTS_BRANCH || 'main';
const DATA_FILE = /^data\/[\w.-]+\.(csv|json)$/;
const HEX = /^[0-9a-f]{40}$/;

function upstream(env, path, opt = {}, fetchImpl = fetch) {
  return fetchImpl(`https://api.github.com/repos/${env.EVENTS_REPO}${path}`, {
    ...opt,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.EVENTS_GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'nsea-site-admin', ...(opt.headers || {}) },
  });
}

// The editor page from the repo, with its GitHub calls pointed at this Worker and the connect step done automatically.
const SHIM = `<script>
(function(){
  gh=async function(path,opt){opt=opt||{};
    var r=await fetch('/api/admin/events/gh'+path,{method:opt.method||'GET',credentials:'same-origin',cache:'no-store',headers:Object.assign({},opt.headers||{},opt.body?{'content-type':'application/json'}:{}),body:opt.body});
    if(!r.ok){var m='';try{var d=await r.json();m=d.message||d.error||''}catch(e){}throw new Error('GitHub '+r.status+(m?': '+m:''))}
    return r};
  var c=document.getElementById('conn');if(c)c.style.display='none';
  var t=document.getElementById('token');if(t)t.value='console';
  var rm=document.getElementById('remember');if(rm)rm.checked=false;
  connect();
})();
</script>`;

export async function eventsApp(env, fetchImpl = fetch) {
  if (!configured(env)) return fail(503, 'The events connection is not set up yet.');
  const r = await upstream(env, `/contents/site-src/admin.html?ref=${encodeURIComponent(branch(env))}`, { headers: { accept: 'application/vnd.github.raw+json' } }, fetchImpl);
  if (!r.ok) return fail(502, `Could not load the events editor (GitHub ${r.status}).`);
  const html = await r.text();
  if (!html.includes('</body>')) return fail(502, 'The events editor page looks incomplete.');
  return new Response(html.replace('</body>', SHIM + '</body>'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'" },
  });
}

// path is what follows /api/admin/events/gh, e.g. /git/ref/heads/main. body is the parsed JSON for POST/PATCH.
export async function eventsProxy(env, me, method, path, body, audit, fetchImpl = fetch) {
  if (!configured(env)) return fail(503, 'The events connection is not set up yet.');
  const br = branch(env);
  let m;
  const pass = async (p, opt) => {
    const r = await upstream(env, p, opt, fetchImpl);
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  };
  if (method === 'GET' && path === '') return pass('', {});
  if (method === 'GET' && path === `/git/ref/heads/${br}`) return pass(path, {});
  if (method === 'GET' && (m = path.match(/^\/contents\/([^?]+)\?ref=[\w.%/-]+$/)) && DATA_FILE.test(m[1])) {
    return pass(path, { headers: { accept: 'application/vnd.github.raw+json' } });
  }
  if (method === 'GET' && (m = path.match(/^\/git\/commits\/([0-9a-f]{40})$/))) return pass(path, {});
  if (method === 'POST' && path === '/git/trees') {
    const tree = Array.isArray(body.tree) ? body.tree : [];
    if (!HEX.test(body.base_tree || '') || !tree.length || tree.length > 12) return fail(400, 'Bad request');
    for (const t of tree) {
      if (!DATA_FILE.test(t.path || '') || t.mode !== '100644' || t.type !== 'blob' || typeof t.content !== 'string' || t.content.length > 400_000) return fail(400, 'Only the calendar data files can be changed.');
    }
    return pass('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: body.base_tree, tree: tree.map((t) => ({ path: t.path, mode: t.mode, type: t.type, content: t.content })) }) });
  }
  if (method === 'POST' && path === '/git/commits') {
    if (!HEX.test(body.tree || '') || !Array.isArray(body.parents) || body.parents.length !== 1 || !HEX.test(body.parents[0])) return fail(400, 'Bad request');
    const message = `${String(body.message || 'Update events calendar').slice(0, 200)}\n\nEdited in the NSEA admin console by ${me.email}`;
    return pass('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: body.tree, parents: body.parents }) });
  }
  if (method === 'PATCH' && path === `/git/refs/heads/${br}`) {
    if (!HEX.test(body.sha || '')) return fail(400, 'Bad request');
    const res = await pass(path, { method: 'PATCH', body: JSON.stringify({ sha: body.sha, force: false }) });
    if (res.ok) await audit('events', 'publish calendar', body.sha.slice(0, 7));
    return res;
  }
  return fail(404, 'Not found');
}
