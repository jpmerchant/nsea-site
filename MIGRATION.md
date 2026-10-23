# NSEA Swim site rebuild: migration inventory

_Generated from `src/data/site.mjs` by `npm run report`. 72 live URLs on nseaswimteam.com; 106 pages in the new structure._

Status key: **ready** = already built, HTML saved in `legacy/` · **pull** = lives on BUILD, content must be pulled · **rebuild** = exists today but merged/redesigned · **new** = does not exist yet.

Counts: rebuild 16 · done 37 · pull 21 · ready 20 · new 12

## 1. Live page -> new location

| Live page (nseaswimteam.com) | New path | Status |
|---|---|---|
| `/top-10-swims---scy` | `/times/top-times/` + `/times/top-times/swims/` | rebuild, ready |
| `/records-set-in-2025---26` | `/times/records/this-season/` | done |
| `/2025---26-updates` | `/times/top-times/new-additions/` | done |
| `/top-10-swims--lcm` | `/times/top-times/` + `/times/top-times/swims/` | rebuild, ready |
| `/offerings` | `/programs/clinics/` + `/programs/clinics/high-school-prep/` + `/programs/clinics/high-school-skills/` + `/programs/clinics/summer-league-prep/` + `/programs/clinics/summer-league-skills/` | done |
| `/check-my-time` | `/times/standards/check-my-time/` | done |
| `/2023---2024` | `/times/achievements/2023-24/` | done |
| `/` | `/` | rebuild |
| `/top-times---lcm` | `/times/top-times/` + `/times/top-times/swimmers/` | rebuild, ready |
| `/FAQ` | `/families/new-families/faq/` | pull |
| `/privacy-policy` | `/privacy/` | pull |
| `/fee-structure` | `/programs/fees/` | pull |
| `/shoulder-strength` | `/training/same/strength/` | pull |
| `/alumni` | `/about/alumni/` | done |
| `/2022---23-achievements` | `/times/achievements/2022-23/` | done |
| `/books` | `/families/new-families/books/` | pull |
| `/ejp-parking` | `/about/practice-locations/parking/` | done |
| `/who-to-contact` | `/about/contact/` | done |
| `/scy---relay-team-records` | `/times/records/relays/` | ready |
| `/top-5-relays---scy` | `/times/top-times/` + `/times/top-times/relays/` | rebuild, ready |
| `/top-times` | `/times/top-times/` + `/times/top-times/swimmers/` | rebuild, ready |
| `/power-points-explained` | `/times/standards/power-points/` | done |
| `/captyn-message-archive` | `/families/how-to/captyn-messages/` | pull |
| `/2025---2026` | `/times/achievements/2025-26/` | done |
| `/scholarships-and-financial-assistance` | `/programs/financial-assistance/` | done |
| `/glossary` | `/families/new-families/glossary/` | pull |
| `/education` | `/training/same/education/` | rebuild |
| `/fast-facts-on-water-safety` | `/families/new-families/water-safety/` | pull |
| `/coaching-staff` | `/about/coaching-staff/` | done |
| `/practice-equipment` | `/families/team-store/group-equipment/` | pull |
| `/general-practice-schedule` | `/programs/schedule/` | done |
| `/practice-groups` | `/programs/` + `/programs/practice-groups/` + `/programs/practice-groups/splash/` + `/programs/practice-groups/tidepool/` + `/programs/practice-groups/riptide/` + `/programs/practice-groups/breakers/` + `/programs/practice-groups/surge/` + `/programs/practice-groups/senior/` | rebuild, done |
| `/college-swimmers` | `/about/alumni/college-swimmers/` | done |
| `/national--meet--qualifiers` | `/times/standards/national-qualifiers/` | done |
| `/calendar` | `/meets/` + `/meets/calendar/` | rebuild, ready |
| `/opt-out---intent-information` | `/families/how-to/session-opt-out/` | pull |
| `/2024---2025` | `/times/achievements/2024-25/` | done |
| `/about-us` | `/about/` + `/about/who-we-are/` | rebuild, done |
| `/about-swim-meets` | `/meets/guide/` | pull |
| `/time-standards` | `/times/standards/` + `/times/standards/understanding/` | rebuild, done |
| `/practice-locations` | `/about/practice-locations/` | done |
| `/meet-pools` | `/meets/pools/` | pull |
| `/safe-sport` | `/about/safe-sport/` | done |
| `/newsletters` | `/families/newsletter/` + `/families/newsletter/archive/` | rebuild, ready |
| `/team-records---lcm` | `/times/records/individual/` | ready |
| `/imx-progress` | `/times/standards/imx-imr/` + `/times/standards/imx-imr/about/` | rebuild, done |
| `/current` | `/families/newsletter/` + `/families/newsletter/current/` | rebuild, ready |
| `/lcm---relay-team-records` | `/times/records/relays/` | ready |
| `/top-5-relays---lcm` | `/times/top-times/` + `/times/top-times/relays/` | rebuild, ready |
| `/nc-age-group-championships` | `/times/standards/nc-age-group/` | done |
| `/nc-senior-championships` | `/times/standards/nc-senior/` | done |
| `/opt-out-of-meets` | `/families/how-to/opt-out-of-meets/` | pull |
| `/opt-in-to-meets` | `/families/how-to/opt-in-to-meets/` | pull |
| `/register-for-an-event` | `/families/how-to/register-for-an-event/` | pull |
| `/team-records---scy` | `/times/records/individual/` | ready |
| `/team-record-holders` | `/times/records/holders/` | ready |
| `/tech-suit-info` | `/families/team-store/tech-suit-guide/` | pull |
| `/training-zone-cheat-sheet` | `/training/zones/` | pull |
| `/swim-suit-guide` | `/meets/uniform/` | pull |
| `/test-page` | _retired: Test page_ | retired |
| `/imr-/-imx-progress` | `/times/standards/imx-imr/` + `/times/standards/imx-imr/progress/` | rebuild, ready |
| `/agility` | `/training/same/agility/` | pull |
| `/rpe-information` | `/training/rpe/` | pull |
| `/caffeine---energy-drinks--a-quick-guide` | `/training/same/education/caffeine-guide/` | ready |
| `/caffeine---energy-drinks--research` | `/training/same/education/caffeine-research/` | ready |
| `/mobility` | `/training/same/mobility/` | pull |
| `/strength` | `/training/same/strength/` | pull |
| `/foam-rolling` | `/training/same/foam-rolling/` | pull |
| `/scy---comparison-by-age-group` | `/times/standards/compare-by-age-group/` | done |
| `/scy---comparison-all-ages` | `/times/standards/compare-all-ages/` | done |
| `/pre-practice-mobility` | `/training/same/mobility/` | pull |
| `/coming-soon` | _retired: Placeholder; replaced by Coach’s Corner on the home page_ | retired |

Merges worth noting: Top 10 Swimmers/Swims/Relays and Team Records collapse from 12 live pages to 6 (SCY/LCM become a toggle on one page). `/practice-groups` and `/offerings` anchors become real pages. The two IMX pages become one hub. `/mobility` + `/pre-practice-mobility` and `/strength` + `/shoulder-strength` each merge.

## 2. Pages and components pulled out of the old structure

| Item | Where it lives today | Where it goes | Saved HTML |
|---|---|---|---|
| Top 10 / records / relay boards (12 HTML files + JSON) | GitHub Pages: `jpmerchant/nsea-swim-boards`, iframed in BUILD | Top Times and Team Records tools. Embedded by URL now; can be absorbed natively later | `legacy/tools/boards/` |
| IMX / IMR board | GitHub Pages (boards repo) | `/times/standards/imx-imr/progress/` | `legacy/tools/boards/imx-imr-scy.html` |
| Events calendar (+ `/admin`, `/widget`, .ics feeds) | GitHub Pages: `jpmerchant/nsea-events` at `events.nseaswimteam.com` | `/meets/calendar/` and the home-page deadlines widget | `legacy/tools/events/` |
| Check My Time (standards explorer) | BUILD `/check-my-time` | `/times/standards/check-my-time/` (featured in the Times & Records menu) | `legacy/tools/standards/nsea-standards-explorer.html` |
| SCY comparison (by age group / all ages) | BUILD pages | `/times/standards/compare-*` | `legacy/tools/standards/` |
| NC Age Group + Senior standards embeds | BUILD pages | `/times/standards/nc-*` | `legacy/tools/standards/` |
| New board additions embed | BUILD `/2025---26-updates` | `/times/top-times/new-additions/` | `legacy/tools/standards/` |
| Newsletter issues | BUILD `/current`, `/newsletters` | `/families/newsletter/` | `legacy/content/newsletters/` |
| Meet recaps | Newsletter inserts | New `/meets/recaps/` section | `legacy/content/recaps/` |
| Caffeine guide + research | BUILD pages | `/training/same/education/` | `legacy/content/guides/` |
| RPE handout, Group Flow | BUILD `/rpe-information` | `/training/rpe/` | `legacy/content/guides/` |
| Countdown widget ("STAR Triad Tropic") | BUILD home page | Not carried over. The deadlines widget does the same job and is data-driven | - |
| Upcoming-deadlines widget | BUILD home page (iframe of `events.nseaswimteam.com/widget/`) | Home page, same iframe | `legacy/tools/events/` |
| Partner logo bar | BUILD home page + footer | Footer (`src/components/Footer.astro`, data in `SITE.partners`) | - |
| Coach’s Corner post | BUILD home page | Markdown feed on the home page | - |
| Captyn Login button | BUILD header | Header CTA + mobile menu | - |
| Carpool board (planned) | Not built | `/families/carpool/` (gated) | - |

Deliberately **not** pulled: per-athlete biomechanics reports (individual swimmers’ data, which should never be on a public site), and the Fall 2026 internal documents in the NSEA Swim folder.

## 3. Full page list for the new site

| New path | Title | Type | Status | Replaces | Source files |
|---|---|---|---|---|---|
| `/about/` | About | hub | rebuild | `/about-us` | - |
| `/about/who-we-are/` | Who We Are | page | done | `/about-us` | - |
| `/about/coaching-staff/` | Coaching Staff | page | done | `/coaching-staff` | - |
| `/about/practice-locations/` | Practice Locations | page | done | `/practice-locations` | - |
| `/about/practice-locations/parking/` | Parking at Earl Jackson Pool | page | done | `/ejp-parking` | assets: 2025_26_TEAM_PARKING.png |
| `/about/alumni/` | Alumni | page | done | `/alumni` | - |
| `/about/alumni/college-swimmers/` | College Swimmers | page | done | `/college-swimmers` | - |
| `/about/safe-sport/` | Safe Sport | page | done | `/safe-sport` | - |
| `/about/contact/` | Contact & Who to Ask | page | done | `/who-to-contact` | - |
| `/programs/` | Programs | hub | rebuild | `/practice-groups` | - |
| `/programs/practice-groups/` | Practice Groups | hub | done | `/practice-groups` | - |
| `/programs/practice-groups/splash/` | Splash | page | done | `/practice-groups#Splash` | - |
| `/programs/practice-groups/tidepool/` | Tidepool | page | done | `/practice-groups#Tidepool` | - |
| `/programs/practice-groups/riptide/` | Riptide | page | done | `/practice-groups#Riptide` | - |
| `/programs/practice-groups/breakers/` | Breakers | page | done | `/practice-groups#Breakers` | - |
| `/programs/practice-groups/surge/` | Surge | page | done | `/practice-groups#Surge` | - |
| `/programs/practice-groups/senior/` | Senior | page | done | `/practice-groups#SeniorSurge` | Practice Group Documents/senior surge requirments.docx |
| `/programs/schedule/` | Practice Schedule | page | done | `/general-practice-schedule` | - |
| `/programs/clinics/` | Prep Programs & Clinics | hub | done | `/offerings` | - |
| `/programs/clinics/high-school-prep/` | High School Prep | page | done | `/offerings#HighSchoolPrep` | - |
| `/programs/clinics/high-school-skills/` | High School Skills Clinics | page | done | `/offerings#HighSchoolSkillsClinics` | - |
| `/programs/clinics/summer-league-prep/` | Summer League Prep | page | done | `/offerings#SummerLeaguePrep` | - |
| `/programs/clinics/summer-league-skills/` | Summer League Skills Clinics | page | done | `/offerings#SummerLeagueSkillsClinics` | - |
| `/programs/fees/` | Fees | page | pull | `/fee-structure` | 2026 - 27/2026 - 2027 Fee Summary.docx |
| `/programs/financial-assistance/` | Scholarships & Financial Assistance | page | done | `/scholarships-and-financial-assistance` | - |
| `/programs/join/` | Free Assessment | link | ready | - | - |
| `/families/` | Family Guide | hub | rebuild | - | - |
| `/families/new-families/` | New to Swimming | hub | new | - | - |
| `/families/new-families/faq/` | FAQ | page | pull | `/FAQ` | - |
| `/families/new-families/glossary/` | Glossary | page | pull | `/glossary` | - |
| `/families/new-families/water-safety/` | Fast Facts on Water Safety | page | pull | `/fast-facts-on-water-safety` | - |
| `/families/new-families/books/` | Books | page | pull | `/books` | - |
| `/families/new-families/usa-swimming-parents/` | USA Swimming Parents Page | link | ready | - | - |
| `/families/how-to/` | How-To Guides | hub | rebuild | - | - |
| `/families/how-to/captyn-messages/` | Captyn Message Archive | page | pull | `/captyn-message-archive` | - |
| `/families/how-to/register-for-an-event/` | Register for an Event | page | pull | `/register-for-an-event` | - |
| `/families/how-to/opt-in-to-meets/` | Opt In to Meets | page | pull | `/opt-in-to-meets` | - |
| `/families/how-to/opt-out-of-meets/` | Opt Out of Meets | page | pull | `/opt-out-of-meets` | - |
| `/families/how-to/session-opt-out/` | Session & Season Opt-Out | page | pull | `/opt-out---intent-information` | 2026 - 27/2026 - 27 Session and Season Opt Out.odt |
| `/families/newsletter/` | Newsletter | hub | rebuild | `/current`, `/newsletters` | - |
| `/families/newsletter/current/` | Current Issue | page | ready | `/current` | content/newsletters/nsea-newsletter-10-17-2026.html |
| `/families/newsletter/archive/` | Newsletter Archive | page | ready | `/newsletters` | content/newsletters/nsea-newsletter-10-03-2026.html |
| `/families/team-store/` | Team Store | hub | rebuild | - | - |
| `/families/team-store/apparel/` | Apparel Store | link | ready | - | - |
| `/families/team-store/caps/` | Cap Order Form | link | ready | - | - |
| `/families/team-store/practice-equipment/` | Practice Equipment Order | link | ready | - | - |
| `/families/team-store/group-equipment/` | Equipment by Group | page | pull | `/practice-equipment` | NSEA_Required_Practice_Equipment.pdf |
| `/families/team-store/tech-suit-order/` | Tech Suit Order Form | link | ready | - | - |
| `/families/team-store/tech-suit-guide/` | Tech Suit Guide | page | pull | `/tech-suit-info` | FINIS Suit Guide.pdf |
| `/families/carpool/` | Carpool Board 🔒 | page | new | - | - |
| `/meets/` | Meets | hub | rebuild | `/calendar` | - |
| `/meets/calendar/` | Calendar of Events | tool | ready | `/calendar` | tools/events/ (site-src) |
| `/meets/guide/` | Guide to Swim Meets | page | pull | `/about-swim-meets` | Project: claude/nsea-guide-to-swim-meets.html |
| `/meets/uniform/` | Meet Uniform | page | pull | `/swim-suit-guide` | - |
| `/meets/pools/` | Meet Pools | page | pull | `/meet-pools` | - |
| `/meets/recaps/` | Meet Recaps | hub | new | - | content/recaps/ |
| `/meets/recaps/october-suprise-2026/` | October Suprise 2026 | page | ready | - | content/recaps/meet-recap-october-suprise-2026.html; content/recaps/october-suprise-2026-analysis.html |
| `/meets/recaps/fall-frenzy-2026/` | Fall Frenzy 2026 (BAC v NSEA) | page | ready | - | Project: claude/newsletter-inserts/meet-recap-fall-frenzy-2026.html |
| `/times/` | Times & Records | hub | rebuild | - | - |
| `/times/standards/` | Time Standards | hub | rebuild | `/time-standards` | - |
| `/times/standards/understanding/` | Understanding Time Standards | page | done | `/time-standards` | - |
| `/times/standards/check-my-time/` | Check My Time | tool | done | `/check-my-time` | tools/standards/nsea-standards-explorer.html |
| `/times/standards/compare-by-age-group/` | SCY Comparison by Age Group | tool | done | `/scy---comparison-by-age-group` | tools/standards/NSEA SCY Time Standards Comparison.html |
| `/times/standards/compare-all-ages/` | SCY Comparison, All Ages | tool | done | `/scy---comparison-all-ages` | tools/standards/NSEA SCY Time Standards - All Ages Ranked.html |
| `/times/standards/nc-age-group/` | NC Age Group Championships | tool | done | `/nc-age-group-championships` | tools/standards/ncs-ag-champs-standards-embed.html |
| `/times/standards/nc-senior/` | NC Senior Championships | tool | done | `/nc-senior-championships` | tools/standards/ncs-senior-standards-embed.html |
| `/times/standards/national-qualifiers/` | National Meet Qualifiers | page | done | `/national--meet--qualifiers` | - |
| `/times/standards/power-points/` | About Power Points | page | done | `/power-points-explained` | - |
| `/times/standards/imx-imr/` | IMX / IMR | hub | rebuild | `/imx-progress`, `/imr-/-imx-progress` | - |
| `/times/standards/imx-imr/about/` | About IMX / IMR | page | done | `/imx-progress` | - |
| `/times/standards/imx-imr/progress/` | IMX / IMR Progress Board | tool | ready | `/imr-/-imx-progress` | tools/boards/imx-imr-scy.html |
| `/times/top-times/` | Top Times | hub | rebuild | `/top-times`, `/top-times---lcm`, `/top-10-swims---scy`, `/top-10-swims--lcm`, `/top-5-relays---scy`, `/top-5-relays---lcm` | - |
| `/times/top-times/swimmers/` | Top 10 Swimmers | tool | ready | `/top-times`, `/top-times---lcm` | tools/boards/top10-performers-*.html |
| `/times/top-times/swims/` | Top 10 Swims | tool | ready | `/top-10-swims---scy`, `/top-10-swims--lcm` | tools/boards/top10-performances-*.html |
| `/times/top-times/relays/` | Top 5 Relays | tool | ready | `/top-5-relays---scy`, `/top-5-relays---lcm` | tools/boards/top5-relays-*.html |
| `/times/top-times/new-additions/` | New Board Additions | tool | done | `/2025---26-updates` | tools/standards/NSEA New Board Additions - Site Embed.html |
| `/times/records/` | Team Records | hub | rebuild | - | - |
| `/times/records/holders/` | Record Holders | tool | ready | `/team-record-holders` | tools/boards/records.html |
| `/times/records/individual/` | Individual Records | tool | ready | `/team-records---scy`, `/team-records---lcm` | tools/boards/records-traditional-*.html |
| `/times/records/relays/` | Relay Records | tool | ready | `/scy---relay-team-records`, `/lcm---relay-team-records` | tools/boards/records-relays-*.html |
| `/times/records/this-season/` | Records Set This Season | tool | done | `/records-set-in-2025---26` | - |
| `/times/achievements/` | Achievements by Season | hub | rebuild | - | - |
| `/times/achievements/2025-26/` | 2025 – 2026 | page | done | `/2025---2026` | - |
| `/times/achievements/2024-25/` | 2024 – 2025 | page | done | `/2024---2025` | - |
| `/times/achievements/2023-24/` | 2023 – 2024 | tool | done | `/2023---2024` | - |
| `/times/achievements/2022-23/` | 2022 – 2023 | tool | done | `/2022---23-achievements` | - |
| `/training/` | Training | hub | rebuild | - | - |
| `/training/zones/` | Training Zone Cheat Sheet | page | pull | `/training-zone-cheat-sheet` | NSEASwim-KB-Repo/NSEA_Training_Zones_Cheat_Sheet.pdf |
| `/training/rpe/` | RPE & Session RPE | page | pull | `/rpe-information` | content/guides/rpe-session-rpe-handout.html; Project: claude/rpe-session-rpe-reference.md |
| `/training/same/` | S.A.M.E. | hub | rebuild | - | - |
| `/training/same/strength/` | Strength | page | pull | `/strength`, `/shoulder-strength` | Project: claude/nsea-shoulder-care-guide.html |
| `/training/same/agility/` | Agility | page | pull | `/agility` | - |
| `/training/same/mobility/` | Mobility | page | pull | `/mobility`, `/pre-practice-mobility` | Project: claude/nsea-swimmer-mobility-routines.html; Project: claude/nsea-pre-practice-guide.html |
| `/training/same/foam-rolling/` | Foam Rolling | page | pull | `/foam-rolling` | Project: claude/nsea-foam-roller-guide.html |
| `/training/same/education/` | Education | hub | rebuild | `/education` | - |
| `/training/same/education/caffeine-guide/` | Caffeine & Energy Drinks: A Quick Guide | page | ready | `/caffeine---energy-drinks--a-quick-guide` | content/guides/caffeine-guide-for-nsea-families_1.html |
| `/training/same/education/caffeine-research/` | Caffeine & Energy Drinks: The Research | page | ready | `/caffeine---energy-drinks--research` | content/guides/caffeine-youth-athletes-research.html; Project: claude/nsea-research-caffeine-and-youth-athletes.html |
| `/training/same/education/specialization-ages/` | When to Specialize | page | new | - | Project: claude/specialization-ages-swimming-reference.md |
| `/training/same/education/race-pacing/` | Race Pacing | page | new | - | Project: claude/race-pacing-synthesis.md |
| `/training/same/education/sodium-bicarbonate/` | Sodium Bicarbonate & Young Swimmers | page | new | - | Project: claude/sodium-bicarbonate-youth-swimming-reference.md |
| `/training/biomechanics/` | Biomechanics | hub | new | - | Project: claude/*-biomechanics-reference.md; Project: claude/nsea-tritonwear-eo-metrics-*.html |
| `/training/biomechanics/metrics/` | Reading the Metrics | page | new | - | Project: claude/nsea-tritonwear-eo-metrics-one-pager.html; Project: claude/nsea-tritonwear-eo-metrics-by-stroke.html |
| `/training/biomechanics/freestyle/` | Freestyle | page | new | - | Project: claude/freestyle-biomechanics-reference.md |
| `/training/biomechanics/backstroke/` | Backstroke | page | new | - | Project: claude/backstroke-biomechanics-reference.md |
| `/training/biomechanics/butterfly/` | Butterfly | page | new | - | Project: claude/butterfly-biomechanics-reference.md |
| `/training/biomechanics/breaststroke/` | Breaststroke | page | new | - | Project: claude/breaststroke-biomechanics-reference.md |

