import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { emptyState, InputError } from './engine.mjs';
import { seed } from './demo.mjs';
import { apiError, handleApi } from './api.mjs';
import { readBody, send } from './http.mjs';
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
].map(([route, [file, type]]) => [route, { type, body: readFileSync(new URL(`./public/${file}`, import.meta.url)) }]));

function assertLocal(request) {
  const host = request.headers.host;
  if (!host || !/^(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)) {
    throw new InputError('Use the local address for THE WATCHER.', 403);
  }
  if (request.headers.origin && request.headers.origin !== `http://${host}`) {
    throw new InputError('The request origin is outside the local workspace.', 403);
  }
}

export function createApp({ database = ':memory:', demo = true, now = Date.now } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL);`);
  const read = db.prepare('SELECT state FROM workspace WHERE id = 1');
  const write = db.prepare('UPDATE workspace SET state = ? WHERE id = 1');
  if (!read.get()) {
    db.prepare('INSERT OR IGNORE INTO workspace (id, state) VALUES (1, ?)')
      .run(JSON.stringify(demo ? seed(now()) : emptyState()));
  }
  const state = () => JSON.parse(read.get().state);
  function change(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = state();
      const result = operation(next);
      write.run(JSON.stringify(next));
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const server = createServer(async (request, response) => {
    try {
      assertLocal(request);
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;
      if (request.method === 'GET' && assets.has(pathname)) {
        const asset = assets.get(pathname);
        send(response, { ...asset, status: 200 });
      } else {
        const result = await handleApi({ method: request.method, url, readBody: () => readBody(request), state, change, now });
        send(response, result);
      }
    } catch (error) {
      if (response.destroyed) return;
      send(response, apiError(error));
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configuredDatabase = process.env.THE_WATCHER_DB ?? process.env.ROUTEWATCH_DB;
  const legacyDatabase = fileURLToPath(new URL('./data/routewatch.sqlite', import.meta.url));
  const defaultDatabase = fileURLToPath(new URL('./data/the-watcher.sqlite', import.meta.url));
  const database = configuredDatabase
    ? resolve(configuredDatabase)
    : existsSync(legacyDatabase) ? legacyDatabase : defaultDatabase;
  const port = Number(process.env.PORT ?? 4173);
  const server = createApp({ database, demo: !process.argv.includes('--empty') });
  server.listen(port, '127.0.0.1', () => console.log(`THE WATCHER is running at http://127.0.0.1:${server.address().port}`));
}
