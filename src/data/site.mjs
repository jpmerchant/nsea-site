// =============================================================================
// NSEA Swim — site registry (single source of truth)
// -----------------------------------------------------------------------------
// Every page on the new site is one entry here. This file drives:
//   • the header menu and dropdowns      (src/lib/nav.mjs)
//   • every landing hub and its cards    (src/pages/[...slug].astro)
//   • breadcrumbs, the tool library      (src/pages/tools/index.astro)
//   • the migration report               (npm run report -> MIGRATION.md)
//
// Entry fields
//   path      URL path on the new site (trailing slash)
//   title     page / menu title
//   desc      one-line description (hub cards, meta description)
//   type      'hub'  landing page that lists its children
//             'page' content page
//             'tool' interactive tool (listed in the tool library)
//             'link' external link (shows as a card / menu item, no page built)
//   status    'done'     content migrated (src/content/<path>.md exists)
//             'ready'    already built - HTML saved under legacy/
//             'pull'     lives on the current BUILD site - content to be pulled
//             'rebuild'  exists today but is merged/redesigned in the new structure
//             'new'      does not exist yet
//   from      current nseaswimteam.com paths this replaces
//   legacy    files saved in /legacy that supply the content/tool
//   embed     URL of an already-hosted tool to iframe in the meantime
//   variants  { SCY: url, LCM: url } -> page shows a course toggle
//   url       external destination for type 'link'
//   gated     true -> belongs behind Cloudflare Access (see scripts/report.mjs)
//   also      other hubs that should show this page as a cross-link card
//   feature   true -> shown as a highlighted item in its parent dropdown
//   height    iframe height for embeds (px)
// =============================================================================

const BOARDS = 'https://jpmerchant.github.io/nsea-swim-boards';
const EVENTS = 'https://events.nseaswimteam.com';

export const SITE = {
  name: 'NSEA Swim',
  longName: 'Northside Elite Aquatics',
  tagline: 'Where Diversity Meets Dedication',
  origin: 'https://www.nseaswimteam.com',
  phone: '910-338-9455',
  email: 'team@nseaswim.com',
  address: '750 Bess St, Wilmington, NC 28401',
  captynLogin: 'https://nseaswim.captyn.com/',
  assessmentUrl: 'https://form.jotform.com/jpmerchant/assessment-sign-up',
  social: [
    { label: 'Facebook', url: 'https://facebook.com/nseaswim' },
    { label: 'Instagram', url: 'https://instagram.com/nsea.swim/' },
  ],
  partners: [
    ['USA Swimming', 'https://www.usaswimming.org'],
    ['SwimNC', 'http://www.swimnc.com'],
    ['Captyn', 'https://www.captyn.com/'],
    ['Mako', 'https://makoswim.io/'],
    ['FINIS', 'https://www.finisswim.com/'],
    ['SwimmersBest', 'https://www.swimmersbest.com/'],
    ['Time Drops', 'https://time-drops.com/'],
    ['TritonWear', 'https://www.tritonwear.com/'],
    ['SwimIntel', 'https://swimintel.com/'],
    ['EO Lab', 'https://www.eolab.com/swimbetter'],
    ['Fitter & Faster', 'https://fitterandfaster.com/'],
    ['Elemental Labs', 'http://elementallabs.refr.cc/jpmerchant'],
  ],
};

export const pages = [
  // ---------------------------------------------------------------- ABOUT ----
  { path: '/about/', type: 'hub', title: 'About', desc: 'Who we are, who coaches, and where we train.', status: 'rebuild', from: ['/about-us'] },
  { path: '/about/who-we-are/', type: 'page', title: 'Who We Are', desc: 'Our mission, vision and values, and how the club is run.', status: 'done', from: ['/about-us'] },
  { path: '/about/coaching-staff/', type: 'page', title: 'Coaching Staff', desc: 'Meet the NSEA coaches.', status: 'done', from: ['/coaching-staff'] },
  { path: '/about/practice-locations/', type: 'page', title: 'Practice Locations', desc: 'Where and when we practice.', status: 'done', from: ['/practice-locations'] },
  { path: '/about/practice-locations/parking/', type: 'page', title: 'Parking at Earl Jackson Pool', desc: 'Where to park for practice and meets.', status: 'done', from: ['/ejp-parking'], legacy: ['assets: 2025_26_TEAM_PARKING.png'] },
  { path: '/about/alumni/', type: 'page', title: 'Alumni', desc: 'Where NSEA swimmers go next.', status: 'done', from: ['/alumni'] },
  { path: '/about/alumni/college-swimmers/', type: 'page', title: 'College Swimmers', desc: 'NSEA alumni swimming in college.', status: 'done', from: ['/college-swimmers'] },
  { path: '/about/safe-sport/', type: 'page', title: 'Safe Sport', desc: 'How we keep athletes safe, and how to report a concern.', status: 'done', from: ['/safe-sport'] },
  { path: '/about/contact/', type: 'page', title: 'Contact & Who to Ask', desc: 'The right person for every question.', status: 'done', from: ['/who-to-contact'] },

  // ------------------------------------------------------------- PROGRAMS ----
  { path: '/programs/', type: 'hub', title: 'Programs', desc: 'Find the right group, see the schedule, and get started.', status: 'rebuild', from: ['/practice-groups'] },
  { path: '/programs/practice-groups/', type: 'hub', title: 'Practice Groups', desc: 'Six groups, from first strokes to senior training.', status: 'done', from: ['/practice-groups'] },
  { path: '/programs/practice-groups/splash/', type: 'page', title: 'Splash', desc: 'Ages 5–10 · previous swim experience', status: 'done', from: ['/practice-groups#Splash'] },
  { path: '/programs/practice-groups/tidepool/', type: 'page', title: 'Tidepool', desc: 'Ages 6–10 · building a competitive foundation', status: 'done', from: ['/practice-groups#Tidepool'] },
  { path: '/programs/practice-groups/riptide/', type: 'page', title: 'Riptide', desc: 'Ages 10–13 · training and competition skills', status: 'done', from: ['/practice-groups#Riptide'] },
  { path: '/programs/practice-groups/breakers/', type: 'page', title: 'Breakers', desc: 'Ages 13 & older · competitive experience', status: 'done', from: ['/practice-groups#Breakers'] },
  { path: '/programs/practice-groups/surge/', type: 'page', title: 'Surge', desc: 'Ages 14 & older · at least a year in Breakers', status: 'done', from: ['/practice-groups#Surge'] },
  { path: '/programs/practice-groups/senior/', type: 'page', title: 'Senior', desc: 'Ages 15 & older · A / AA time standards', status: 'done', from: ['/practice-groups#SeniorSurge'], legacy: ['Practice Group Documents/senior surge requirments.docx'] },
  { path: '/programs/schedule/', type: 'page', title: 'Practice Schedule', desc: 'The general practice schedule for every group.', status: 'done', from: ['/general-practice-schedule'] },
  { path: '/programs/clinics/', type: 'hub', title: 'Prep Programs & Clinics', desc: 'High school and summer league prep, plus skills clinics.', status: 'done', from: ['/offerings'] },
  { path: '/programs/clinics/high-school-prep/', type: 'page', title: 'High School Prep', desc: '', status: 'done', from: ['/offerings#HighSchoolPrep'] },
  { path: '/programs/clinics/high-school-skills/', type: 'page', title: 'High School Skills Clinics', desc: '', status: 'done', from: ['/offerings#HighSchoolSkillsClinics'] },
  { path: '/programs/clinics/summer-league-prep/', type: 'page', title: 'Summer League Prep', desc: '', status: 'done', from: ['/offerings#SummerLeaguePrep'] },
  { path: '/programs/clinics/summer-league-skills/', type: 'page', title: 'Summer League Skills Clinics', desc: '', status: 'done', from: ['/offerings#SummerLeagueSkillsClinics'] },
  { path: '/programs/fees/', type: 'page', title: 'Fees', desc: 'What it costs and how billing works.', status: 'pull', from: ['/fee-structure'], legacy: ['2026 - 27/2026 - 2027 Fee Summary.docx'] },
  { path: '/programs/financial-assistance/', type: 'page', title: 'Scholarships & Financial Assistance', desc: 'Help is available.', status: 'done', from: ['/scholarships-and-financial-assistance'] },
  { path: '/programs/join/', type: 'link', title: 'Free Assessment', desc: 'Sign up for an assessment to find the right group.', status: 'ready', url: 'https://form.jotform.com/jpmerchant/assessment-sign-up', feature: true },

  // ------------------------------------------------------------- FAMILIES ----
  { path: '/families/', type: 'hub', title: 'Family Guide', desc: 'Everything current and new families need, in one place.', status: 'rebuild' },
  { path: '/families/new-families/', type: 'hub', title: 'New to Swimming', desc: 'Start here: the basics of club swimming.', status: 'new' },
  { path: '/families/new-families/faq/', type: 'page', title: 'FAQ', desc: 'Answers to the questions we hear most.', status: 'done', from: ['/FAQ'] },
  { path: '/families/new-families/glossary/', type: 'tool', title: 'Glossary', desc: 'Swim words, decoded.', embed: '/embeds/glossary.html', status: 'done', from: ['/glossary'] },
  { path: '/families/new-families/water-safety/', type: 'page', title: 'Fast Facts on Water Safety', desc: '', status: 'done', from: ['/fast-facts-on-water-safety'] },
  { path: '/families/new-families/books/', type: 'page', title: 'Books', desc: 'Recommended reading for swimmers and parents.', status: 'done', from: ['/books'] },
  { path: '/families/new-families/usa-swimming-parents/', type: 'link', title: 'USA Swimming Parents Page', desc: 'National resources for swim parents.', status: 'ready', url: 'https://www.usaswimming.org/swimmers-parents' },
  { path: '/families/how-to/', type: 'hub', title: 'How-To Guides', desc: 'Step-by-step help for registering, opting in and out, and finding messages.', status: 'rebuild' },
  { path: '/families/how-to/captyn-messages/', type: 'page', title: 'Captyn Message Archive', desc: '', status: 'done', from: ['/captyn-message-archive'] },
  { path: '/families/how-to/register-for-an-event/', type: 'page', title: 'Register for an Event', desc: '', status: 'done', from: ['/register-for-an-event'], also: ['/meets/'] },
  { path: '/families/how-to/opt-in-to-meets/', type: 'page', title: 'Opt In to Meets', desc: '', status: 'done', from: ['/opt-in-to-meets'], also: ['/meets/'] },
  { path: '/families/how-to/opt-out-of-meets/', type: 'page', title: 'Opt Out of Meets', desc: '', status: 'done', from: ['/opt-out-of-meets'], also: ['/meets/'] },
  { path: '/families/how-to/session-opt-out/', type: 'page', title: 'Session & Season Opt-Out', desc: '', status: 'done', from: ['/opt-out---intent-information'], legacy: ['2026 - 27/2026 - 27 Session and Season Opt Out.odt'] },
  { path: '/families/newsletter/', type: 'hub', title: 'Newsletter', desc: 'The current issue and every past issue.', status: 'rebuild', from: ['/current', '/newsletters'] },
  { path: '/families/newsletter/current/', type: 'tool', title: 'Current Issue', desc: '', embed: '/embeds/newsletter-current.html', status: 'done', from: ['/current'], legacy: ['content/newsletters/nsea-newsletter-10-17-2026.html'] },
  { path: '/families/newsletter/archive/', type: 'page', title: 'Newsletter Archive', desc: '', status: 'done', from: ['/newsletters'], legacy: ['content/newsletters/nsea-newsletter-10-03-2026.html'] },
  { path: '/families/team-store/', type: 'hub', title: 'Team Store', desc: 'Apparel, caps, practice equipment and tech suits.', status: 'rebuild' },
  { path: '/families/team-store/apparel/', type: 'link', title: 'Apparel Store', desc: 'Team apparel and spirit wear.', status: 'ready', url: 'https://shop.creativeadscreenprinting.com/index.php/product-category/nsea_swim' },
  { path: '/families/team-store/caps/', type: 'link', title: 'Cap Order Form', desc: 'Order team caps.', status: 'ready', url: 'https://form.jotform.com/jpmerchant/team-caps' },
  { path: '/families/team-store/practice-equipment/', type: 'link', title: 'Practice Equipment Order', desc: 'Order required practice equipment.', status: 'ready', url: 'https://form.jotform.com/jpmerchant/equipment-order' },
  { path: '/families/team-store/group-equipment/', type: 'page', title: 'Equipment by Group', desc: 'What each group needs.', status: 'done', from: ['/practice-equipment'], legacy: ['NSEA_Required_Practice_Equipment.pdf'] },
  { path: '/families/team-store/tech-suit-order/', type: 'link', title: 'Tech Suit Order Form', desc: '', status: 'ready', url: 'https://form.jotform.com/jpmerchant/tech-suit-orders' },
  { path: '/families/team-store/tech-suit-guide/', type: 'page', title: 'Tech Suit Guide', desc: 'Sizing, care and when to buy.', status: 'done', from: ['/tech-suit-info'], legacy: ['FINIS Suit Guide.pdf'] },
  { path: '/families/carpool/', type: 'page', title: 'Carpool Board', desc: 'Find or offer rides to practice and meets. Members only.', status: 'new', gated: true },

  // ---------------------------------------------------------------- MEETS ----
  { path: '/meets/', type: 'hub', title: 'Meets', desc: 'The calendar, how meets work, and how to prepare.', status: 'rebuild', from: ['/calendar'] },
  { path: '/meets/calendar/', type: 'tool', title: 'Calendar of Events', desc: 'Filter by group, type and location, and sync to Google Calendar.', status: 'ready', from: ['/calendar'], embed: EVENTS + '/', height: 1400, legacy: ['tools/events/ (site-src)'], feature: true },
  { path: '/meets/guide/', type: 'tool', title: 'Guide to Swim Meets', desc: 'New to meets? Start here.', embed: '/embeds/swim-meets-guide.html', status: 'done', from: ['/about-swim-meets'], legacy: ['Project: claude/nsea-guide-to-swim-meets.html'] },
  { path: '/meets/uniform/', type: 'page', title: 'Meet Uniform', desc: 'What swimmers wear on deck.', status: 'done', from: ['/swim-suit-guide'] },
  { path: '/meets/pools/', type: 'page', title: 'Meet Pools', desc: 'Where we compete and how to get there.', status: 'done', from: ['/meet-pools'] },
  { path: '/meets/recaps/', type: 'hub', title: 'Meet Recaps', desc: 'Highlights and results from recent meets.', status: 'new', legacy: ['content/recaps/'] },
  { path: '/meets/recaps/october-suprise-2026/', type: 'tool', title: 'October Suprise 2026', desc: '', embed: '/embeds/recap-october-suprise-2026.html', status: 'done', legacy: ['content/recaps/meet-recap-october-suprise-2026.html', 'content/recaps/october-suprise-2026-analysis.html'] },
  { path: '/meets/recaps/october-suprise-2026-analysis/', type: 'tool', title: 'October Suprise 2026: Analysis', desc: 'A deeper look at the meet results.', embed: '/embeds/recap-october-suprise-2026-analysis.html', status: 'done', legacy: ['content/recaps/october-suprise-2026-analysis.html'] },
  { path: '/meets/recaps/fall-frenzy-2026/', type: 'tool', title: 'Fall Frenzy 2026 (BAC v NSEA)', desc: '', embed: '/embeds/recap-fall-frenzy-2026.html', status: 'done', legacy: ['Project: claude/newsletter-inserts/meet-recap-fall-frenzy-2026.html'] },

  // ------------------------------------------------------ TIMES & RECORDS ----
  { path: '/times/', type: 'hub', title: 'Times & Records', desc: 'Standards, top times, team records and season achievements.', status: 'rebuild' },

  { path: '/times/standards/', type: 'hub', title: 'Time Standards', desc: 'Understand the standards and see how close you are.', status: 'rebuild', from: ['/time-standards'] },
  { path: '/times/standards/understanding/', type: 'page', title: 'Understanding Time Standards', desc: '', status: 'done', from: ['/time-standards'] },
  { path: '/times/standards/check-my-time/', type: 'tool', title: 'Check My Time', desc: 'Enter a time and see which standards you have reached.', embed: '/embeds/check-my-time.html', status: 'done', from: ['/check-my-time'], legacy: ['tools/standards/nsea-standards-explorer.html'], feature: true, height: 1200 },
  { path: '/times/standards/compare-by-age-group/', type: 'tool', title: 'SCY Comparison by Age Group', desc: 'Every age group, event by event.', embed: '/embeds/scy-comparison-age-group.html', status: 'done', from: ['/scy---comparison-by-age-group'], legacy: ['tools/standards/NSEA SCY Time Standards Comparison.html'], height: 1400 },
  { path: '/times/standards/compare-all-ages/', type: 'tool', title: 'SCY Comparison, All Ages', desc: 'All standards ranked fastest to slowest.', embed: '/embeds/scy-comparison-all-ages.html', status: 'done', from: ['/scy---comparison-all-ages'], legacy: ['tools/standards/NSEA SCY Time Standards - All Ages Ranked.html'], height: 1400 },
  { path: '/times/standards/nc-age-group/', type: 'tool', title: 'NC Age Group Championships', desc: 'Cutoffs and what it takes to qualify.', embed: '/embeds/nc-age-group.html', status: 'done', from: ['/nc-age-group-championships'], legacy: ['tools/standards/ncs-ag-champs-standards-embed.html'], height: 1400 },
  { path: '/times/standards/nc-senior/', type: 'tool', title: 'NC Senior Championships', desc: 'Cutoffs and what it takes to qualify.', embed: '/embeds/nc-senior.html', status: 'done', from: ['/nc-senior-championships'], legacy: ['tools/standards/ncs-senior-standards-embed.html'], height: 1400 },
  { path: '/times/standards/national-qualifiers/', type: 'page', title: 'National Meet Qualifiers', desc: 'NSEA swimmers who have reached national meets.', status: 'done', from: ['/national--meet--qualifiers'] },
  { path: '/times/standards/power-points/', type: 'page', title: 'About Power Points', desc: 'How USA Swimming scores a swim.', status: 'done', from: ['/power-points-explained'] },
  { path: '/times/standards/imx-imr/', type: 'hub', title: 'IMX / IMR', desc: 'Individual medley progress.', status: 'rebuild', from: ['/imx-progress', '/imr-/-imx-progress'] },
  { path: '/times/standards/imx-imr/about/', type: 'page', title: 'About IMX / IMR', desc: '', status: 'done', from: ['/imx-progress'] },
  { path: '/times/standards/imx-imr/progress/', type: 'tool', title: 'IMX / IMR Progress Board', desc: '', status: 'ready', from: ['/imr-/-imx-progress'], embed: BOARDS + '/imx-imr-scy.html', legacy: ['tools/boards/imx-imr-scy.html'], height: 1400 },

  { path: '/times/top-times/', type: 'hub', title: 'Top Times', desc: 'The fastest swims and swimmers in NSEA history.', status: 'rebuild', from: ['/top-times', '/top-times---lcm', '/top-10-swims---scy', '/top-10-swims--lcm', '/top-5-relays---scy', '/top-5-relays---lcm'] },
  { path: '/times/top-times/swimmers/', type: 'tool', title: 'Top 10 Swimmers', desc: 'One entry per swimmer, per event.', status: 'ready', from: ['/top-times', '/top-times---lcm'], variants: { SCY: BOARDS + '/top10-performers-scy.html', LCM: BOARDS + '/top10-performers-lcm.html' }, legacy: ['tools/boards/top10-performers-*.html'], height: 1500 },
  { path: '/times/top-times/swims/', type: 'tool', title: 'Top 10 Swims', desc: 'The fastest swims, repeat swimmers allowed.', status: 'ready', from: ['/top-10-swims---scy', '/top-10-swims--lcm'], variants: { SCY: BOARDS + '/top10-performances-scy.html', LCM: BOARDS + '/top10-performances-lcm.html' }, legacy: ['tools/boards/top10-performances-*.html'], height: 1500 },
  { path: '/times/top-times/relays/', type: 'tool', title: 'Top 5 Relays', desc: '', status: 'ready', from: ['/top-5-relays---scy', '/top-5-relays---lcm'], variants: { SCY: BOARDS + '/top5-relays-scy.html', LCM: BOARDS + '/top5-relays-lcm.html' }, legacy: ['tools/boards/top5-relays-*.html'], height: 1300 },
  { path: '/times/top-times/new-additions/', type: 'tool', title: 'New Board Additions', desc: 'Swims that just made the boards this season.', embed: '/embeds/new-additions.html', status: 'done', from: ['/2025---26-updates'], legacy: ['tools/standards/NSEA New Board Additions - Site Embed.html'], height: 1400 },

  { path: '/times/records/', type: 'hub', title: 'Team Records', desc: 'Every NSEA team record, individual and relay.', status: 'rebuild' },
  { path: '/times/records/holders/', type: 'tool', title: 'Record Holders', desc: 'Swimmers ranked by number of records held.', status: 'ready', from: ['/team-record-holders'], embed: BOARDS + '/records.html', legacy: ['tools/boards/records.html'], height: 1400 },
  { path: '/times/records/individual/', type: 'tool', title: 'Individual Records', desc: 'By age group and event.', status: 'ready', from: ['/team-records---scy', '/team-records---lcm'], variants: { SCY: BOARDS + '/records-traditional-scy.html', LCM: BOARDS + '/records-traditional-lcm.html' }, legacy: ['tools/boards/records-traditional-*.html'], height: 1500 },
  { path: '/times/records/relays/', type: 'tool', title: 'Relay Records', desc: '', status: 'ready', from: ['/scy---relay-team-records', '/lcm---relay-team-records'], variants: { SCY: BOARDS + '/records-relays-scy.html', LCM: BOARDS + '/records-relays-lcm.html' }, legacy: ['tools/boards/records-relays-*.html'], height: 1300 },
  { path: '/times/records/this-season/', type: 'tool', title: 'Records Set This Season', desc: '', embed: '/embeds/records-this-season.html', status: 'done', from: ['/records-set-in-2025---26'] },

  { path: '/times/achievements/', type: 'hub', title: 'Achievements by Season', desc: 'The year-by-year story of the team.', status: 'rebuild' },
  { path: '/times/achievements/2025-26/', type: 'page', title: '2025 – 2026', desc: '', status: 'done', from: ['/2025---2026'] },
  { path: '/times/achievements/2024-25/', type: 'page', title: '2024 – 2025', desc: '', status: 'done', from: ['/2024---2025'] },
  { path: '/times/achievements/2023-24/', type: 'tool', title: '2023 – 2024', desc: '', embed: '/embeds/achievements-2023-24.html', status: 'done', from: ['/2023---2024'] },
  { path: '/times/achievements/2022-23/', type: 'tool', title: '2022 – 2023', desc: '', embed: '/embeds/achievements-2022-23.html', status: 'done', from: ['/2022---23-achievements'] },

  // ------------------------------------------------------------- TRAINING ----
  { path: '/training/', type: 'hub', title: 'Training', desc: 'Tools, guides and education for swimmers and the families who support them.', status: 'rebuild' },
  { path: '/training/zones/', type: 'page', title: 'Training Zone Cheat Sheet', desc: 'Rushton zones, with TritonWear zones mapped on.', status: 'pull', from: ['/training-zone-cheat-sheet'], legacy: ['NSEASwim-KB-Repo/NSEA_Training_Zones_Cheat_Sheet.pdf'] },
  { path: '/training/rpe/', type: 'page', title: 'RPE & Session RPE', desc: 'How hard did that feel? A guide for swimmers.', status: 'pull', from: ['/rpe-information'], legacy: ['content/guides/rpe-session-rpe-handout.html', 'Project: claude/rpe-session-rpe-reference.md'] },
  { path: '/training/same/', type: 'hub', title: 'S.A.M.E.', desc: 'Strength, Agility, Mobility and Education.', status: 'rebuild' },
  { path: '/training/same/strength/', type: 'page', title: 'Strength', desc: '', status: 'pull', from: ['/strength', '/shoulder-strength'], legacy: ['Project: claude/nsea-shoulder-care-guide.html'] },
  { path: '/training/same/agility/', type: 'page', title: 'Agility', desc: '', status: 'pull', from: ['/agility'] },
  { path: '/training/same/mobility/', type: 'page', title: 'Mobility', desc: '', status: 'pull', from: ['/mobility', '/pre-practice-mobility'], legacy: ['Project: claude/nsea-swimmer-mobility-routines.html', 'Project: claude/nsea-pre-practice-guide.html'] },
  { path: '/training/same/foam-rolling/', type: 'page', title: 'Foam Rolling', desc: '', status: 'pull', from: ['/foam-rolling'], legacy: ['Project: claude/nsea-foam-roller-guide.html'] },
  { path: '/training/same/education/', type: 'hub', title: 'Education', desc: 'Research-backed guides for families.', status: 'rebuild', from: ['/education'] },
  { path: '/training/same/education/caffeine-guide/', type: 'page', title: 'Caffeine & Energy Drinks: A Quick Guide', desc: '', status: 'ready', from: ['/caffeine---energy-drinks--a-quick-guide'], legacy: ['content/guides/caffeine-guide-for-nsea-families_1.html'] },
  { path: '/training/same/education/caffeine-research/', type: 'page', title: 'Caffeine & Energy Drinks: The Research', desc: '', status: 'ready', from: ['/caffeine---energy-drinks--research'], legacy: ['content/guides/caffeine-youth-athletes-research.html', 'Project: claude/nsea-research-caffeine-and-youth-athletes.html'] },
  { path: '/training/same/education/specialization-ages/', type: 'page', title: 'When to Specialize', desc: 'What the research says about specialization ages.', status: 'new', legacy: ['Project: claude/specialization-ages-swimming-reference.md'] },
  { path: '/training/same/education/race-pacing/', type: 'page', title: 'Race Pacing', desc: '', status: 'new', legacy: ['Project: claude/race-pacing-synthesis.md'] },
  { path: '/training/same/education/sodium-bicarbonate/', type: 'page', title: 'Sodium Bicarbonate & Young Swimmers', desc: '', status: 'new', legacy: ['Project: claude/sodium-bicarbonate-youth-swimming-reference.md'] },
  { path: '/training/biomechanics/', type: 'hub', title: 'Biomechanics', desc: 'How we measure stroke mechanics with eo SwimBETTER and TritonWear.', status: 'new', legacy: ['Project: claude/*-biomechanics-reference.md', 'Project: claude/nsea-tritonwear-eo-metrics-*.html'] },
  { path: '/training/biomechanics/metrics/', type: 'page', title: 'Reading the Metrics', desc: 'TritonWear and eo metrics, in plain language.', status: 'new', legacy: ['Project: claude/nsea-tritonwear-eo-metrics-one-pager.html', 'Project: claude/nsea-tritonwear-eo-metrics-by-stroke.html'] },
  { path: '/training/biomechanics/freestyle/', type: 'page', title: 'Freestyle', desc: '', status: 'new', legacy: ['Project: claude/freestyle-biomechanics-reference.md'] },
  { path: '/training/biomechanics/backstroke/', type: 'page', title: 'Backstroke', desc: '', status: 'new', legacy: ['Project: claude/backstroke-biomechanics-reference.md'] },
  { path: '/training/biomechanics/butterfly/', type: 'page', title: 'Butterfly', desc: '', status: 'new', legacy: ['Project: claude/butterfly-biomechanics-reference.md'] },
  { path: '/training/biomechanics/breaststroke/', type: 'page', title: 'Breaststroke', desc: '', status: 'new', legacy: ['Project: claude/breaststroke-biomechanics-reference.md'] },
];

// Pages that are not part of the menu tree
export const utility = [
  { path: '/privacy/', title: 'Privacy Statement', status: 'pull', from: ['/privacy-policy'] },
];

// Live pages that are intentionally NOT carried over
export const retired = [
  { from: '/test-page', reason: 'Test page' },
  { from: '/coming-soon', reason: 'Placeholder; replaced by Coach’s Corner on the home page' },
  { from: '/home', reason: 'Replaced by the new home page' },
];
