import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { apiError, handleApi, json } from './api.mjs';
import { InputError } from './engine.mjs';
import { readBody, send } from './http.mjs';
import { connectHostedWorkspace } from './turso.mjs';

const shell = readFileSync(new URL('./public/index.html', import.meta.url));
const hash = value => createHash('sha256').update(value).digest();

export function createHostedApp({
  connect = connectHostedWorkspace,
  accessToken = process.env.WATCHER_ACCESS_TOKEN,
  hosted = process.env.VERCEL === '1',
  now = Date.now,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  let workspace;
  const expectedAuthorization = /^[!-~]{24,128}$/.test(accessToken ?? '')
    ? hash(`Basic ${Buffer.from(`watcher:${accessToken}`).toString('base64')}`) : null;

  app.use(async (request, response) => {
    try {
      if (!expectedAuthorization) throw new InputError('The workspace administrator must configure access.', 503);
      const received = (request.headers.authorization ?? '').replace(/^basic /i, 'Basic ');
      if (!timingSafeEqual(hash(received), expectedAuthorization)) {
        send(response, {
          ...json(401, { error: 'Sign in to open THE WATCHER.' }),
          headers: { 'WWW-Authenticate': 'Basic realm="THE WATCHER", charset="UTF-8"' },
        });
        return;
      }
      const base = `${hosted ? 'https' : 'http'}://${request.headers.host}`;
      const url = new URL(request.originalUrl, base);
      if (request.headers.origin && request.headers.origin !== base) {
        throw new InputError('The request origin is outside the workspace.', 403);
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(response, { status: 200, type: 'text/html; charset=utf-8', body: shell });
        return;
      }
      if (!url.pathname.startsWith('/api/')) throw new InputError('This route was not found.', 404);
      workspace ??= connect();
      const result = await handleApi({
        ...workspace, method: request.method, url, readBody: () => readBody(request), now,
      });
      send(response, result);
    } catch (error) {
      if (!response.destroyed) send(response, apiError(error));
    }
  });
  return app;
}

export default createHostedApp();
