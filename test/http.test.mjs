import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server.mjs';

async function start(database) {
  const server = createApp({ database, now: () => Date.parse('2026-11-20T12:00:00Z') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  return {
    request(path, method = 'GET', body, headers = {}) {
      return fetch(address + path, { method,
        headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
    },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('local HTTP endpoints enforce scope and persist import, review and pause decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'the-watcher-http-'));
  const database = join(directory, 'test.sqlite');
  let app;
  try {
    app = await start(database);
    const ui = await app.request('/');
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /<title>THE WATCHER/);
    assert.ok(ui.headers.get('content-security-policy'));
    assert.equal((await app.request('/api/workspace', 'GET', undefined, { Origin: 'https://outside.test' })).status, 403);
    assert.equal((await app.request('/api/workspace?days=3')).status, 400);
    const initial = await (await app.request('/api/workspace')).json();
    const fixture = await (await app.request('/api/sample')).json();
    const [first, other] = await Promise.all([
      app.request('/api/imports', 'POST', fixture),
      app.request('/api/imports', 'POST', fixture),
    ]);
    assert.deepEqual([first.status, other.status].sort(), [201, 409]);
    assert.equal((await app.request('/api/imports', 'POST', {} , { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await app.request('/api/imports', 'POST', { oversized: 'x'.repeat(270_000) })).status, 413);
    const initialCritical = initial.findings.find(item => item.severity === 'critical');
    const findingUrl = `/api/findings/${initialCritical.id}`;
    assert.equal((await app.request(findingUrl, 'PATCH', { action: 'review' })).status, 200);
    const fix = await (await app.request('/api/sample?kind=fix')).json();
    assert.equal((await app.request('/api/imports', 'POST', fix)).status, 201);
    assert.equal((await app.request(findingUrl, 'PATCH', { action: 'retest' })).status, 200);
    const report = await app.request(findingUrl + '/ticket');
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('content-disposition'), `attachment; filename="${initialCritical.id}.md"`);
    assert.match(await report.text(), /Status: Resolved[\s\S]*Verified on travel/);
    assert.equal((await app.request('/api/intake', 'PATCH', { paused: true })).status, 200);
    assert.equal((await app.request('/api/imports', 'POST', fixture)).status, 409);
    await app.close();
    app = await start(database);
    const restored = await (await app.request('/api/workspace')).json();
    assert.equal(restored.paused, true);
    assert.equal(restored.findings.find(item => item.id === initialCritical.id).status, 'resolved');
    assert.equal(restored.runs.length, initial.runs.length + 2);
    assert.ok(restored.audit.some(entry => entry.event === 'Retest verified'));
  } finally {
    await app?.close();
    await rm(database, { force: true });
    await rmdir(directory);
  }
});
