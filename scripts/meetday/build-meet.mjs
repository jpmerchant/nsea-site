#!/usr/bin/env node
// Builds a Meet Day package (one JSON file) from a meet folder: the host's heat sheet PDFs, our HY3 entry file,
// the live Top 10 / team record board JSON and the standards JSON. Upload the result in the app (Meet Day > Load meet).
//
//   node scripts/meetday/build-meet.mjs "<meet folder>/meetday/meetday.config.json" [out.json]
//
// Paths in the config are relative to the config file. The package holds swimmer names, ages and seed times,
// so it is written next to the config (in the private meet folder), never into this repo.
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdf, pdfLines, parseHeatSheet, teamEntries, parseHy3, toCs, sameSwimmer, parseEventTitle } from '../../public/admin/meet/lib/parse.mjs';
import { buildRefs } from '../../public/admin/meet/lib/refs.mjs';
import { entryKey } from '../../public/admin/meet/lib/model.mjs';

const cfgPath = path.resolve(process.argv[2] || '');
if (!fs.existsSync(cfgPath)) { console.error('usage: build-meet.mjs <meetday.config.json> [out.json]'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const base = path.dirname(cfgPath);
const at = (p) => path.resolve(base, p);
const meetDir = fs.existsSync(at(cfg.hy3)) ? base : path.dirname(base);
const inMeet = (p) => (fs.existsSync(at(p)) ? at(p) : path.resolve(meetDir, p));

const team = new RegExp(cfg.teamMatch || 'nsea', 'i');
const hy = parseHy3(fs.readFileSync(inMeet(cfg.hy3), 'latin1'));
const swimmers = hy.swimmers.map((s) => ({ id: s.id, name: `${cap(s.last)}, ${s.first}`, first: s.first, last: cap(s.last), sex: s.sex, age: s.age }));
const byId = new Map(swimmers.map((s) => [s.id, s]));

// Events: titles from heat sheets, then config, then HY3 (distance/stroke)
const events = {};
const sessOf = {};
for (const s of cfg.sessions) for (const [num, round, start, title] of s.events) {
  (sessOf[num] ||= []).push({ session: s.n, round, start: start || null });
  if (title) events[num] = { num, ...parseEventTitle(`Event ${num} ${title.replace(/(\d+) /, '$1 Yard ')}`) };
}
const sheetEntries = [];
const report = [];
for (const f of cfg.heatSheets) {
  const pages = await readPdf(pdfjs, new Uint8Array(fs.readFileSync(inMeet(f))));
  const p = parseHeatSheet(pdfLines(pages));
  for (const e of p.events) {
    const { heats, ...meta } = e;
    events[e.num] = { ...events[e.num], ...meta, heatCount: heats.length, heatStarts: heats.map((h) => h.start), lanesTotal: heats.reduce((n, h) => n + h.lanes.length, 0) };
  }
  const mine = teamEntries(p, team);
  report.push(`${f}: ${p.session} · ${p.events.length} events · ${mine.length} ${cfg.teamName} swims`);
  for (const x of mine) sheetEntries.push({ ...x, sheet: f, sessionName: p.session });
}

// Entries: HY3 is the master list (every swim we entered); heat sheets add heat, lane, start and the host's seed.
const entries = [];
const unmatched = [];
for (const e of hy.entries) {
  const s = byId.get(e.swimmerId);
  if (!s) continue;
  if (!events[e.event]) events[e.event] = { num: e.event, sex: s.sex, dist: e.dist, stroke: e.stroke, course: 'SCY', title: `${s.sex === 'F' ? 'Girls' : 'Boys'} ${e.dist} ${e.stroke}` };
  const first = (sessOf[e.event] || [])[0];
  const hs = sheetEntries.find((x) => x.event === e.event && sameSwimmer(x.name, s.name));
  entries.push({
    id: entryKey(e.event, first ? first.round : 'Finals', s.id), swimmerId: s.id, event: e.event,
    session: first ? first.session : null, round: first ? first.round : 'Finals',
    heat: hs ? hs.heat : null, heats: hs ? hs.heats : null, lane: hs ? hs.lane : null, start: hs ? hs.start : (first && first.start) || null,
    seed: hs ? hs.seed : e.seed, entrySeed: e.seed, source: hs ? 'heat sheet' : 'entries',
  });
}
for (const x of sheetEntries) if (!entries.some((e) => e.event === x.event && sameSwimmer(byId.get(e.swimmerId).name, x.name))) unmatched.push(x);
for (const x of unmatched) {
  // On the heat sheet but not in our entry file (late add): keep it, as a swimmer without HY3 data
  let s = swimmers.find((y) => sameSwimmer(y.name, x.name));
  if (!s) { s = { id: 1000 + swimmers.length, name: x.name, first: x.name.split(',')[1]?.trim() || '', last: x.name.split(',')[0], sex: events[x.event]?.sex || 'X', age: x.age }; swimmers.push(s); byId.set(s.id, s); }
  const first = (sessOf[x.event] || [])[0];
  entries.push({ id: entryKey(x.event, first ? first.round : x.round, s.id), swimmerId: s.id, event: x.event, session: first?.session ?? null, round: first?.round || x.round, heat: x.heat, heats: x.heats, lane: x.lane, start: x.start, seed: x.seed, entrySeed: null, source: 'heat sheet (not in entry file)' });
}

const refs = buildRefs({
  records: JSON.parse(fs.readFileSync(at(cfg.boards.records), 'utf8')),
  top10: JSON.parse(fs.readFileSync(at(cfg.boards.top10), 'utf8')),
  standards: JSON.parse(fs.readFileSync(at(cfg.standards), 'utf8')),
  sexes: new Set(swimmers.map((s) => s.sex)),
  events: new Set(Object.values(events).map((e) => `${e.dist} ${e.stroke}`)),
});

const pkg = {
  format: 'nsea-meetday/1', id: cfg.id, name: cfg.name, short: cfg.short, host: cfg.host, venue: cfg.venue,
  start: cfg.start, end: cfg.end, course: cfg.course || 'SCY', teamName: cfg.teamName || 'NSEA', teamMatch: cfg.teamMatch || 'nsea',
  general: cfg.general || [], sessions: cfg.sessions.map((s) => ({ ...s, events: s.events.map(([num, round, start]) => ({ num, round, start: start || null })) })),
  events, swimmers, entries, refs, builtAt: new Date().toISOString(), sources: [cfg.hy3, ...cfg.heatSheets],
};
const out = path.resolve(process.argv[3] || path.join(base, `${cfg.id}.meetday.json`));
fs.writeFileSync(out, JSON.stringify(pkg));
console.log(report.join('\n'));
console.log(`${swimmers.length} swimmers · ${entries.length} swims (${entries.filter((e) => e.heat).length} with heat/lane) · ${unmatched.length} heat-sheet swims not in the entry file`);
console.log('wrote', out, Math.round(fs.statSync(out).size / 1024) + ' KB');

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
void toCs;
