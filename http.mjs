import { POLICIES } from './api.mjs';
import { InputError } from './engine.mjs';

export function send(response, { status, type, body, headers }) {
  response.writeHead(status, { ...POLICIES, ...headers, 'Content-Type': type });
  response.end(body);
}

export async function readBody(request) {
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
