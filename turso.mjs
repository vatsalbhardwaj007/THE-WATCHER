import { createClient } from '@libsql/client/web';
import { seed } from './demo.mjs';
import { InputError } from './engine.mjs';

const selection = 'SELECT state, revision FROM watcher_workspace WHERE id = 1';

export function createHostedWorkspace(client, now = Date.now) {
  let initialization;
  async function initialize() {
    await client.execute(`CREATE TABLE IF NOT EXISTS watcher_workspace (
      id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, state TEXT NOT NULL
    )`);
    if (!(await client.execute(selection)).rows.length) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO watcher_workspace (id, revision, state) VALUES (1, 0, ?)',
        args: [JSON.stringify(seed(now()))],
      });
    }
  }
  async function read() {
    initialization ??= initialize().catch(error => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    const { rows: [row] } = await client.execute(selection);
    return row;
  }
  return {
    async state() {
      return JSON.parse((await read()).state);
    },
    async change(operation) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await read();
        const current = JSON.parse(row.state);
        const result = operation(current);
        const next = JSON.stringify(current);
        if (next === row.state) return result;
        const write = await client.execute({
          sql: 'UPDATE watcher_workspace SET state = ?, revision = revision + 1 WHERE id = 1 AND revision = ?',
          args: [next, row.revision],
        });
        if (write.rowsAffected === 1) return result;
      }
      throw new InputError('The workspace is busy. Retry the request.', 409);
    },
  };
}

export function connectHostedWorkspace(env = process.env) {
  const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = env;
  if (!url && !authToken) {
    let current = seed();
    return {
      storage: 'temporary',
      state: () => current,
      change(operation) {
        const next = structuredClone(current);
        const result = operation(next);
        current = next;
        return result;
      },
    };
  }
  if (!url || !authToken) throw new InputError('The hosted workspace database is awaiting configuration.', 503);
  return createHostedWorkspace(createClient({ url, authToken }));
}
