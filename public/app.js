const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');
const announcements = document.querySelector('#announcements');
const pages = {
  overview: 'Overview', inventory: 'API inventory', findings: 'Findings',
  deployments: 'Deployments', audit: 'Audit log', settings: 'Intake settings',
};
const labels = {
  active: 'Active', zombie: 'Zombie', shadow: 'Shadow', unobserved: 'Unobserved', retired: 'Retired',
  critical: 'Critical', high: 'High', medium: 'Medium', open: 'Open', in_review: 'In review',
  resolved: 'Resolved', pass: 'Pass', fail: 'Fail',
};
const icons = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  network: '<rect x="8" y="3" width="8" height="5" rx="1"/><rect x="2" y="16" width="7" height="5" rx="1"/><rect x="15" y="16" width="7" height="5" rx="1"/><path d="M12 8v4m-7 4v-4h14v4"/>',
  shield: '<path d="M12 22s7-3 7-10V5l-7-3-7 3v7c0 7 7 10 7 10Z"/><path d="M12 8v4m0 3h.01"/>',
  git: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M6 7.5v9M18 8.5c0 7-12 2.5-12 8"/>',
  ledger: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pulse: '<path d="M2 12h4l3-7 4 14 3-7h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const selected = { days: 30, query: '', status: '', severity: '' };
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
let data;
let chartObserver;
let announcementTimer;
let loadSequence = 0;
let demoApi;

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);

function page() {
  const key = location.hash.slice(1);
  return Object.hasOwn(pages, key) ? key : 'overview';
}

async function api(url, method = 'GET', body) {
  if (demoApi) {
    const result = await demoApi(url, method, body);
    return JSON.parse(result.body);
  }
  const response = await fetch(url, method === 'GET' ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  if (payload.storage === 'browser') {
    demoApi = await loadDemo();
    const result = await demoApi(url, method, body);
    return JSON.parse(result.body);
  }
  return payload;
}

async function loadDemo() {
  const [{ handleApi }, { seed }] = await Promise.all([
    import('/demo/api.mjs'), import('/demo/demo.mjs'),
  ]);
  const key = 'the-watcher-demo-v1';
  let current;
  try { current = JSON.parse(sessionStorage.getItem(key)); } catch { /* Storage can be unavailable. */ }
  current ??= seed();
  return (path, method = 'GET', body) => handleApi({
    method, url: new URL(path, location.origin), readBody: () => body,
    state: () => current, storage: 'browser', now: Date.now,
    change(operation) {
      const next = structuredClone(current);
      const result = operation(next);
      current = next;
      try { sessionStorage.setItem(key, JSON.stringify(current)); } catch { /* Keep changes in memory. */ }
      return result;
    },
  });
}

async function refresh() {
  const sequence = ++loadSequence;
  const snapshot = await api(`/api/workspace?days=${selected.days}`);
  if (sequence !== loadSequence) return;
  data = snapshot;
  render();
}

function say(message) {
  announcements.textContent = message;
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => { announcements.textContent = ''; }, 4500);
}

function date(value) {
  return value ? fullDate.format(new Date(value)) : 'Unavailable';
}

function quantity(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function relative(value) {
  const days = Math.max(0, Math.floor((Date.parse(data.now) - Date.parse(value)) / 86_400_000));
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor((Date.parse(data.now) - Date.parse(value)) / 3_600_000);
  return hours > 0 ? `${hours}h ago` : 'Today';
}

function title(text, description, action = '') {
  return `<section class="page-head"><div><h1>${text}</h1><p>${description}</p></div>${action}</section>`;
}

function pill(value) {
  return `<span class="pill ${safe(value)}">${safe(labels[value] ?? value)}</span>`;
}

function select(id, label, options, value) {
  return `<select id="${id}" aria-label="${label}">${options.map(([key, name]) =>
    `<option value="${key}" ${String(value) === String(key) ? 'selected' : ''}>${name}</option>`).join('')}</select>`;
}

function timeWindow() {
  return select('days', 'Inventory window', [[30, 'Last 30 days'], [90, 'Last 90 days']], selected.days);
}

function metric({ name, value, description, iconName, color = '', href, filter = '' }) {
  return `<a href="${href}" data-filter="${filter}" class="metric"><span class="metric-top">${name}
    <span class="metric-icon ${color}" data-icon>${icon(iconName)}</span></span>
    <strong>${value}</strong><small>${description}</small></a>`;
}

function findingTable(items) {
  if (!items.length) return '<p class="empty">No findings match this view.</p>';
  return `<div class="table-scroll" role="region" aria-label="Findings table" tabindex="0"><table>
    <thead><tr><th scope="col">Finding</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Owner</th></tr></thead>
    <tbody>${items.map(item => {
      const endpoint = data.endpoints.find(row => row.id === item.routeId);
      return `<tr><td><button class="details-link" data-action="finding" data-id="${item.id}">${safe(item.title)}</button>
        <span class="table-sub mono">${item.id} · ${safe(endpoint?.route)}</span></td><td>${pill(item.severity)}</td>
        <td>${pill(item.status)}</td><td>${safe(item.owner)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function overview() {
  const latest = data.runs[0];
  const open = data.findings.filter(finding => finding.status !== 'resolved');
  const critical = open.filter(finding => finding.severity === 'critical').length;
  const shadow = data.endpoints.filter(endpoint => endpoint.classification === 'shadow').length;
  const zombie = data.endpoints.filter(endpoint => endpoint.classification === 'zombie').length;
  const metrics = [
    { name: 'API endpoints', value: data.endpoints.length, description: 'Across travel staging', iconName: 'network', href: '#inventory' },
    { name: 'Open findings', value: open.length, description: `${critical} critical`, iconName: 'shield', color: 'rose', href: '#findings', filter: 'unresolved' },
    { name: 'Zombie APIs', value: zombie, description: 'Reachable, no recent traffic', iconName: 'clock', color: 'amber', href: '#inventory', filter: 'zombie' },
    { name: 'Shadow APIs', value: shadow, description: 'Observed, undocumented', iconName: 'eye', color: 'blue', href: '#inventory', filter: 'shadow' },
  ];
  const chartDescription = data.trend.map(item => `${item.date}: ${item.routes} routes processed, ${item.findings} new or reopened findings`).join('. ');
  return `${title('Security overview', 'Deployment evidence and API risk for the travel platform.', timeWindow())}
    <section class="hero">
      <canvas class="radar" aria-hidden="true"></canvas>
      <div class="eyebrow">${icon('pulse')}${latest ? 'LATEST DEPLOYMENT' : 'EVIDENCE INTAKE'}</div>
      <h2>${latest ? safe(latest.release) : 'Ready for your first import'}</h2>
      <p>${latest ? `Travel staging · ${quantity(latest.touched, 'route')} processed · ${latest.findings} new or reopened ${latest.findings === 1 ? 'finding' : 'findings'}` : 'Import a deployment record to start tracking API changes.'}</p>
      ${latest ? `<a href="#deployments">View deployment history${icon('chevron')}</a>` : ''}
    </section>
    <div class="stats">${metrics.map(metric).join('')}</div>
    <div class="dashboard-grid">
      <section class="panel chart-panel"><div class="panel-head"><div><h2>Deployment activity</h2><p>Daily totals · last 7 days</p></div></div>
        <div class="chart-wrap"><canvas class="activity-chart" role="img" aria-label="${safe(chartDescription)}"></canvas></div>
        <div class="legend"><span><i></i>Routes processed</span><span><i class="alt"></i>New or reopened findings</span></div>
      </section>
      <section class="panel"><div class="panel-head"><div><h2>Recent deployments</h2><p>Latest evidence imports</p></div><a href="#deployments">View all</a></div>
        ${data.runs.length ? `<ul class="activity">${data.runs.slice(0, 3).map(run => `<li><button data-action="run" data-id="${safe(run.id)}">
          <span class="metric-icon">${icon('git')}</span><span><strong>${safe(run.release)}</strong><small>${quantity(run.touched, 'route')} · ${quantity(run.findings, 'finding')}</small></span>
          <time datetime="${run.at}">${relative(run.at)}</time></button></li>`).join('')}</ul>` : '<p class="empty">No evidence imports yet.</p>'}
      </section>
    </div>
    <section class="panel"><div class="panel-head"><div><h2>Priority findings</h2><p>Unresolved findings by severity</p></div><a href="#findings">View all</a></div>
      ${findingTable(open.slice().sort((a, b) => ['critical', 'high', 'medium'].indexOf(a.severity) - ['critical', 'high', 'medium'].indexOf(b.severity)).slice(0, 4))}
    </section>`;
}

function toolbar(filter, placeholder) {
  return `<div class="toolbar"><input type="search" id="query" aria-label="${placeholder}" placeholder="${placeholder}" value="${safe(selected.query)}">
    ${filter}<span class="results" id="results" aria-live="polite"></span></div><div id="filtered"></div>`;
}

function inventory() {
  return `${title('API inventory', 'Routes classified using manifests and observed gateway traffic.', timeWindow())}
    <section class="panel">${toolbar(select('status', 'API classification', [['', 'All classifications'],
      ...['active', 'zombie', 'shadow', 'unobserved', 'retired'].map(key => [key, labels[key]])], selected.status), 'Search routes or owners')}
      <p class="summary-line">Zombie requires confirmed reachability, an older route, and gateway coverage current within 24 hours.</p>
    </section>`;
}

function inventoryTable(items) {
  if (!items.length) return '<p class="empty">No endpoints match this view.</p>';
  return `<div class="table-scroll" role="region" aria-label="API routes table" tabindex="0"><table>
    <thead><tr><th scope="col">Route</th><th scope="col">Classification</th><th scope="col">Auth</th><th scope="col">Owner</th><th scope="col">Last seen</th></tr></thead>
    <tbody>${items.map(item => `<tr><td><button class="details-link mono" data-action="endpoint" data-id="${safe(item.id)}"><span class="method">${item.method}</span>${safe(item.route)}</button></td>
      <td>${pill(item.classification)}</td><td>${safe(item.auth)}</td><td>${safe(item.owner)}</td><td>${item.lastSeen ? relative(item.lastSeen) : 'Unavailable'}</td></tr>`).join('')}</tbody></table></div>`;
}

function findings() {
  return `${title('Findings', 'Review business-impact assertions and verify fixes with newer evidence.')}
    <section class="panel">${toolbar(
      select('status', 'Finding status', [['', 'All statuses'], ['unresolved', 'Unresolved'], ...['open', 'in_review', 'resolved'].map(key => [key, labels[key]])], selected.status)
      + select('severity', 'Finding severity', [['', 'All severities'], ...['critical', 'high', 'medium'].map(key => [key, labels[key]])], selected.severity), 'Search findings or owners')}
    </section>`;
}

function deployments() {
  return `${title('Deployments', 'Inspect what each release contributed to the workspace.')}
    <section class="panel">${data.runs.length ? `<div class="table-scroll" role="region" aria-label="Deployment table" tabindex="0"><table>
      <thead><tr><th scope="col">Release</th><th scope="col">Routes</th><th scope="col">Manifest changes</th><th scope="col">Findings</th><th scope="col">Imported</th></tr></thead>
      <tbody>${data.runs.map(run => `<tr><td><button class="details-link" data-action="run" data-id="${safe(run.id)}">${safe(run.release)}</button><span class="table-sub mono">${safe(run.id)}</span></td>
        <td>${run.touched}</td><td>${run.changed}</td><td>${run.findings}</td><td>${date(run.at)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No evidence imports yet.</p>'}</section>`;
}

function auditPage() {
  return `${title('Audit log', 'A record of evidence intake, review decisions, and controls.')}
    <section class="panel">${data.audit.length ? `<div class="table-scroll" role="region" aria-label="Audit table" tabindex="0"><table>
      <thead><tr><th scope="col">Event</th><th scope="col">Detail</th><th scope="col">Time</th></tr></thead>
      <tbody>${data.audit.map(item => `<tr><td>${safe(item.event)}</td><td>${safe(item.detail)}</td><td>${date(item.at)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No workspace activity yet.</p>'}</section>`;
}

function settings() {
  return `${title('Intake settings', 'Manage evidence intake and review the current workspace scope.')}
    <div class="setting-grid"><section class="panel"><div class="panel-head"><h2>Evidence intake</h2>${pill(data.paused ? 'Paused' : 'Accepting evidence')}</div>
      <div class="setting-body"><p>Pause imports while reviewing source data or adjusting the ingestion process.</p>
      <button class="button" data-action="toggle">${data.paused ? 'Resume intake' : 'Pause intake'}</button></div></section>
      <section class="panel"><div class="panel-head"><h2>Workspace scope</h2></div><div class="setting-body">
        <ul><li>Allowed service: <span class="mono">travel-staging</span></li><li>Inputs: route manifests, aggregate traffic, application assertions</li><li>Storage: local SQLite database</li></ul>
      </div></section></div>`;
}

function updateFiltered() {
  const target = document.querySelector('#filtered');
  if (!target) return;
  const search = selected.query.trim().toLowerCase();
  const containsQuery = (...parts) => parts.join(' ').toLowerCase().includes(search);
  const routePage = page() === 'inventory';
  const items = routePage
    ? data.endpoints.filter(item => (!selected.status || item.classification === selected.status) && containsQuery(item.method, item.route, item.owner))
    : data.findings.filter(item => {
      const endpoint = data.endpoints.find(row => row.id === item.routeId);
      const matchesStatus = selected.status === 'unresolved' ? item.status !== 'resolved' : !selected.status || item.status === selected.status;
      return matchesStatus && (!selected.severity || item.severity === selected.severity) && containsQuery(item.title, item.id, item.owner, endpoint?.route);
    });
  target.innerHTML = routePage ? inventoryTable(items) : findingTable(items);
  document.querySelector('#results').textContent = quantity(items.length, routePage ? 'route' : 'finding');
}

function render() {
  if (!data) return;
  chartObserver?.disconnect();
  const current = page();
  const storageStatus = document.querySelector('#storage-status');
  storageStatus.hidden = !data.storage;
  storageStatus.textContent = data.storage === 'browser'
    ? 'Public demo with synthetic data. Changes stay in this browser tab.'
    : 'Temporary demo. Workspace changes can reset until persistent storage is connected.';
  document.title = `${pages[current]} · THE WATCHER`;
  document.querySelector('#breadcrumb').textContent = pages[current];
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === `#${current}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const count = data.findings.filter(item => item.status !== 'resolved').length;
  const badge = document.querySelector('#nav-count');
  badge.textContent = count;
  badge.hidden = !count;
  const status = document.querySelector('#intake-status');
  status.classList.toggle('paused', data.paused);
  status.innerHTML = `<i></i>${data.paused ? 'Intake paused' : 'Intake ready'}`;
  main.innerHTML = { overview, inventory, findings, deployments, audit: auditPage, settings }[current]();
  updateFiltered();
  if (current === 'overview') {
    chartObserver = new ResizeObserver(drawOverview);
    chartObserver.observe(document.querySelector('.activity-chart'));
    chartObserver.observe(document.querySelector('.radar'));
  }
}

function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  return { ctx, width, height };
}

function drawOverview() {
  const chart = document.querySelector('.activity-chart');
  const radar = document.querySelector('.radar');
  if (!chart || !radar) return;
  const { ctx, width, height } = canvasContext(chart);
  const left = 32;
  const bottom = height - 23;
  const top = 10;
  const gap = (width - left - 12) / 7;
  const bar = Math.min(21, gap * .28);
  const max = Math.max(4, Math.ceil(Math.max(...data.trend.map(row => Math.max(row.routes, row.findings))) / 4) * 4);
  ctx.font = '11px Segoe UI, system-ui';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let step = 0; step <= 4; step++) {
    const y = top + (bottom - top) * step / 4;
    ctx.strokeStyle = '#2d332f';
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - 8, y);
    ctx.stroke();
    ctx.fillStyle = '#a1a9a0';
    ctx.fillText(String(max - step * max / 4), left - 7, y);
  }
  ctx.textAlign = 'center';
  for (const [index, row] of data.trend.entries()) {
    const x = left + gap * (index + .5);
    const routes = row.routes / max * (bottom - top);
    const findings = row.findings / max * (bottom - top);
    ctx.fillStyle = '#d5ef7f';
    ctx.beginPath();
    if (routes) ctx.roundRect(x - bar - 2, bottom - routes, bar, routes, [3, 3, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#91a7ef';
    ctx.beginPath();
    if (findings) ctx.roundRect(x + 2, bottom - findings, bar, findings, [3, 3, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#a1a9a0';
    ctx.fillText(shortDate.format(new Date(row.date)), x, height - 9);
  }
  drawRadar(radar);
}

function drawRadar(canvas) {
  const { ctx, width, height } = canvasContext(canvas);
  const x = width * .70;
  const y = height * .93;
  const step = Math.max(21, width * .074);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#aaca5d37';
  for (let ring = 1; ring <= 7; ring++) {
    ctx.beginPath();
    ctx.arc(x, y, ring * step, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * step * 7, y + Math.sin(angle) * step * 7);
    ctx.stroke();
  }
  const marks = [[.09, .83], [.29, .73], [.39, .45], [.55, .52], [.70, .25], [.82, .34], [.97, .07]];
  const trace = ctx.createLinearGradient(0, height, width, 0);
  trace.addColorStop(0, '#b7de5900');
  trace.addColorStop(.35, '#b7de5977');
  trace.addColorStop(1, '#e3ff90');
  ctx.strokeStyle = trace;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const [index, [px, py]] of marks.entries()) {
    if (index === 0) ctx.moveTo(px * width, py * height);
    else ctx.lineTo(px * width, py * height);
  }
  ctx.stroke();
  for (const [px, py] of marks.slice(2)) {
    ctx.beginPath();
    ctx.fillStyle = '#dafa82';
    ctx.arc(px * width, py * height, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = '#dafa8260';
    ctx.arc(px * width, py * height, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function showDialog(title, subtitle, body) {
  dialogContent.innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${safe(title)}</h2>
    ${subtitle ? `<p>${safe(subtitle)}</p>` : ''}</div>
    <button class="button quiet icon-button" data-action="close" aria-label="Close dialog">${icon('x')}</button></div>
    <div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function showImport() {
  showDialog('Import evidence', 'Travel staging · JSON evidence bundle', `
    <div class="sample-actions"><button class="button" type="button" data-action="sample" data-id="release">Load sample release</button>
    <button class="button" type="button" data-action="sample" data-id="fix">Load sample fix</button></div>
    <form id="import-form">
      <label for="file">Choose a JSON file</label><input id="file" type="file" accept="application/json,.json">
      <label for="import-json">Evidence JSON</label><textarea id="import-json" spellcheck="false" placeholder="Paste evidence JSON or load a sample." required></textarea>
      <p id="form-message" class="form-message" role="alert"></p>
      <div class="dialog-actions"><button type="submit" class="button primary">Process evidence</button>
      <button type="button" class="button quiet" data-action="close">Cancel</button></div>
    </form>`);
}

function facts(pairs) {
  return `<dl class="facts">${pairs.map(([name, value]) => `<div><dt>${safe(name)}</dt><dd>${safe(value)}</dd></div>`).join('')}</dl>`;
}

function displayFinding(id) {
  const finding = data.findings.find(item => item.id === id);
  const endpoint = data.endpoints.find(item => item.id === finding.routeId);
  const action = finding.status === 'open' ? ['review', 'Start review']
    : finding.status === 'in_review' ? ['retest', 'Verify retest'] : null;
  showDialog(finding.title, `${id} · ${endpoint.method} ${endpoint.route}`, `
    ${facts([['Severity', labels[finding.severity]], ['Status', labels[finding.status]], ['Owner', finding.owner], ['First observed', date(finding.firstSeen)]])}
    <h3>Observed impact</h3><p>${safe(finding.description)}</p>
    <h3>Suggested fix</h3><p>${safe(finding.fix)}</p>
    <h3>Assertion history</h3><ul class="evidence">${finding.evidence.map(item => `<li>
      <span>${pill(item.outcome)} <span class="mono">${safe(item.reference)}</span></span>
      <span class="table-sub">${safe(item.release)} · ${date(item.observedAt)}</span></li>`).join('')}</ul>
    ${finding.verifiedBy ? `<p class="summary-line">Verified on ${safe(finding.verifiedBy.release)}.</p>` : ''}
    <p id="form-message" class="form-message" role="alert"></p>
    <div class="dialog-actions">${action ? `<button type="button" class="button primary" data-action="${action[0]}" data-id="${id}">${action[1]}</button>` : ''}
      ${demoApi ? `<button type="button" class="button" data-action="download-demo-ticket" data-id="${id}">Download ticket</button>`
        : `<a class="button" download href="/api/findings/${id}/ticket">Download ticket</a>`}</div>`);
}

const recommendations = {
  active: 'Keep the manifest and ownership information current.',
  shadow: 'Confirm ownership and add this route to the service manifest.',
  zombie: 'Have the owner confirm dependencies and plan restriction or decommissioning.',
  unobserved: 'Collect more gateway coverage or reachability evidence.',
  retired: 'Verify dependent consumers have migrated before removing the route record.',
};

function displayEndpoint(id) {
  const endpoint = data.endpoints.find(item => item.id === id);
  const related = data.findings.filter(item => item.routeId === id && item.status !== 'resolved');
  showDialog(endpoint.route, `${endpoint.method} · Travel staging`, `
    ${facts([['Classification', labels[endpoint.classification]], ['Owner', endpoint.owner],
      ['Last traffic', date(endpoint.lastSeen)], ['Authentication', endpoint.auth], ['Data class', endpoint.data],
      ['Manifest reachability', endpoint.reachable === null ? 'Unknown' : endpoint.reachable ? 'Reachable' : 'Unreachable']])}
    <h3>Recommended action</h3><p>${recommendations[endpoint.classification]}</p>
    <h3>Related unresolved findings</h3>${related.length ? findingTable(related) : '<p>No unresolved assertions for this route.</p>'}`);
}

function displayRun(id) {
  const run = data.runs.find(item => item.id === id);
  const fields = { documented: 'Documented', reachable: 'Reachable', auth: 'Authentication', data: 'Data class', owner: 'Owner' };
  const value = item => item === null ? 'Unknown' : item === true ? 'Yes' : item === false ? 'No' : item;
  showDialog(run.release, `${run.id} · Travel staging`, `
    ${facts([['Deployed', date(run.deployedAt)], ['Imported', date(run.at)], ['Routes processed', run.touched],
      ['Gateway request count', (run.trafficObservations ?? 0).toLocaleString()], ['Assertions received', run.assertions],
      ['Distinct failure observations', run.failures], ['New or reopened findings', run.findings]])}
    ${run.coverageStart ? `<h3>Gateway coverage</h3><p>${date(run.coverageStart)} to ${date(run.coverageEnd)}</p>` : ''}
    <h3>Manifest changes</h3>
    ${run.changes?.length ? `<ul class="evidence change-list">${run.changes.map(item => `<li>
      <div><span class="method">${item.method}</span><span class="mono">${safe(item.route)}</span>
      <span class="table-sub">${safe(item.fields.map(field => `${fields[field.name]} · ${value(field.before)} → ${value(field.after)}`).join('  |  '))}</span></div>
      ${pill(item.kind)}</li>`).join('')}</ul>` : '<p>No manifest changes recorded for this import.</p>'}`);
}

function formError(error) {
  const target = dialog.open && dialogContent.querySelector('#form-message');
  if (target) target.textContent = error.message;
  else say(error.message);
}

async function action(button) {
  const { action: key, id } = button.dataset;
  if (key === 'import') showImport();
  if (key === 'close') dialog.close();
  if (key === 'finding') displayFinding(id);
  if (key === 'endpoint') displayEndpoint(id);
  if (key === 'run') displayRun(id);
  if (key === 'download-demo-ticket') {
    const { body, type } = await demoApi(`/api/findings/${id}/ticket`);
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (key === 'sample') {
    const payload = await api(`/api/sample?kind=${id}`);
    const editor = document.querySelector('#import-json');
    if (dialog.open && editor) {
      editor.value = JSON.stringify(payload, null, 2);
      document.querySelector('#form-message').textContent = '';
      editor.focus();
    }
  }
  if (key === 'toggle') {
    const result = await api('/api/intake', 'PATCH', { paused: !data.paused });
    await refresh();
    main.querySelector('[data-action="toggle"]')?.focus();
    say(result.paused ? 'Evidence intake paused.' : 'Evidence intake resumed.');
  }
  if (key === 'review' || key === 'retest') {
    await api(`/api/findings/${id}`, 'PATCH', { action: key });
    await refresh();
    if (dialog.open) {
      displayFinding(id);
      dialogContent.querySelector('button').focus();
    }
    say(key === 'review' ? `${id} moved to review.` : `${id} resolved with passing evidence.`);
  }
}

document.addEventListener('click', async event => {
  if (event.target.closest('.skip')) {
    event.preventDefault();
    main.focus();
  }
  const link = event.target.closest('[data-filter]');
  if (link) {
    selected.status = link.dataset.filter;
    selected.query = '';
    selected.severity = '';
  } else if (event.target.closest('a[href^="#"]') && !event.target.closest('.skip')) {
    selected.status = '';
    selected.query = '';
    selected.severity = '';
  }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const busy = ['sample', 'toggle', 'review', 'retest'].includes(button.dataset.action);
  if (busy) button.disabled = true;
  try {
    await action(button);
  } catch (error) {
    formError(error);
  } finally {
    if (busy) button.disabled = false;
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'query') {
    selected.query = event.target.value;
    updateFiltered();
  }
});

document.addEventListener('change', async event => {
  const { id, value } = event.target;
  try {
    if (id === 'days') {
      selected.days = Number(value);
      await refresh();
      document.querySelector('#days')?.focus();
    }
    if (id === 'status' || id === 'severity') {
      selected[id] = value;
      updateFiltered();
    }
    if (id === 'file' && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.size > 256 * 1024) throw new Error('Choose a file smaller than 256 KB.');
      const contents = await file.text();
      const editor = document.querySelector('#import-json');
      if (editor) {
        editor.value = contents;
        document.querySelector('#form-message').textContent = '';
      }
    }
  } catch (error) {
    formError(error);
  }
});

dialog.addEventListener('submit', async event => {
  if (event.target.id !== 'import-form') return;
  event.preventDefault();
  const submit = event.submitter ?? event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const text = event.target.querySelector('textarea').value;
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('Enter valid JSON before processing.'); }
    const run = await api('/api/imports', 'POST', payload);
    dialog.close();
    await refresh();
    say(`Imported ${run.release}. ${run.touched} routes processed.`);
  } catch (error) {
    formError(error);
  } finally {
    submit.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
refresh().catch(error => {
  main.innerHTML = '<p class="empty" role="alert">Unable to load THE WATCHER. Refresh the page to retry.</p>';
  console.error(error);
});
