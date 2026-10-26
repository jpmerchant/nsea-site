// Starting values for the blocks edited in the admin console (Content). The database overrides these; this file is also the fallback.
export const FEE_GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers', 'Surge', 'Senior'];

export const FEES = {
  rows: [
    { group: 'Splash', scy: 130, spring: 100, summer: 100 },
    { group: 'Tidepool', scy: 150, spring: 115, summer: 115 },
    { group: 'Riptide', scy: 160, spring: 120, summer: 120 },
    { group: 'Breakers', scy: 170, spring: 125, summer: 125 },
    { group: 'Surge', scy: 185, spring: 140, summer: 140 },
    { group: 'Senior', scy: 220, spring: 165, summer: 165 },
  ],
  note: 'New swimmers also need to register with USA Swimming and are responsible for that registration fee.',
  pdf_url: '/assets/2026-27-practice-fee-schedule.pdf',
};

export const OFFERINGS = {
  'high-school-prep': {
    title: 'High School Prep',
    headline: 'Fall 2026 session: September 14 – October 29, 2026.',
    body: 'Registration for this session has closed. Dates for the next session will be posted here once they are set.',
    button_label: 'Registration for upcoming sessions (Captyn)',
    button_url: 'https://nseaswim.captyn.com/find?tag=cmni0o39a00xvn31414aas3wh&type=group',
  },
  'high-school-skills': {
    title: 'High School Skills Clinics',
    headline: 'The 2026–27 clinic schedule has not been announced yet.',
    body: 'Watch this page and the Calendar, or email team@nseaswim.com to be told when it is posted.',
    button_label: 'Email us',
    button_url: 'mailto:team@nseaswim.com',
  },
  'summer-league-prep': {
    title: 'Summer League Prep',
    headline: 'Summer 2027 details will be announced by December 2026.',
    body: 'Ages, schedule and registration will be posted here. To be told when they are, email team@nseaswim.com.',
    button_label: 'Email us',
    button_url: 'mailto:team@nseaswim.com',
  },
  'summer-league-skills': {
    title: 'Summer League Skills Clinics',
    headline: 'Summer 2027 details will be announced by December 2026.',
    body: 'Ages, schedule and registration will be posted here. To be told when they are, email team@nseaswim.com.',
    button_label: 'Email us',
    button_url: 'mailto:team@nseaswim.com',
  },
};

export const defaults = () => ({
  fees: FEES,
  ...Object.fromEntries(Object.entries(OFFERINGS).map(([k, v]) => [`offering:${k}`, v])),
});
