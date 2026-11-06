import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIntake, ageOn, parseBirthDate, LEARN_TO_SWIM_URL } from '../worker/assessment-intake.mjs';

const asOf = '2027-06-15';
const base = { dob: '2018-03-01', comfort: 'comfortable', experience: 'lessons', groups: ['Splash'] };
const ev = (o) => evaluateIntake({ ...base, ...o }, { asOf });
const codes = (r) => r.flags.map((f) => f.code);

test('age is whole years on the assessment date', () => {
  assert.equal(ageOn('2016-06-15', asOf), 11);
  assert.equal(ageOn('2016-06-16', asOf), 10);
  assert.equal(parseBirthDate('2016-02-30'), null);
});
test('missing or bad basics return errors', () => {
  const r = evaluateIntake({}, { asOf });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ['dob', 'comfort', 'experience']);
  assert.equal(ev({ dob: '2030-01-01' }).ok, false);
});
test('uncomfortable or cannot swim -> learn to swim', () => {
  for (const comfort of ['uncomfortable', 'cannot_swim']) {
    const r = ev({ comfort });
    assert.equal(r.path, 'learn_to_swim');
    assert.equal(r.reason, 'not_comfortable');
    assert.equal(r.familyMessages[0].link, LEARN_TO_SWIM_URL);
  }
});
test('no experience -> learn to swim, separate from comfort', () => {
  const r = ev({ experience: 'none' });
  assert.equal(r.path, 'learn_to_swim');
  assert.equal(r.reason, 'no_experience');
});
test('plain case schedules with no flags', () => {
  const r = ev({});
  assert.equal(r.path, 'schedule');
  assert.deepEqual(r.flags, []);
  assert.equal(r.assessFor, 'Splash');
});
test('competitive needs a kind and its follow-ups', () => {
  assert.equal(ev({ experience: 'competitive' }).ok, false);
  const r = ev({ experience: 'competitive', competitive: ['usa_club'], details: { usa_club: { team: 'X' } } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'details.usa_club.lsc'));
  assert.ok(r.errors.some((e) => e.field === 'details.usa_club.years'));
});
test('competitive with details flags for background search', () => {
  const r = ev({ experience: 'competitive', competitive: ['usa_club', 'ymca_club', 'summer_league', 'rec_league', 'high_school', 'other'], details: {
    usa_club: { team: 'T', lsc: 'NC', years: '2' }, ymca_club: { team: 'Y', years: 1 }, summer_league: { team: 'S', years: 3 },
    rec_league: { team: 'R', years: 1 }, high_school: { school: 'H', years: 1 }, other: { describe: 'Masters' } } });
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r), ['competitive_experience']);
  assert.equal(r.followups.length, 6);
  assert.equal(ev({ experience: 'competitive', competitive: ['other'], details: {} }).ok, false);
  assert.equal(ev({ experience: 'competitive', competitive: ['summer_league'], details: { summer_league: { team: 'S', years: 99 } } }).ok, false);
});
test('unsure group flags and points to descriptions', () => {
  const r = ev({ groups: [], unsure: true });
  assert.equal(r.path, 'schedule');
  assert.deepEqual(codes(r), ['unsure_group']);
  assert.equal(r.familyMessages[0].link, '/programs/practice-groups/');
  assert.equal(ev({ groups: [] }).ok, false);
});
test('multiple groups flags and assesses for the higher', () => {
  const r = ev({ groups: ['Tidepool', 'Splash'], dob: '2018-01-01' });
  assert.ok(codes(r).includes('multiple_groups'));
  assert.equal(r.assessFor, 'Tidepool');
});
test('age below every minimum / above every maximum', () => {
  assert.ok(codes(ev({ dob: '2024-01-01' })).includes('age_below'));
  assert.ok(codes(ev({ dob: '2000-01-01', groups: ['Riptide'] })).includes('age_above'));
});
test('age outside the chosen group range is flagged, not blocked', () => {
  const r = ev({ dob: '2015-01-01', groups: ['Splash'] }); // age 12
  assert.equal(r.path, 'schedule');
  assert.ok(codes(r).includes('age_group_mismatch'));
  assert.ok(!codes(ev({ dob: '2018-01-01', groups: ['Splash'] })).includes('age_group_mismatch'));
});
test('Breakers, Surge, Senior -> background review', () => {
  for (const g of ['Breakers', 'Surge', 'Senior']) {
    const r = ev({ dob: '2010-01-01', groups: [g] });
    assert.equal(r.path, 'background_review');
    assert.equal(r.assessFor, g);
  }
  const mixed = ev({ dob: '2014-01-01', groups: ['Riptide', 'Breakers'] });
  assert.equal(mixed.path, 'background_review');
  assert.ok(codes(mixed).includes('multiple_groups'));
});
test('unknown groups are ignored', () => {
  assert.equal(ev({ groups: ['Nope'] }).ok, false);
});
