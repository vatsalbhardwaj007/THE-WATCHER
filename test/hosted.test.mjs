import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { createHostedApp } from '../app.mjs';
import { createHostedWorkspace } from '../turso.mjs';

const accessToken = 'test-only-access-token-for-hosted-tests';
const authorization = `Basic ${Buffer.from(`watcher:${accessToken}`).toString('base64')}`;
const now = () => Date.parse('2026-11-20T12:00:00Z');

test('hosted requests require access and concurrent imports do not overwrite each other', async () => {
  const client = createClient({ url: 'file::memory:' });
  const app = createHostedApp({ accessToken, now, hosted: false, connect: () => createHostedWorkspace(client, now) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(url + path, { headers: { authorization, ...headers } });
  try {
    const unauthenticated = await fetch(url + '/api/workspace');
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate'), /^Basic/);
    assert.equal((await get('/api/workspace', { origin: 'https://outside.test' })).status, 403);
    assert.match(await (await get('/')).text(), /<title>THE WATCHER/);
    const before = await (await get('/api/workspace')).json();
    const sample = await (await get('/api/sample')).json();
    const post = body => fetch(url + '/api/imports', {
      method: 'POST', headers: { authorization, 'Content-Type': 'application/json', origin: url },
      body: JSON.stringify(body),
    });
    const duplicates = await Promise.all([post(sample), post(sample)]);
    assert.deepEqual(duplicates.map(result => result.status).sort(), [201, 409]);
    const distinct = await Promise.all([post({ ...sample, id: 'release-a' }), post({ ...sample, id: 'release-b' })]);
    assert.ok(distinct.every(result => result.status === 201));
    const after = await (await get('/api/workspace')).json();
    assert.equal(after.runs.length, before.runs.length + 3);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    client.close();
  }
});
