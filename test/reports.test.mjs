import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReportsAdmin } from '../worker/reports.mjs';

function fakeR2() {
  const m = new Map();
  return {
    m,
    async put(k, v) { m.set(k, { v, uploaded: new Date('2026-11-10') }); },
    async get(k) { const o = m.get(k); return o ? { body: o.v } : null; },
    async delete(k) { m.delete(k); },
    async list() { return { objects: [...m].map(([key, o]) => ({ key, size: String(o.v).length, uploaded: o.uploaded })) }; },
  };
}
const owner = { email: 'o@x.org', roles: ['owner'] };
const coach = { email: 'c@x.org', roles: ['reports'] };
const html = '<!DOCTYPE html><html><body>hi</body></html>';

test('owner uploads, coach lists and views, coach cannot upload or delete', async () => {
  const env = { REPORTS: fakeR2() };
  const log = [];
  const audit = async (...a) => log.push(a);
  assert.equal((await handleReportsAdmin(env, owner, 'POST', '/reports/upload', { name: 'NSEA Swimmer Report.html', html }, audit)).status, 200);
  const list = await (await handleReportsAdmin(env, coach, 'GET', '/reports', {}, audit)).json();
  assert.equal(list.owner, false);
  assert.equal(list.reports[0].name, 'NSEA Swimmer Report.html');
  const view = await handleReportsAdmin(env, coach, 'GET', '/reports/view/' + encodeURIComponent('NSEA Swimmer Report.html'), {}, audit);
  assert.equal(view.headers.get('cache-control'), 'private, no-store');
  assert.equal((await handleReportsAdmin(env, coach, 'POST', '/reports/upload', { name: 'a.html', html }, audit)).status, 403);
  assert.equal((await handleReportsAdmin(env, coach, 'POST', '/reports/delete', { name: 'NSEA Swimmer Report.html' }, audit)).status, 403);
  assert.ok(log.some((l) => l[1] === 'view report'));
});

test('rejects bad names, path tricks, non-html and missing bucket', async () => {
  const env = { REPORTS: fakeR2() };
  const audit = async () => {};
  for (const name of ['../x.html', 'x.txt', '.html', 'a/b.html'])
    assert.equal((await handleReportsAdmin(env, owner, 'POST', '/reports/upload', { name, html }, audit)).status, 400);
  assert.equal((await handleReportsAdmin(env, owner, 'POST', '/reports/upload', { name: 'a.html', html: 'plain text' }, audit)).status, 400);
  assert.equal((await handleReportsAdmin(env, coach, 'GET', '/reports/view/..%2Fsecret.html', {}, audit)).status, 404);
  assert.equal((await handleReportsAdmin({}, owner, 'GET', '/reports', {}, audit)).status, 503);
});
