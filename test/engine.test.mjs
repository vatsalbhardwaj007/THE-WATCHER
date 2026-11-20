import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateAt, emptyState, ingest, snapshot, updateFinding } from '../engine.mjs';
import { sample, seed } from '../demo.mjs';

const now = Date.parse('2026-11-20T12:00:00Z');
const service = 'travel-staging';
const endpoint = { method: 'GET', route: '/api/v3/bookings/{id}' };

test('seeded inventory and trend follow their selected windows', () => {
  const state = seed(now);
  const short = snapshot(state, 30, now);
  const long = snapshot(state, 90, now);
  assert.equal(short.endpoints.length, 16);
  assert.equal(short.endpoints.filter(row => row.classification === 'shadow').length, 2);
  assert.equal(short.endpoints.filter(row => row.classification === 'zombie').length, 2);
  assert.equal(long.endpoints.filter(row => row.classification === 'zombie').length, 1);
  assert.equal(short.trend.length, 7);
  assert.equal(short.trend.reduce((sum, day) => sum + day.findings, 0), 4);
  assert.equal(snapshot(state, 30, now + 2 * 86_400_000).endpoints.filter(row => row.classification === 'zombie').length, 0);
});

test('intake rejects out-of-scope, raw, duplicate and paused imports', () => {
  const state = emptyState();
  const example = sample(state, 'release', now);
  for (const invalid of [
    { ...example, service: 'outside' },
    { ...example, manifest: [{ ...example.manifest[0], route: 'https://example.test/bookings' }] },
    { ...example, traffic: [{ ...example.traffic[0], headers: {} }] },
    { ...example, coverageStart: dateAt(-90, now) },
  ]) {
    assert.throws(() => ingest(state, invalid, now), { status: 400 });
  }
  assert.equal(state.runs.length, 0);
  const run = ingest(state, example, now);
  assert.equal(run.changed, 1);
  assert.equal(run.findings, 1);
  assert.throws(() => ingest(state, example, now), { status: 409 });
  state.paused = true;
  assert.throws(() => ingest(state, sample(state, 'fix', now), now), { status: 409 });
});

test('duplicate evidence stays grouped, fixes require review and a newer deployment, and regressions reopen', () => {
  const state = seed(now);
  const [original] = snapshot(state, 30, now).findings;
  assert.equal(original.title, 'Booking ownership mismatch');
  assert.throws(() => updateFinding(state, original.id, 'retest', now), { status: 409 });
  updateFinding(state, original.id, 'review', now);
  assert.throws(() => updateFinding(state, original.id, 'retest', now), { status: 409 });

  const fix = sample(state, 'fix', now);
  ingest(state, { ...fix, release: original.lastFailure.release }, now);
  assert.throws(() => updateFinding(state, original.id, 'retest', now), { status: 409 });
  ingest(state, {
    ...fix, id: 'next-fix',
    assertions: [{ ...fix.assertions[0], reference: 'valid-fix-observation' }],
  }, now);
  assert.equal(updateFinding(state, original.id, 'retest', now).status, 'resolved');
  const following = now + 60_000;
  const duplicate = ingest(state, {
    id: 'repeated', service, release: 'travel-4.0.0', deployedAt: dateAt(-1, now),
    assertions: [{ ...endpoint, rule: 'tenantBoundary', outcome: 'fail', observedAt: dateAt(0, now),
      reference: original.lastFailure.reference }],
  }, now);
  assert.equal(duplicate.failures, 0);
  const regression = ingest(state, {
    id: 'regression', service, release: 'travel-4.1.0', deployedAt: dateAt(0, now),
    assertions: [{ ...endpoint, rule: 'tenantBoundary', outcome: 'fail', observedAt: dateAt(0, following), reference: 'new-failure' }],
  }, following);
  assert.equal(regression.findings, 1);
  assert.equal(snapshot(state, 30, following).findings.find(item => item.id === original.id).status, 'open');
});

test('recent manifests and separated coverage windows do not establish a zombie', () => {
  const state = emptyState();
  const manifest = [{ ...endpoint, documented: true, reachable: true, auth: 'Required', owner: 'Booking', data: 'Booking metadata' }];
  ingest(state, { id: 'first', release: 'r1', service, deployedAt: dateAt(-100, now),
    coverageStart: dateAt(-100, now), coverageEnd: dateAt(-20, now), manifest }, now);
  ingest(state, { id: 'second', release: 'r2', service, deployedAt: dateAt(0, now),
    coverageStart: dateAt(-10, now), coverageEnd: dateAt(0, now), manifest }, now);
  assert.equal(snapshot(state, 30, now).endpoints[0].classification, 'unobserved');
  ingest(state, { id: 'third', release: 'r3', service, deployedAt: dateAt(0, now),
    coverageStart: dateAt(-20, now), coverageEnd: dateAt(-10, now),
    manifest: [{ ...manifest[0], route: '/api/v3/new-route' }] }, now);
  const list = snapshot(state, 30, now).endpoints;
  assert.equal(list.find(item => item.route === endpoint.route).classification, 'zombie');
  assert.equal(list.find(item => item.route === '/api/v3/new-route').classification, 'unobserved');
});
