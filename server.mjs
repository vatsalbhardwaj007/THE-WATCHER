import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { audit, emptyState, ingest, InputError, snapshot, updateFinding } from './engine.mjs';
import { sample, seed } from './demo.mjs';
import { ticket } from './report.mjs';

const POLICIES = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
].map(([route, [file, type]]) => [route, { type, body: readFileSync(new URL(`./public/${file}`, import.meta.url)) }]));

function send(response, status, type, body, headers = {}) {
  response.writeHead(status, { ...POLICIES, ...headers, 'Content-Type': type });
  response.end(body);
}

function json(response, status, body) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    request.resume();
    throw new InputError('Set Content-Type to application/json.', 415);
  }
  const maximum = 256 * 1024;
  let length = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maximum) {
      request.resume();
      throw new InputError('Import exceeds 256 KB.', 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('Request body must be valid JSON.');
  }
}

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
        send(response, 200, asset.type, asset.body);
      } else if (request.method === 'GET' && pathname === '/api/workspace') {
        const days = url.searchParams.get('days') ?? '30';
        if (!['30', '90'].includes(days)) throw new InputError('Use a 30 or 90 day inventory window.');
        json(response, 200, snapshot(state(), Number(days), now()));
      } else if (request.method === 'GET' && pathname === '/api/sample') {
        const kind = url.searchParams.get('kind') ?? 'release';
        if (!['release', 'fix'].includes(kind)) throw new InputError('Choose a release or fix sample.');
        json(response, 200, sample(state(), kind, now()));
      } else if (request.method === 'GET' && /^\/api\/findings\/RW-\d+\/ticket$/.test(pathname)) {
        const id = pathname.split('/')[3];
        const current = state();
        const finding = Object.values(current.findings).find(item => item.id === id);
        if (!finding) throw new InputError('Finding was not found.', 404);
        send(response, 200, 'text/markdown; charset=utf-8', ticket(finding, current.endpoints[finding.routeId]), {
          'Content-Disposition': `attachment; filename="${id}.md"`,
        });
      } else if (request.method === 'POST' && pathname === '/api/imports') {
        const body = await readBody(request);
        json(response, 201, change(current => ingest(current, body, now())));
      } else if (request.method === 'PATCH' && pathname === '/api/intake') {
        const body = await readBody(request);
        if (typeof body?.paused !== 'boolean') throw new InputError('Supply a paused boolean.');
        json(response, 200, change(current => {
          if (current.paused !== body.paused) {
            current.paused = body.paused;
            audit(current, body.paused ? 'Intake paused' : 'Intake resumed', 'Workspace intake control', new Date(now()).toISOString());
          }
          return { paused: current.paused };
        }));
      } else if (request.method === 'PATCH' && /^\/api\/findings\/RW-\d+$/.test(pathname)) {
        const body = await readBody(request);
        json(response, 200, change(current => updateFinding(current, pathname.split('/').at(-1), body?.action, now())));
      } else {
        throw new InputError('This route was not found.', 404);
      }
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof InputError) json(response, error.status, { error: error.message });
      else {
        console.error(error);
        json(response, 500, { error: 'The workspace could not complete the request.' });
      }
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
