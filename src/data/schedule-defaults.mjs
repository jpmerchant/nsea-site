// Starting values for the Practice Schedule module. The admin console (Practice Schedule > Settings) overrides these;
// this file is also the fallback, and what the public schedule page renders before the live data loads.
// Times are Monday..Saturday. Sunday is always off unless a dated change says otherwise.
export const SCHED_GROUPS = ['Splash', 'Tidepool', 'Riptide', 'Breakers', 'Surge', 'Senior'];
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const OFF = 'Off';
export const SEASONS = [
  {
    id: 'school-2026-27',
    label: 'Fall – Spring (school year)',
    start: '2026-08-24',
    end: '2027-06-06',
    base: {
      Splash: { PM: [OFF, '4:30 - 5:15', '4:30 - 5:15', '4:30 - 5:15', '4:30 - 5:30', OFF] },
      Tidepool: { PM: ['4:30 - 5:30', '4:30 - 6:00', '4:30 - 5:30', '4:30 - 6:00', '4:30 - 5:30', OFF] },
      Riptide: { PM: ['5:15 - 6:45', '5:15 - 6:45', '5:15 - 6:15', '5:15 - 6:45', '5:30 - 7:00', OFF] },
      Breakers: { AM: [OFF, OFF, OFF, OFF, OFF, '8:30 - 10:00'], PM: ['5:15 - 6:45', '5:15 - 6:45', '6:15 - 8:15', '5:15 - 6:45', '5:30 - 7:00', OFF] },
      Surge: { AM: [OFF, OFF, OFF, OFF, '5:30 - 7:00', '6:30 - 8:30'], PM: ['6:45 - 8:15', '6:15 - 8:15', '6:15 - 8:15', '6:15 - 8:15', OFF, OFF] },
      Senior: { AM: [OFF, '5:30 - 7:00', OFF, '5:30 - 7:00', '5:30 - 7:00', '6:30 - 8:30'], PM: ['6:45 - 8:15', '6:15 - 8:15', '4:15 - 6:15', '6:15 - 8:15', OFF, OFF] },
    },
    note: '',
  },
  {
    id: 'summer-2027',
    label: 'Summer',
    start: '2027-06-07',
    end: '2027-08-22',
    base: {
      Splash: { PM: ['TBD', 'TBD', 'TBD', 'TBD', 'TBD', 'TBD'] },
      Tidepool: { PM: ['TBD', 'TBD', 'TBD', 'TBD', 'TBD', 'TBD'] },
      Riptide: { AM: ['8:30 - 10:00', '8:30 - 10:00', '8:30 - 10:00', '8:30 - 10:00', OFF, OFF] },
      Breakers: { AM: ['8:30 - 10:00', '8:30 - 10:00', '8:30 - 10:00', '8:30 - 10:00', '8:30 - 10:00', OFF] },
      Surge: { AM: ['6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30'] },
      Senior: { AM: ['6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30', '6:30 - 8:30'], PM: ['4:30 - 6:00', '4:30 - 6:00', '4:30 - 6:00', '4:30 - 6:00', OFF, OFF] },
    },
    note: 'Senior afternoon practices are set around the Wilmington Swim League (WSL) meet schedule and may move.',
  },
];

// What the weekly check reads and how it decides. Feed URLs are admin-only (never served publicly).
export const CHECK = {
  // School calendars. Only the ones switched on are checked; a school holiday only moves AM practices.
  // The NHCS "Traditional Schools" Google calendar still only has 2025-26 dates, so New Hanover school days are read
  // from the all-day events in the High School Meets / Holidays calendar instead (hsSchoolDays below).
  schools: [
    { name: 'New Hanover County Schools', url: 'https://calendar.google.com/calendar/ical/nhcs.net_8sff11at65ctrauo4u7aega6ro%40group.calendar.google.com/public/basic.ics', on: false },
    { name: 'Brunswick County Schools', url: 'https://www.bcswan.net/fs/calendar-manager/events.ics?calendar_ids[]=5&calendar_ids[]=6&calendar_ids[]=8&calendar_ids[]=32&calendar_ids[]=7&calendar_ids[]=4', on: false },
    { name: 'Pender County Schools', url: 'https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o/9151/cms/events/generate_ical?filter_ids&section_ids', on: false },
  ],
  minCounties: 1,
  // High school meets: a meet night only matters when enough schools with NSEA swimmers are swimming
  // and the affected groups have a practice in that session.
  hsUrl: '',
  hsSchoolDays: 'New Hanover County Schools', // all-day events in the HS calendar count as this county's school days ('' = ignore them)
  hsSchools: ['Ashley', 'Hoggard', 'Laney', 'New Hanover', 'Topsail'],
  hsMin: 3,
  hsGroups: ['Surge', 'Senior'],
  hsSession: 'PM',
  // Wilmington Swim League: summer only. Fill in the WSL teams that have Senior swimmers once they are known (April/May).
  wslUrl: '',
  wslTeams: [],
  wslGroups: ['Senior'],
  wslSession: 'PM',
  eventsUrl: 'https://events.nseaswimteam.com/events.json',
  holidaySheet: 'https://docs.google.com/spreadsheets/d/1PnEukw-c0GVkrEFhYK4A-sXXShC2Vg6AnqlF0ztQx6Y/edit?usp=sharing',
  lookaheadDays: 21,
};

export const scheduleDefaults = () => JSON.parse(JSON.stringify({ seasons: SEASONS, check: CHECK }));
