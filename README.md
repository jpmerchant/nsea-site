# NSEA Swim: new site (pre-production)

A ground-up rebuild of nseaswimteam.com as a static Astro site on Cloudflare (Workers static assets). **The live BUILD site is untouched.** This runs beside it until you decide to switch.

## How it is organised

One file, `src/data/site.mjs`, lists every page. It drives the menu, every landing hub, breadcrumbs, the tool library and the migration report. To add a page or a tool you add one line there.

Menu rules that keep it from sprawling again:

1. **Six top-level menus** (About, Programs, Family Guide, Meets, Times & Records, Training), plus two buttons (Free Assessment, Captyn Login).
2. **Dropdowns show hubs, hubs show pages.** A dropdown lists only direct children (max 6), plus any page flagged `feature` (Check My Time, Calendar, Free Assessment). Nothing deeper ever appears in a menu.
3. **Every group is a real landing page** (`type: 'hub'`), so a hub like Time Standards is a page families can land on, not just a menu label.
4. **SCY/LCM is a toggle, not two pages.** Top 10 Swimmers, Top 10 Swims, Top 5 Relays, Individual Records and Relay Records each have one page with a course switch. That takes 12 live pages down to 5.
5. **One home per page.** How-tos live under Family Guide and are cross-listed in Meets (`also`), so there is never a duplicate to keep in sync.
6. **Tools are tagged.** Anything with `type: 'tool'` shows up automatically in `/tools/` (the tool library), linked from the footer and home page.

## Run it

```
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
npm run report     # regenerates MIGRATION.md, migration.csv, gated-paths.txt
```

Preview builds show a "PREVIEW BUILD" bar and status chips on every card (Ready / Pull / Rebuild / New), and are hidden from search engines. Set `PUBLIC_LIVE=true` at go-live to remove all of that.

## Adding content

- **A page:** create `src/content/<same path>.md`, for example `src/content/about/who-we-are.md` (included as a sample). It replaces the placeholder panel automatically.
- **A tool:** add `embed: 'https://...'` (or `variants: { SCY, LCM }`) to its registry entry.
- **Something custom:** add an `.astro` file at the same path in `src/pages/`; it wins over the generic template.

## Pulling the rest of the old site

The BUILD pages we did not build ourselves (About, Coaching Staff, FAQ and so on) can only be read from the live site. `scripts/pull-build-pages.browser.js` does that in your own browser in about a minute. Instructions are at the top of the file. Drop the downloaded `nsea-build-pages.json` into `legacy/` and the content can be converted page by page.

## Deploying on Cloudflare

Cloudflare now creates new projects as **Workers with static assets** (the old Pages flow is folded into it). That is what this repo is set up for:

- `wrangler.jsonc` names the project `nsea-site` and points `assets.directory` at `./dist`, so there is no output-directory field to fill in on the dashboard.
- `.node-version` pins Node 22 (Cloudflare's default is newer; 22 is what this was built and tested on).
- In the project's **Settings > Build**: build command `npm run build`, deploy command `npx wrangler deploy` (the default). Leave root directory blank.
- Every push to `main` builds and deploys.

## Staying live while this is built (parallel run)

**Do not recreate the existing repos.** `nsea-swim-boards` and `nsea-events` keep serving exactly what BUILD embeds today, and this site embeds the same URLs, so there is one copy of the data and one update workflow. Don't rename or move files in those repos, or change their Pages settings, until after go-live.

**The new site gets its own new repo (`nsea-site`) and its own Cloudflare project.**

| Stage | URL | Needs DNS? |
|---|---|---|
| Building | `nsea-site.<your-account>.workers.dev` (automatic) | No |
| Sharing with the board | `next.nseaswimteam.com` (optional friendly URL) | One CNAME |
| Live | `www.nseaswimteam.com` | Switch the record from BUILD |

A subdomain is optional. Use the free `workers.dev` address Cloudflare assigns while you build, and add `next.` only if you want a nicer address to share. To keep it private, put Cloudflare Access in front of it; the free tier covers you and the board.

**Go-live checklist**

1. Lower the DNS TTL on `www` a day ahead.
2. Set `PUBLIC_LIVE=true` on the production build and replace `public/robots.txt`.
3. Add `www.nseaswimteam.com` as a custom domain on the Worker and switch the DNS record.
4. Keep the BUILD subscription for a couple of weeks. Rollback is pointing the record back.
5. **Leave `events.nseaswimteam.com` where it is.** Families subscribe to its calendar feeds; moving it would silently break their calendars.
6. Apex domain (`nseaswimteam.com`): a bare domain needs Cloudflare DNS. Either move the nameservers to Cloudflare at go-live or keep `www` as the canonical address.

**Gated pages** (carpool board for now) are listed in `gated-paths.txt`; point one Cloudflare Access policy at those paths. Check the free tier's user cap against your ~60 families first.

## Site map (106 pages)

`▸` hub &nbsp; `⚙` tool &nbsp; `↗` external link &nbsp; `·` page

```
▸ About   /about/
  · Who We Are   /about/who-we-are/
  · Coaching Staff   /about/coaching-staff/
  · Practice Locations   /about/practice-locations/
    · Parking at Earl Jackson Pool   /about/practice-locations/parking/
  · Alumni   /about/alumni/
    · College Swimmers   /about/alumni/college-swimmers/
  · Safe Sport   /about/safe-sport/
  · Contact & Who to Ask   /about/contact/
▸ Programs   /programs/
  ▸ Practice Groups   /programs/practice-groups/
    · Splash   /programs/practice-groups/splash/
    · Tidepool   /programs/practice-groups/tidepool/
    · Riptide   /programs/practice-groups/riptide/
    · Breakers   /programs/practice-groups/breakers/
    · Surge   /programs/practice-groups/surge/
    · Senior   /programs/practice-groups/senior/
  · Practice Schedule   /programs/schedule/
  ▸ Prep Programs & Clinics   /programs/clinics/
    · High School Prep   /programs/clinics/high-school-prep/
    · High School Skills Clinics   /programs/clinics/high-school-skills/
    · Summer League Prep   /programs/clinics/summer-league-prep/
    · Summer League Skills Clinics   /programs/clinics/summer-league-skills/
  · Fees   /programs/fees/
  · Scholarships & Financial Assistance   /programs/financial-assistance/
  ↗ Free Assessment   /programs/join/
▸ Family Guide   /families/
  ▸ New to Swimming   /families/new-families/
    · FAQ   /families/new-families/faq/
    · Glossary   /families/new-families/glossary/
    · Fast Facts on Water Safety   /families/new-families/water-safety/
    · Books   /families/new-families/books/
    ↗ USA Swimming Parents Page   /families/new-families/usa-swimming-parents/
  ▸ How-To Guides   /families/how-to/
    · Captyn Message Archive   /families/how-to/captyn-messages/
    · Register for an Event   /families/how-to/register-for-an-event/
    · Opt In to Meets   /families/how-to/opt-in-to-meets/
    · Opt Out of Meets   /families/how-to/opt-out-of-meets/
    · Session & Season Opt-Out   /families/how-to/session-opt-out/
  ▸ Newsletter   /families/newsletter/
    · Current Issue   /families/newsletter/current/
    · Newsletter Archive   /families/newsletter/archive/
  ▸ Team Store   /families/team-store/
    ↗ Apparel Store   /families/team-store/apparel/
    ↗ Cap Order Form   /families/team-store/caps/
    ↗ Practice Equipment Order   /families/team-store/practice-equipment/
    · Equipment by Group   /families/team-store/group-equipment/
    ↗ Tech Suit Order Form   /families/team-store/tech-suit-order/
    · Tech Suit Guide   /families/team-store/tech-suit-guide/
  · Carpool Board 🔒   /families/carpool/
▸ Meets   /meets/
  ⚙ Calendar of Events   /meets/calendar/
  · Guide to Swim Meets   /meets/guide/
  · Meet Uniform   /meets/uniform/
  · Meet Pools   /meets/pools/
  ▸ Meet Recaps   /meets/recaps/
    · October Suprise 2026   /meets/recaps/october-suprise-2026/
    · Fall Frenzy 2026 (BAC v NSEA)   /meets/recaps/fall-frenzy-2026/
▸ Times & Records   /times/
  ▸ Time Standards   /times/standards/
    · Understanding Time Standards   /times/standards/understanding/
    ⚙ Check My Time   /times/standards/check-my-time/
    ⚙ SCY Comparison by Age Group   /times/standards/compare-by-age-group/
    ⚙ SCY Comparison, All Ages   /times/standards/compare-all-ages/
    ⚙ NC Age Group Championships   /times/standards/nc-age-group/
    ⚙ NC Senior Championships   /times/standards/nc-senior/
    · National Meet Qualifiers   /times/standards/national-qualifiers/
    · About Power Points   /times/standards/power-points/
    ▸ IMX / IMR   /times/standards/imx-imr/
      · About IMX / IMR   /times/standards/imx-imr/about/
      ⚙ IMX / IMR Progress Board   /times/standards/imx-imr/progress/
  ▸ Top Times   /times/top-times/
    ⚙ Top 10 Swimmers   /times/top-times/swimmers/
    ⚙ Top 10 Swims   /times/top-times/swims/
    ⚙ Top 5 Relays   /times/top-times/relays/
    ⚙ New Board Additions   /times/top-times/new-additions/
  ▸ Team Records   /times/records/
    ⚙ Record Holders   /times/records/holders/
    ⚙ Individual Records   /times/records/individual/
    ⚙ Relay Records   /times/records/relays/
    · Records Set This Season   /times/records/this-season/
  ▸ Achievements by Season   /times/achievements/
    · 2025 – 2026   /times/achievements/2025-26/
    · 2024 – 2025   /times/achievements/2024-25/
    · 2023 – 2024   /times/achievements/2023-24/
    · 2022 – 2023   /times/achievements/2022-23/
▸ Training   /training/
  · Training Zone Cheat Sheet   /training/zones/
  · RPE & Session RPE   /training/rpe/
  ▸ S.A.M.E.   /training/same/
    · Strength   /training/same/strength/
    · Agility   /training/same/agility/
    · Mobility   /training/same/mobility/
    · Foam Rolling   /training/same/foam-rolling/
    ▸ Education   /training/same/education/
      · Caffeine & Energy Drinks: A Quick Guide   /training/same/education/caffeine-guide/
      · Caffeine & Energy Drinks: The Research   /training/same/education/caffeine-research/
  (Held back, not published: Biomechanics section and three education pages. See `held` in src/data/site.mjs.)
```

See `MIGRATION.md` for what replaces what, the full page list with sources, and the list of components that moved.

## Admin console

`/admin/` is the single admin console (Worker API in `worker/admin.mjs`, UI in `src/components/AdminConsole.astro`). One login, per-module roles (owner, carpool, events, content) and an audit log. Sign-in is by single-use admin links until Cloudflare Access is switched on: create an Access application covering `/admin*` and `/api/admin/*`, then put its team domain and AUD tag in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`. Once those are set, link sign-in is turned off and the Access email must match a row in the Admins list. Add `Disallow: /admin/` to the live `robots.txt` at go-live. Schema changes are in `migrations/` and are applied to the D1 database by hand.
