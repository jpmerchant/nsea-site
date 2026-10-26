// Events calendar admin: reads and publishes the data files in the nsea-events GitHub repo (the calendar site itself stays on GitHub Pages).
// Needs the secret EVENTS_GITHUB_TOKEN (fine-grained token, Contents read/write on that one repo). Vars EVENTS_REPO and EVENTS_BRANCH.
import { json, fail, clean } from './util.mjs';

const FILES = { events: 'data/events.csv', venues: 'data/venues.csv', standards: 'data/standards.csv', settings: 'data/settings.json' };
const HEADERS = {
  events: 'id,title,start,end,precision,month_hint,type,groups,eligibility,venue,status,tags,description,link,needs_review,review_note,signup_deadline,signup_link,has_selection,selection_link,selection_notes,has_standards,standards,standards_link',
  venues: 'key,name,city,state,address,map_query,home,verified',
  standards: 'key,name,group,link,notes',
};
const MAX = 400_000;

async function gh(env, path, opt = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.github.com/repos/${env.EVENTS_REPO}${path}`, {
    ...opt,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.EVENTS_GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'nsea-site-admin', ...(opt.headers || {}) },
  });
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch {} const e = new Error(`GitHub ${r.status}${m ? ': ' + m : ''}`); e.status = r.status; throw e; }
  return r;
}
const branch = (env) => encodeURIComponent(env.EVENTS_BRANCH || 'main');

export function configured(env) { return !!(env.EVENTS_GITHUB_TOKEN && env.EVENTS_REPO); }

export async function eventsData(env, fetchImpl = fetch) {
  if (!configured(env)) return fail(503, 'The events connection is not set up yet. An owner needs to add the GitHub token.');
  try {
    const ref = await (await gh(env, `/git/ref/heads/${branch(env)}`, { headers: { 'cache-control': 'no-cache' } }, fetchImpl)).json();
    const head = ref.object.sha;
    const raw = (p) => gh(env, `/contents/${p}?ref=${head}`, { headers: { accept: 'application/vnd.github.raw+json' } }, fetchImpl).then((r) => r.text());
    const opt = (p) => raw(p).catch(() => '');
    const [events, venues, standards, settings] = await Promise.all([raw(FILES.events), raw(FILES.venues), opt(FILES.standards), opt(FILES.settings)]);
    return json({ head, repo: env.EVENTS_REPO, events, venues, standards, settings });
  } catch (e) { return fail(502, e.message); }
}

// body: { head, message, files: { events?, venues?, standards?, settings? } }
export async function eventsPublish(env, me, body, audit, fetchImpl = fetch) {
  if (!configured(env)) return fail(503, 'The events connection is not set up yet.');
  const head = clean(body.head, 60);
  const files = body.files && typeof body.files === 'object' ? body.files : {};
  const keys = Object.keys(files);
  if (!/^[0-9a-f]{40}$/.test(head) || !keys.length) return fail(400, 'Nothing to publish.');
  const tree = [];
  for (const k of keys) {
    if (!FILES[k]) return fail(400, `Unknown file: ${k}`);
    const c = files[k];
    if (typeof c !== 'string' || c.length > MAX) return fail(400, `${k} is empty or too large.`);
    if (k === 'settings') { try { JSON.parse(c); } catch { return fail(400, 'Settings are not valid.'); } }
    else if (c.split('\n')[0].trim() !== HEADERS[k]) return fail(400, `The ${k} columns do not match what the calendar expects.`);
    tree.push({ path: FILES[k], mode: '100644', type: 'blob', content: c });
  }
  const message = `${clean(body.message, 120) || 'Update events calendar'}\n\nEdited in the NSEA admin console by ${me.email}`;
  try {
    const ref = await (await gh(env, `/git/ref/heads/${branch(env)}`, { headers: { 'cache-control': 'no-cache' } }, fetchImpl)).json();
    if (ref.object.sha !== head) return fail(409, 'Someone else changed the calendar since you loaded it. Reload this page, then re-apply your edit.');
    const base = await (await gh(env, `/git/commits/${head}`, {}, fetchImpl)).json();
    const t = await (await gh(env, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) }, fetchImpl)).json();
    const c = await (await gh(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [head] }) }, fetchImpl)).json();
    await gh(env, `/git/refs/heads/${branch(env)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) }, fetchImpl);
    await audit('events', 'publish calendar', clean(body.message, 120) || keys.join(', '));
    return json({ ok: true, head: c.sha });
  } catch (e) { return fail(e.status === 422 ? 409 : 502, e.status === 422 ? 'Someone else changed the calendar since you loaded it. Reload this page, then re-apply your edit.' : e.message); }
}
