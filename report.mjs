const statuses = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const severity = { critical: 'Critical', high: 'High', medium: 'Medium' };

export function ticket(finding, endpoint) {
  return [
    `# ${finding.id} — ${finding.title}`, '',
    `- Severity: ${severity[finding.severity]}`, `- Status: ${statuses[finding.status]}`,
    `- Owner: ${finding.owner}`, `- Route: ${endpoint.method} ${endpoint.route}`, '',
    '## Observed impact', finding.description, '', '## Suggested fix', finding.fix, '', '## Assertion history',
    ...finding.evidence.map(item => `- ${item.outcome === 'pass' ? 'Pass' : 'Fail'} · ${item.reference} · ${item.release} · ${item.observedAt}`),
    ...(finding.verifiedBy ? ['', `Verified on ${finding.verifiedBy.release} using ${finding.verifiedBy.reference}.`] : []),
  ].join('\n') + '\n';
}
