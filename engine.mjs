import { randomUUID } from 'node:crypto';

export const DAY = 86_400_000;
export const services = {
  'travel-staging': 'Travel staging',
};

export const rules = {
  tenantBoundary: {
    title: 'Booking ownership mismatch', severity: 'critical', owner: 'Booking Platform',
    description: 'A trusted application assertion recorded a mismatch between the agency associated with the decision and the booking owner.',
    fix: 'Enforce the agency ownership predicate at the booking service boundary and verify it in integration tests.',
  },
  refundLedger: {
    title: 'Refund ledger inconsistency', severity: 'high', owner: 'Payments',
    description: 'A trusted ledger assertion reported that the recorded refund violated the original settlement invariant.',
    fix: 'Enforce the refund invariant and idempotency within the ledger transaction.',
  },
  fareIntegrity: {
    title: 'Fare integrity assertion failed', severity: 'high', owner: 'Pricing',
    description: 'A trusted application assertion reported a difference between the committed amount and the authoritative fare.',
    fix: 'Calculate the final charge from the authoritative quote at commit time.',
  },
  responsePrivacy: {
    title: 'Response privacy policy violation', severity: 'medium', owner: 'Platform Security',
    description: 'A trusted response classifier reported a protected field class on this route.',
    fix: 'Review the response serializer and allow only the fields required by the caller.',
  },
};

export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const exposures = ['None', 'Booking metadata', 'Payment metadata', 'Contact data', 'Travel data', 'Unknown'];
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9 .&_-]{0,59}$/;
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const routePattern = /^\/(?:(?:[a-z][a-z-]{0,39}|v[0-9]{1,3}|\{[a-zA-Z][a-zA-Z0-9_]{0,29}\})(?:\/|$)){1,12}$/;

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireInput(condition, message) {
  if (!condition) throw new InputError(message);
}

export function dateAt(offset, now = Date.now()) {
  return new Date(now + offset * DAY).toISOString();
}

function timestamp(value, now) {
  requireInput(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'Use ISO 8601 timestamps with a time zone.');
  const parsed = Date.parse(value);
  requireInput(Number.isFinite(parsed) && parsed <= now, 'Timestamps must be valid and at or before the current time.');
  return new Date(parsed).toISOString();
}

function object(value, keys, label) {
  requireInput(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  requireInput(Object.keys(value).every(key => keys.includes(key)), `${label} includes unsupported fields. Import aggregate records only.`);
}

export function endpointKey(service, method, route) {
  return `${service}|${method}|${route}`;
}

function endpointFields(row) {
  requireInput(methods.includes(row.method), 'Use a supported uppercase HTTP method.');
  requireInput(typeof row.route === 'string' && row.route.length <= 230 && routePattern.test(row.route), 'Use a route template such as /api/v3/bookings/{id}, without a hostname or query.');
  return { method: row.method, route: row.route.replace(/\/$/, '') };
}

export function parseImport(input, now = Date.now()) {
  object(input, ['id', 'release', 'service', 'deployedAt', 'coverageStart', 'coverageEnd', 'manifest', 'traffic', 'assertions'], 'Import');
  requireInput(typeof input.id === 'string' && safeId.test(input.id), 'Supply a valid import ID.');
  requireInput(typeof input.release === 'string' && safeId.test(input.release), 'Supply a valid release ID.');
  requireInput(Object.hasOwn(services, input.service), 'Service is outside the workspace scope.');
  const deployedAt = timestamp(input.deployedAt, now);
  const coverageStart = input.coverageStart == null ? null : timestamp(input.coverageStart, now);
  const coverageEnd = input.coverageEnd == null ? null : timestamp(input.coverageEnd, now);
  requireInput((!coverageStart && !coverageEnd) || (coverageStart && coverageEnd && coverageStart <= coverageEnd),
    'Supply an ordered pair of traffic coverage timestamps.');
  const lists = ['manifest', 'traffic', 'assertions'];
  for (const name of lists) {
    requireInput(input[name] === undefined || (Array.isArray(input[name]) && input[name].length <= 500), `${name} must be an array of up to 500 rows.`);
  }
  requireInput(lists.some(name => input[name]?.length), 'Provide at least one manifest, traffic, or assertion row.');
  const manifest = (input.manifest ?? []).map(row => {
    object(row, ['method', 'route', 'documented', 'reachable', 'auth', 'data', 'owner'], 'Manifest row');
    requireInput(typeof row.documented === 'boolean' && typeof row.reachable === 'boolean', 'Manifest rows require documented and reachable flags.');
    requireInput(['Required', 'Public', 'Unknown'].includes(row.auth) && exposures.includes(row.data), 'Use a supported auth and data classification.');
    requireInput(typeof row.owner === 'string' && ownerPattern.test(row.owner), 'Supply a team name for the owner.');
    return { ...endpointFields(row), documented: row.documented, reachable: row.reachable, auth: row.auth, data: row.data, owner: row.owner };
  });
  requireInput(new Set(manifest.map(row => endpointKey(input.service, row.method, row.route))).size === manifest.length, 'Each manifest route must occur once per import.');
  const traffic = (input.traffic ?? []).map(row => {
    object(row, ['method', 'route', 'lastSeen', 'count'], 'Traffic row');
    const lastSeen = timestamp(row.lastSeen, now);
    requireInput(Number.isInteger(row.count) && row.count > 0 && row.count <= 10_000_000, 'Traffic count must be a positive integer up to 10,000,000.');
    return { ...endpointFields(row), lastSeen, count: row.count };
  });
  const assertions = (input.assertions ?? []).map(row => {
    object(row, ['method', 'route', 'rule', 'outcome', 'observedAt', 'reference'], 'Assertion row');
    requireInput(Object.hasOwn(rules, row.rule), 'Choose a supported assertion rule.');
    requireInput(['pass', 'fail'].includes(row.outcome), 'Assertion outcome must be pass or fail.');
    requireInput(typeof row.reference === 'string' && safeId.test(row.reference), 'Use an opaque assertion reference ID.');
    const observedAt = timestamp(row.observedAt, now);
    requireInput(observedAt >= deployedAt, 'Assertions must occur on or after deployment.');
    return { ...endpointFields(row), rule: row.rule, outcome: row.outcome, observedAt, reference: row.reference };
  });
  return { id: input.id, release: input.release, service: input.service, deployedAt, coverageStart, coverageEnd, manifest, traffic, assertions };
}

export function emptyState() {
  return { endpoints: {}, findings: {}, passedAssertions: {}, runs: [], audit: [], coverage: {}, paused: false };
}

export function audit(state, event, detail, at) {
  state.audit.unshift({ id: randomUUID(), event, detail, at });
}

export function classify(endpoint, coverage, days, now) {
  const cutoff = dateAt(-days, now);
  const recentlySeen = endpoint.lastSeen && endpoint.lastSeen >= cutoff;
  if (recentlySeen && !endpoint.documented) return 'shadow';
  if (endpoint.reachable === false) return 'retired';
  if (recentlySeen) return 'active';
  const routeExisted = [endpoint.firstManifest, endpoint.lastSeen].some(value => value && value <= cutoff);
  if (endpoint.reachable === true && routeExisted
    && coverage?.some(window => window.start <= cutoff && window.end >= dateAt(-1, now))) return 'zombie';
  return 'unobserved';
}

function newEndpoint(key, service, row) {
  return { id: key, service, method: row.method, route: row.route, documented: false, reachable: null,
    auth: 'Unknown', data: 'Unknown', owner: 'Unassigned', lastSeen: null, manifestAt: null, firstManifest: null };
}

function addCoverage(current, incoming) {
  const ordered = [...(current ?? []), incoming].sort((a, b) => a.start.localeCompare(b.start));
  const merged = [];
  for (const window of ordered) {
    const previous = merged.at(-1);
    if (!previous || window.start > previous.end) merged.push({ ...window });
    else if (window.end > previous.end) previous.end = window.end;
  }
  return merged;
}

function applyAssertion(state, row, input) {
  const routeId = endpointKey(input.service, row.method, row.route);
  state.endpoints[routeId] ??= newEndpoint(routeId, input.service, row);
  const key = `${routeId}|${row.rule}`;
  const existing = state.findings[key];
  const evidence = { outcome: row.outcome, reference: row.reference, observedAt: row.observedAt,
    release: input.release, deployedAt: input.deployedAt, importId: input.id };
  const previous = existing?.evidence ?? state.passedAssertions[key] ?? [];
  if (previous.some(item => item.reference === row.reference)) return 'duplicate';
  if (!existing && row.outcome === 'pass') {
    state.passedAssertions[key] = [...previous, evidence];
    return 'clear';
  }
  if (!existing) {
    const { title, severity, owner, description, fix } = rules[row.rule];
    state.findings[key] = { id: `RW-${String(Object.keys(state.findings).length + 101)}`, routeId, rule: row.rule,
      title, severity, owner, description, fix, status: 'open', firstSeen: row.observedAt,
      lastFailure: evidence, evidence: [...previous, evidence].sort((a, b) => b.observedAt.localeCompare(a.observedAt)), verifiedBy: null };
    delete state.passedAssertions[key];
    return 'created';
  }
  existing.evidence.push(evidence);
  existing.evidence.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  if (row.outcome === 'fail' && row.observedAt < existing.firstSeen) existing.firstSeen = row.observedAt;
  if (row.outcome === 'fail' && row.observedAt >= existing.lastFailure.observedAt) {
    existing.lastFailure = evidence;
    if (existing.status === 'resolved' && row.observedAt >= existing.verifiedBy.observedAt) {
      existing.status = 'open';
      existing.verifiedBy = null;
      return 'reopened';
    }
  }
  return 'added';
}

export function ingest(state, input, now = Date.now()) {
  if (state.paused) throw new InputError('Imports are paused. Resume intake to continue.', 409);
  const payload = parseImport(input, now);
  if (state.runs.some(run => run.id === payload.id)) throw new InputError('This import ID has already been recorded.', 409);
  if (payload.coverageStart) {
    state.coverage[payload.service] = addCoverage(state.coverage[payload.service], { start: payload.coverageStart, end: payload.coverageEnd });
  }

  const changes = [];
  const touched = new Set();
  for (const row of payload.manifest) {
    const key = endpointKey(payload.service, row.method, row.route);
    const endpoint = state.endpoints[key] ??= newEndpoint(key, payload.service, row);
    touched.add(key);
    if (!endpoint.firstManifest || endpoint.firstManifest > payload.deployedAt) endpoint.firstManifest = payload.deployedAt;
    if (endpoint.manifestAt && endpoint.manifestAt > payload.deployedAt) continue;
    const fields = ['documented', 'reachable', 'auth', 'data', 'owner'].filter(field => endpoint[field] !== row[field]);
    if (!endpoint.manifestAt || fields.length) {
      changes.push({ method: row.method, route: row.route, kind: endpoint.manifestAt ? 'Updated' : 'Added to inventory',
        fields: fields.map(name => ({ name, before: endpoint[name], after: row[name] })) });
    }
    Object.assign(endpoint, row, { manifestAt: payload.deployedAt });
  }
  for (const row of payload.traffic) {
    const key = endpointKey(payload.service, row.method, row.route);
    const endpoint = state.endpoints[key] ??= newEndpoint(key, payload.service, row);
    if (!endpoint.lastSeen || endpoint.lastSeen < row.lastSeen) endpoint.lastSeen = row.lastSeen;
    touched.add(key);
  }

  let findings = 0;
  let failures = 0;
  for (const row of payload.assertions.slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    touched.add(endpointKey(payload.service, row.method, row.route));
    const result = applyAssertion(state, row, payload);
    if (result === 'created' || result === 'reopened') findings++;
    if (row.outcome === 'fail' && result !== 'duplicate') failures++;
  }
  const at = new Date(now).toISOString();
  const run = { id: payload.id, release: payload.release, service: payload.service, at, deployedAt: payload.deployedAt,
    touched: touched.size, changed: changes.length, changes, assertions: payload.assertions.length, failures, findings,
    trafficObservations: payload.traffic.reduce((sum, row) => sum + row.count, 0),
    coverageStart: payload.coverageStart, coverageEnd: payload.coverageEnd };
  state.runs.unshift(run);
  audit(state, 'Import processed', `${run.release} · ${run.touched} routes · ${run.findings} new or reopened findings`, at);
  return run;
}

export function updateFinding(state, id, action, now = Date.now()) {
  const finding = Object.values(state.findings).find(item => item.id === id);
  if (!finding) throw new InputError('Finding was not found.', 404);
  if (action === 'review' && finding.status === 'open') {
    finding.status = 'in_review';
  } else if (action === 'retest' && finding.status === 'in_review') {
    const pass = finding.evidence.find(item => item.outcome === 'pass'
      && item.observedAt > finding.lastFailure.observedAt
      && item.deployedAt > finding.lastFailure.deployedAt
      && item.release !== finding.lastFailure.release);
    if (!pass) throw new InputError('A newer deployment with a passing assertion is required.', 409);
    finding.status = 'resolved';
    finding.verifiedBy = pass;
  } else {
    throw new InputError('This action is unavailable for the current finding status.', 409);
  }
  audit(state, action === 'review' ? 'Finding moved to review' : 'Retest verified', `${finding.id} · ${finding.title}`, new Date(now).toISOString());
  return finding;
}

export function snapshot(state, days = 30, now = Date.now()) {
  if (![30, 90].includes(days)) throw new InputError('Use a 30 or 90 day inventory window.');
  const endpoints = Object.values(state.endpoints).map(endpoint => ({
    ...endpoint,
    classification: classify(endpoint, state.coverage[endpoint.service], days, now),
  })).sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
  const findings = Object.values(state.findings).sort((a, b) => b.lastFailure.observedAt.localeCompare(a.lastFailure.observedAt));
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = dateAt(index - 6, now).slice(0, 10);
    const runs = state.runs.filter(run => run.at.startsWith(date));
    return { date, routes: runs.reduce((sum, run) => sum + run.touched, 0), findings: runs.reduce((sum, run) => sum + run.findings, 0) };
  });
  return { endpoints, findings, runs: state.runs, audit: state.audit, trend, paused: state.paused, days, now: new Date(now).toISOString() };
}
