import { dateAt, emptyState, ingest, updateFinding } from './engine.mjs';

const service = 'travel-staging';
const catalogue = [
  ['GET', '/api/v3/bookings/{id}', 'Booking Platform', 'Booking metadata'],
  ['POST', '/api/v3/bookings', 'Booking Platform', 'Booking metadata'],
  ['GET', '/api/v3/bookings', 'Booking Platform', 'Booking metadata'],
  ['POST', '/api/v3/bookings/{id}/cancel', 'Booking Platform', 'Booking metadata'],
  ['POST', '/api/v3/refunds', 'Payments', 'Payment metadata'],
  ['GET', '/api/v3/refunds/{id}', 'Payments', 'Payment metadata'],
  ['POST', '/api/v3/payments', 'Payments', 'Payment metadata'],
  ['POST', '/api/v3/fares/confirm', 'Pricing', 'Travel data'],
  ['GET', '/api/v3/fares/search', 'Pricing', 'Travel data'],
  ['GET', '/api/v3/suppliers', 'Supplier Integrations', 'None'],
  ['GET', '/api/v3/travellers/{id}', 'Traveller Platform', 'Contact data'],
  ['GET', '/api/v2/bookings/{id}', 'Booking Platform', 'Booking metadata'],
  ['GET', '/api/v1/supplier-status', 'Supplier Integrations', 'None', 'Public'],
  ['GET', '/partner/v2/availability', 'Supplier Integrations', 'Travel data', 'Required', false],
  ['GET', '/api/v3/traveller-summary', 'Traveller Platform', 'Contact data', 'Unknown', false],
  ['GET', '/api/v3/agencies/{id}', 'Identity', 'None'],
];

function manifestEntry([method, route, owner, data, auth = 'Required', documented = true]) {
  return { method, route, owner, data, auth, documented, reachable: true };
}

function assertion(index, rule, outcome, observedAt, reference) {
  const [method, route] = catalogue[index];
  return { method, route, rule, outcome, observedAt, reference };
}

export function seed(now = Date.now()) {
  const state = emptyState();
  const recent = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15];
  const volumes = [6, 9, 7, 11, 8, 13, 10];
  for (const [day, count] of volumes.entries()) {
    const at = new Date(`${dateAt(day - 6, now).slice(0, 10)}T00:00:00.000Z`).getTime();
    const deployedAt = dateAt(-0.08, at);
    const observedAt = dateAt(0, at);
    const assertions = {
      1: [assertion(10, 'responsePrivacy', 'fail', observedAt, 'privacy-019')],
      3: [assertion(7, 'fareIntegrity', 'fail', observedAt, 'fare-052')],
      5: [assertion(4, 'refundLedger', 'fail', observedAt, 'ledger-083')],
      6: [assertion(0, 'tenantBoundary', 'fail', observedAt, 'booking-112')],
    }[day] ?? [];
    ingest(state, {
      id: `seed-${day + 1}`, release: `travel-3.8.${day + 1}`, service, deployedAt,
      coverageStart: day === 6 ? dateAt(-100, now) : undefined,
      coverageEnd: day === 6 ? observedAt : undefined,
      manifest: day === 0 ? catalogue.map(manifestEntry) : [],
      traffic: [...recent.slice(0, count), ...(day === 0 ? [11, 12, ...recent.slice(count)] : [])].map((index, n) => {
        const [method, route] = catalogue[index];
        const lastSeen = index === 11 ? dateAt(-47, now) : index === 12 ? dateAt(-96, now) : observedAt;
        return { method, route, lastSeen, count: (day + 5) * (n + 3) };
      }),
      assertions,
    }, at);
    if (day === 3) updateFinding(state, 'RW-102', 'review', at);
  }
  return state;
}

export function sample(state, kind, now = Date.now()) {
  const next = state.runs.length + 1;
  const deployedAt = new Date(now - 2_000).toISOString();
  const observedAt = new Date(now - 1_000).toISOString();
  const base = { id: `demo-${kind}-${next}`, release: `travel-3.9.${next}`, service, deployedAt };
  if (kind === 'fix') {
    return { ...base, assertions: [assertion(0, 'tenantBoundary', 'pass', observedAt, `booking-fixed-${next}`)] };
  }
  return {
    ...base,
    manifest: [{ method: 'GET', route: '/api/v3/booking-summary', documented: false, reachable: true,
      auth: 'Required', data: 'Booking metadata', owner: 'Booking Platform' }],
    traffic: [{ method: 'GET', route: '/api/v3/booking-summary', lastSeen: observedAt, count: 42 }],
    assertions: [{ method: 'GET', route: '/api/v3/booking-summary', rule: 'responsePrivacy',
      outcome: 'fail', observedAt, reference: `synthetic-privacy-${next}` }],
  };
}
