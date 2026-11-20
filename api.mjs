import { audit, ingest, InputError, snapshot, updateFinding } from './engine.mjs';
import { sample } from './demo.mjs';
import { ticket } from './report.mjs';

export const POLICIES = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function json(status, payload) {
  return { status, type: 'application/json; charset=utf-8', body: JSON.stringify(payload) };
}

export function apiError(error) {
  if (error instanceof InputError) return json(error.status, { error: error.message });
  console.error(error);
  return json(500, { error: 'The workspace could not complete the request.' });
}

export async function handleApi({ method, url, readBody, state, change, now }) {
  const { pathname, searchParams } = url;
  const findingRoute = /^\/api\/findings\/(RW-\d+)(\/ticket)?$/.exec(pathname);
  if (method === 'GET' && pathname === '/api/workspace') {
    const days = searchParams.get('days') ?? '30';
    if (!['30', '90'].includes(days)) throw new InputError('Use a 30 or 90 day inventory window.');
    return json(200, snapshot(await state(), Number(days), now()));
  }
  if (method === 'GET' && pathname === '/api/sample') {
    const kind = searchParams.get('kind') ?? 'release';
    if (!['release', 'fix'].includes(kind)) throw new InputError('Choose a release or fix sample.');
    return json(200, sample(await state(), kind, now()));
  }
  if (method === 'GET' && findingRoute?.[2]) {
    const id = findingRoute[1];
    const current = await state();
    const finding = Object.values(current.findings).find(item => item.id === id);
    if (!finding) throw new InputError('Finding was not found.', 404);
    return { status: 200, type: 'text/markdown; charset=utf-8', body: ticket(finding, current.endpoints[finding.routeId]),
      headers: { 'Content-Disposition': `attachment; filename="${id}.md"` } };
  }
  if (method === 'POST' && pathname === '/api/imports') {
    const body = await readBody();
    const time = now();
    return json(201, await change(current => ingest(current, body, time)));
  }
  if (method === 'PATCH' && pathname === '/api/intake') {
    const body = await readBody();
    if (typeof body?.paused !== 'boolean') throw new InputError('Supply a paused boolean.');
    const time = new Date(now()).toISOString();
    return json(200, await change(current => {
      if (current.paused !== body.paused) {
        current.paused = body.paused;
        audit(current, body.paused ? 'Intake paused' : 'Intake resumed', 'Workspace intake control', time);
      }
      return { paused: current.paused };
    }));
  }
  if (method === 'PATCH' && findingRoute && !findingRoute[2]) {
    const body = await readBody();
    const time = now();
    return json(200, await change(current => updateFinding(current, findingRoute[1], body?.action, time)));
  }
  throw new InputError('This route was not found.', 404);
}
