import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateIntake, ageOn, parseBirthDate, LEARN_TO_SWIM_URL, findDuplicateRequests } from '../worker/assessment-intake.mjs';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node: skip */ }

const asOf = '2027-06-15';
const base = { dob: '2018-03-01', experience: 'lessons', groups: ['Splash'] };
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
  assert.deepEqual(r.errors.map((e) => e.field), ['dob', 'experience']);
  assert.equal(ev({ dob: '2030-01-01' }).ok, false);
});
test('water comfort is not asked, only experience decides', () => {
  assert.equal(ev({ comfort: 'cannot_swim' }).path, 'schedule');
});
test('no experience -> learn to swim', () => {
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

test('former NSEA swimmer and other team only flag', () => {
  const r = ev({ formerNsea: true, formerNseaWhen: 'about 2023', otherTeam: true, otherTeamName: 'Rival SC' });
  assert.equal(r.path, 'schedule');
  assert.deepEqual(codes(r), ['former_nsea', 'other_team']);
  assert.match(r.flags[0].message, /about 2023/);
  assert.match(r.flags[1].message, /Rival SC/);
  assert.equal(ev({ otherTeam: true }).ok, false);
});
test('how you heard is optional but must be a listed choice', () => {
  assert.equal(ev({}).heard, undefined);
  assert.equal(ev({ heard: 'friend' }).heard, 'friend');
  assert.equal(ev({ heard: 'bogus' }).ok, false);
});
test('duplicate open requests are found by email and swimmer name', { skip: !DatabaseSync }, async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const stmt = (sql, b = []) => ({ all: async () => ({ results: db.prepare(sql).all(...b) }), bind: (...nb) => stmt(sql, nb) });
  const env = { DB: { prepare: (sql) => stmt(sql) } };
  const ins = db.prepare(`INSERT INTO assess_requests (status, contact_name, contact_email, swimmer_name) VALUES (?, 'Pat', ?, ?)`);
  ins.run('new', 'Pat@Example.com ', 'Ava Lee '); ins.run('declined', 'pat@example.com', 'Ava Lee'); ins.run('new', 'other@example.com', 'Ava Lee');
  const m = await findDuplicateRequests(env, { swimmerName: 'ava lee', email: 'pat@example.com' });
  assert.equal(m.length, 1);
  assert.deepEqual(await findDuplicateRequests(env, { swimmerName: '', email: 'pat@example.com' }), []);
});
