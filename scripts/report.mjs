// npm run report  ->  MIGRATION.md + migration.csv + gated-paths.txt
// Everything is generated from src/data/site.mjs so the list never drifts from the site.
import { writeFileSync, readFileSync } from 'node:fs';
import { pages, utility, retired, held } from '../src/data/site.mjs';

const live = JSON.parse(readFileSync(new URL('./live-urls.json', import.meta.url)));
const norm = (u) => u.split('#')[0];

// live URL -> new path(s)
const map = new Map();
const add = (u, to) => map.set(u, [...(map.get(u) || []), to]);
for (const p of pages) for (const f of p.from || []) add(norm(f), p.path);
for (const u of utility) for (const f of u.from || []) add(norm(f), u.path);
add('/', '/');
const retiredSet = new Set(retired.map((r) => r.from));

const unmapped = live.filter((u) => !map.has(u) && !retiredSet.has(u));
const counts = pages.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});

const rows = [];
rows.push('# NSEA Swim site rebuild: migration inventory');
rows.push('');
rows.push(`_Generated from \`src/data/site.mjs\` by \`npm run report\`. ${live.length} live URLs on nseaswimteam.com; ${pages.length} pages in the new structure._`);
rows.push('');
rows.push('Status key: **ready** = already built, HTML saved in `legacy/` · **pull** = lives on BUILD, content must be pulled · **rebuild** = exists today but merged/redesigned · **new** = does not exist yet.');
rows.push('');
rows.push(`Counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
rows.push('');
rows.push('## 1. Live page -> new location');
rows.push('');
rows.push('| Live page (nseaswimteam.com) | New path | Status |');
rows.push('|---|---|---|');
for (const u of live) {
  if (retiredSet.has(u)) {
    rows.push(`| \`${u}\` | _retired: ${retired.find((r) => r.from === u).reason}_ | retired |`);
    continue;
  }
  const to = map.get(u) || [];
  const st = [...new Set(to.map((t) => (pages.find((p) => p.path === t) || utility.find((x) => x.path === t) || { status: t === '/' ? 'rebuild' : '?' }).status))].join(', ');
  rows.push(`| \`${u}\` | ${to.map((t) => `\`${t}\``).join(' + ') || '**UNMAPPED**'} | ${st} |`);
}
rows.push('');
rows.push('Merges worth noting: Top 10 Swimmers/Swims/Relays and Team Records collapse from 12 live pages to 6 (SCY/LCM become a toggle on one page). `/practice-groups` and `/offerings` anchors become real pages. The two IMX pages become one hub. `/mobility` + `/pre-practice-mobility` and `/strength` + `/shoulder-strength` each merge.');
rows.push('');

rows.push('## 2. Pages and components pulled out of the old structure');
rows.push('');
rows.push('| Item | Where it lives today | Where it goes | Saved HTML |');
rows.push('|---|---|---|---|');
const comps = [
  ['Top 10 / records / relay boards (12 HTML files + JSON)', 'GitHub Pages: `jpmerchant/nsea-swim-boards`, iframed in BUILD', 'Top Times and Team Records tools. Embedded by URL now; can be absorbed natively later', '`legacy/tools/boards/`'],
  ['IMX / IMR board', 'GitHub Pages (boards repo)', '`/times/standards/imx-imr/progress/`', '`legacy/tools/boards/imx-imr-scy.html`'],
  ['Events calendar (+ `/admin`, `/widget`, .ics feeds)', 'GitHub Pages: `jpmerchant/nsea-events` at `events.nseaswimteam.com`', '`/meets/calendar/` and the home-page deadlines widget. Edited in the admin console (Events & Calendar), which publishes to the same repo', '`legacy/tools/events/`'],
  ['Check My Time (standards explorer)', 'BUILD `/check-my-time`', '`/times/standards/check-my-time/` (featured in the Times & Records menu)', '`legacy/tools/standards/nsea-standards-explorer.html`'],
  ['SCY comparison (by age group / all ages)', 'BUILD pages', '`/times/standards/compare-*`', '`legacy/tools/standards/`'],
  ['NC Age Group + Senior standards embeds', 'BUILD pages', '`/times/standards/nc-*`', '`legacy/tools/standards/`'],
  ['New board additions embed', 'BUILD `/2025---26-updates`', '`/times/top-times/new-additions/`', '`legacy/tools/standards/`'],
  ['Newsletter issues', 'BUILD `/current`, `/newsletters`', '`/families/newsletter/`', '`legacy/content/newsletters/`'],
  ['Meet recaps', 'Newsletter inserts', 'New `/meets/recaps/` section', '`legacy/content/recaps/`'],
  ['Caffeine guide + research', 'BUILD pages', '`/training/same/education/`', '`legacy/content/guides/`'],
  ['RPE handout, Group Flow', 'BUILD `/rpe-information`', '`/training/rpe/`', '`legacy/content/guides/`'],
  ['Countdown widget ("STAR Triad Tropic")', 'BUILD home page', 'Not carried over. The deadlines widget does the same job and is data-driven', '-'],
  ['Upcoming-deadlines widget', 'BUILD home page (iframe of `events.nseaswimteam.com/widget/`)', 'Home page, same iframe', '`legacy/tools/events/`'],
  ['Partner logo bar', 'BUILD home page + footer', 'Footer (`src/components/Footer.astro`, data in `SITE.partners`)', '-'],
  ['Coach’s Corner post', 'BUILD home page', 'Staff blog: home-page tile + `/training/coaches-corner/`, written in the admin console (coach role, review then publish)', '-'],
  ['Captyn Login button', 'BUILD header', 'Header CTA + mobile menu', '-'],
  ['Carpool board', 'Was a Jotform behind a BUILD password page', '`/families/carpool/` (Cloudflare Worker + D1, invite-link sign-in; managed in the admin console)', '-'],
];
for (const c of comps) rows.push(`| ${c.join(' | ')} |`);
rows.push('');
rows.push('Deliberately **not** pulled: per-athlete biomechanics reports (individual swimmers’ data, which should never be on a public site), and the Fall 2026 internal documents in the NSEA Swim folder.');
rows.push('');

rows.push('### Held back (built, not published)');
rows.push('');
rows.push('These pages are excluded from the menu and the build until the owner releases them (`held` in `src/data/site.mjs`).');
rows.push('');
for (const h of held) rows.push(`- \`${h.path}\` — ${h.title}${h.legacy ? ' (' + h.legacy.join(', ') + ')' : ''}`);
rows.push('');

rows.push('## 3. Full page list for the new site');
rows.push('');
rows.push('| New path | Title | Type | Status | Replaces | Source files |');
rows.push('|---|---|---|---|---|---|');
for (const p of pages) {
  rows.push(`| \`${p.path}\` | ${p.title}${p.gated ? ' 🔒' : ''} | ${p.type} | ${p.status} | ${(p.from || []).map((f) => `\`${f}\``).join(', ') || '-'} | ${(p.legacy || []).join('; ') || '-'} |`);
}
rows.push('');
if (unmapped.length) {
  rows.push('## UNMAPPED live URLs');
  for (const u of unmapped) rows.push(`- ${u}`);
}
writeFileSync('MIGRATION.md', rows.join('\n') + '\n');

// CSV for a spreadsheet
const csv = ['new_path,title,type,status,replaces,source_files'];
for (const p of pages) csv.push([p.path, p.title, p.type, p.status, (p.from || []).join(' | '), (p.legacy || []).join(' | ')].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
writeFileSync('migration.csv', csv.join('\n') + '\n');

// Paths for the Cloudflare Access policy
writeFileSync('gated-paths.txt', pages.filter((p) => p.gated).map((p) => p.path + '*').join('\n') + '\n');

console.log(`live URLs ${live.length}, new pages ${pages.length}, unmapped ${unmapped.length}`);
if (unmapped.length) { console.log(unmapped.join('\n')); process.exitCode = 1; }
