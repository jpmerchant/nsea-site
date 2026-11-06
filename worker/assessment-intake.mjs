// New swimmer assessment intake rules: what a family's answers lead to.
//
// One pure function, evaluateIntake(), decides the path for ONE swimmer. The public sign-up form will call it as families answer
// (and again on the server before saving), and the admin console's "Intake preview" tab calls it so staff can try any scenario.
// Every rule here comes from JP's "Age and group rules" and "Form logic" answers (Nov 2026). Nothing in here blocks a family
// from reaching a person: unusual answers are flagged for review, never rejected.
//
// Paths:
//   schedule           -> go on to pick or request a date (flags, if any, travel with the request)
//   learn_to_swim      -> no assessment; the family is pointed to swim lessons
//   background_review  -> no date picker; a background form goes to JP, who decides whether an assessment is needed
import { json } from './util.mjs';
import { todayET } from './assessment-schedule.mjs';

export const LEARN_TO_SWIM_URL = 'https://www.nseaswim.com/learn/lessons';

// Ages are in whole years on the assessment date. Order matters: later groups are "higher".
export const GROUP_RULES = [
  { name: 'Splash', min: 5, max: 10, route: 'assess' },
  { name: 'Tidepool', min: 6, max: 11, route: 'assess' },
  { name: 'Riptide', min: 9, max: 13, route: 'assess' },
  { name: 'Breakers', min: 13, max: 18, route: 'background', note: 'Breakers is rarely assessed in the water.' },
  { name: 'Surge', min: 14, max: 18, route: 'background', note: 'Surge is not assessed in the water.' },
  { name: 'Senior', min: 15, max: 18, route: 'background', note: 'Senior is not assessed in the water.' },
];
export const EXPERIENCE = { none: 'No swimming experience', lessons: 'Lessons or recreational swimming only', competitive: 'Competitive swimming experience' };

// Competitive experience: the family ticks any that apply, and each opens a few short follow-up questions.
// Best events and times are deliberately not asked; coaches look those up themselves.
const TEAM = { key: 'team', label: 'Team name', required: true }, YEARS = { key: 'years', label: 'Years swimming', type: 'number', required: true };
export const COMPETITIVE = {
  usa_club: { label: 'USA Swimming club', fields: [TEAM, { key: 'lsc', label: 'LSC (for example NC Swimming)', required: true }, YEARS] },
  ymca_club: { label: 'YMCA club', fields: [TEAM, { key: 'region', label: 'YMCA region or association', required: false }, YEARS] },
  summer_league: { label: 'Summer League', fields: [{ key: 'team', label: 'Team or league name', required: true }, YEARS] },
  rec_league: { label: 'Other recreation league', fields: [{ key: 'team', label: 'League or team name', required: true }, YEARS] },
  high_school: { label: 'High school', fields: [{ key: 'school', label: 'School', required: true }, YEARS] },
  other: { label: 'Other', fields: [{ key: 'describe', label: 'Please describe', required: true, long: true }] },
};

// Optional "how did you hear about us" choices. Never required.
export const HEARD = { friend: 'Friend or family', member: 'A current NSEA family', school: 'School or PE class', search: 'Web search', social: 'Social media', event: 'Meet or community event', other: 'Other' };

const rank = (name) => GROUP_RULES.findIndex((g) => g.name === name);
const ruleOf = (name) => GROUP_RULES.find((g) => g.name === name);
const list = (names) => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

export function parseBirthDate(s) {
  const v = String(s ?? '').trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === v ? v : null;
}
export function ageOn(dob, asOf) {
  const [by, bm, bd] = dob.split('-').map(Number), [ay, am, ad] = asOf.split('-').map(Number);
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

// answers: { formerNsea, formerNseaWhen, otherTeam, otherTeamName, heard, dob, experience, competitive: [keys], details: { key: { field: value } }, groups: [names] and/or 'unsure': true }
export function evaluateIntake(answers, { asOf } = {}) {
  const a = answers || {};
  const date = parseBirthDate(asOf) || todayET();
  const errors = [];
  const dob = parseBirthDate(a.dob);
  if (!dob) errors.push({ field: 'dob', message: 'Please enter the swimmer’s date of birth.' });
  else if (dob > date) errors.push({ field: 'dob', message: 'That date of birth is after the assessment date.' });
  else if (ageOn(dob, date) > 40) errors.push({ field: 'dob', message: 'Please check the date of birth.' });
  if (!EXPERIENCE[a.experience]) errors.push({ field: 'experience', message: 'Please tell us about the swimmer’s experience.' });
  if (errors.length) return { ok: false, errors };

  const age = ageOn(dob, date);
  const out = { ok: true, age, asOf: date, flags: [], familyMessages: [], followups: [], errors: [] };

  // 1. No swimming experience: point to lessons and stop. Water comfort is judged in person at the assessment, not by a parent's opinion. The family can still reach a person.
  if (a.experience === 'none') {
    out.path = 'learn_to_swim';
    out.reason = 'no_experience';
    out.familyMessages.push({
      code: 'learn_to_swim', link: LEARN_TO_SWIM_URL,
      message: 'Thank you for your interest in NSEA Swim! From what you have told us, the best place to start is our swim lessons. Lessons build water comfort and the basic skills a swimmer needs before joining a practice group, and swimmers move on to an assessment when they are ready. We would love to see them back then.',
    });
    return out;
  }

  // 2. Competitive experience: collect the follow-ups for each kind ticked, then flag the request for JP.
  if (a.experience === 'competitive') {
    const ticked = [...new Set(Array.isArray(a.competitive) ? a.competitive : [])];
    if (!ticked.length || ticked.some((k) => !COMPETITIVE[k])) errors.push({ field: 'competitive', message: 'Please tick each kind of competitive swimming the swimmer has done.' });
    for (const k of ticked.filter((x) => COMPETITIVE[x])) {
      out.followups.push({ type: k, label: COMPETITIVE[k].label, fields: COMPETITIVE[k].fields });
      const got = (a.details && a.details[k]) || {};
      for (const f of COMPETITIVE[k].fields) {
        const v = String(got[f.key] ?? '').trim();
        if (f.required && !v) errors.push({ field: `details.${k}.${f.key}`, message: `${COMPETITIVE[k].label}: please fill in “${f.label}”.` });
        else if (f.type === 'number' && v && !(Number(v) >= 0 && Number(v) <= 40)) errors.push({ field: `details.${k}.${f.key}`, message: `${COMPETITIVE[k].label}: “${f.label}” should be a number of years.` });
      }
    }
    out.flags.push({ code: 'competitive_experience', level: 'review', message: 'Has competitive experience: ' + (ticked.filter((k) => COMPETITIVE[k]).map((k) => COMPETITIVE[k].label).join(', ') || 'details missing') + '. Do the background search.' });
  }

  // 2b. History with NSEA and other teams. Both only flag; they never change the path.
  if (a.formerNsea) out.flags.push({ code: 'former_nsea', level: 'review', message: 'Has swum with NSEA before' + (String(a.formerNseaWhen ?? '').trim() ? ` (${String(a.formerNseaWhen).trim().slice(0, 80)})` : '') + '. Look up the old profile and records.' });
  if (a.otherTeam) {
    const t = String(a.otherTeamName ?? '').trim();
    if (!t) errors.push({ field: 'otherTeamName', message: 'Please tell us which team the swimmer is on now.' });
    out.flags.push({ code: 'other_team', level: 'review', message: `Currently swims for ${t || 'another team'}. Confirm they plan to leave that team before placing.` });
  }
  if (a.heard && !HEARD[a.heard]) errors.push({ field: 'heard', message: 'Please choose one of the listed ways you heard about us, or leave it blank.' });
  else if (a.heard) out.heard = a.heard;

  // 3. Which group(s) the family is interested in.
  const chosen = [...new Set((Array.isArray(a.groups) ? a.groups : []).filter((g) => ruleOf(g)))].sort((x, y) => rank(x) - rank(y));
  const unsure = !!a.unsure;
  if (!chosen.length && !unsure) errors.push({ field: 'groups', message: 'Please choose a group, or tell us you are not sure.' });
  if (unsure) {
    out.flags.push({ code: 'unsure_group', level: 'review', message: 'Family is not sure which group to choose' + (chosen.length ? ` (also interested in ${list(chosen)})` : '') + '.' });
    out.familyMessages.push({ code: 'unsure_group', link: '/programs/practice-groups/', message: 'Not sure which group fits? Our group descriptions and a general outline of what we look for in an assessment are on the team site. You can still continue, and a coach will help place the swimmer.' });
  }
  if (errors.length) return { ok: false, errors };

  const top = chosen[chosen.length - 1] || null;
  out.groupsChosen = chosen;
  if (chosen.length > 1) out.flags.push({ code: 'multiple_groups', level: 'review', message: `Interested in ${list(chosen)}. Assess for the higher group (${top}).` });
  out.assessFor = top;

  // 4. Age against the groups. Never blocks; JP checks against championship meets and the group profile.
  if (age < Math.min(...GROUP_RULES.map((g) => g.min))) out.flags.push({ code: 'age_below', level: 'review', message: `Age ${age} is below every group's minimum. Check against championship meets and the group profile.` });
  else if (age > Math.max(...GROUP_RULES.map((g) => g.max))) out.flags.push({ code: 'age_above', level: 'review', message: `Age ${age} is above every group's maximum. Check against championship meets and the group profile.` });
  else {
    const off = chosen.filter((g) => age < ruleOf(g).min || age > ruleOf(g).max);
    if (off.length) out.flags.push({ code: 'age_group_mismatch', level: 'review', message: `Age ${age} is outside the usual range for ${list(off.map((g) => `${g} (${ruleOf(g).min} to ${ruleOf(g).max})`))}.` });
  }

  // 5. Breakers, Surge and Senior: a background form instead of a date. The highest group asked about decides.
  if (top && ruleOf(top).route === 'background') {
    out.path = 'background_review';
    out.reason = ruleOf(top).note;
    out.familyMessages.push({ code: 'background_form', message: `For ${top}, we start with a short background form about the swimmer. A coach will read it and be in touch about next steps, which may or may not include an assessment.` });
    return out;
  }

  out.path = 'schedule';
  return out;
}

// Open requests (new or scheduled) that look like the same swimmer: same contact email and swimmer name, ignoring case and spacing.
// Used at submit time; a match is a flag for staff, never a block.
export async function findDuplicateRequests(env, { swimmerName, email }) {
  const n = String(swimmerName ?? '').trim().replace(/\s+/g, ' ').toLowerCase(), e = String(email ?? '').trim().toLowerCase();
  if (!n || !e) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, status, appt_date, appt_time, created_at FROM assess_requests
     WHERE status IN ('new','scheduled') AND lower(trim(contact_email)) = ? AND lower(trim(swimmer_name)) = ? ORDER BY id`).bind(e, n).all();
  return results;
}

export async function handleIntakeAdmin(env, me, method, path, body) {
  if (method === 'POST' && path === '/assessment/intake/preview') {
    const r = evaluateIntake(body.answers, { asOf: body.asOf });
    return json({ result: r, heard: HEARD, groups: GROUP_RULES, experience: EXPERIENCE, competitive: COMPETITIVE, learnToSwimUrl: LEARN_TO_SWIM_URL });
  }
  if (method === 'POST' && path === '/assessment/intake/duplicates') {
    return json({ matches: await findDuplicateRequests(env, { swimmerName: body.swimmerName, email: body.email }) });
  }
  if (method === 'GET' && path === '/assessment/intake/config') {
    return json({ heard: HEARD, groups: GROUP_RULES, experience: EXPERIENCE, competitive: COMPETITIVE, learnToSwimUrl: LEARN_TO_SWIM_URL, today: todayET() });
  }
  return null;
}
