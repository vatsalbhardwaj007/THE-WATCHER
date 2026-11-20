# THE WATCHER

THE WATCHER is a local security operations workspace for a B2B travel platform. It maps release changes and aggregate gateway observations, turns trusted application assertions into owner-ready findings, and records how a reviewer verified each fix.

## Run locally

Use Node.js **24.13 or later**. The frontend and server have zero third-party dependencies.

```powershell
cd .\the-watcher
npm.cmd start
```

Open [THE WATCHER](http://127.0.0.1:4173). The first run creates `data/the-watcher.sqlite` with synthetic travel records. Subsequent runs open the same workspace. The process listens on loopback only and assumes a single local operator. Keep the SQLite file and its directory local. Set `PORT` for a different port or `THE_WATCHER_DB` for a different database. Start with `npm.cmd start -- --empty` to skip demo data when creating a new database.

## Walk through the demo

1. Open **API inventory**. Compare the **Last 30 days** and **Last 90 days** views. The old bookings API last saw traffic 47 days ago, so its status changes from Zombie to Active. Open the supplier-status route to see its owner, public auth classification, and recommended action.
2. Click **Import evidence**, then **Load sample release** and **Process evidence**. Open **Deployments** to inspect the new release, including its route manifest changes. In **API inventory**, find the new booking-summary route under Shadow.
3. In **Findings**, open **Booking ownership mismatch** and click **Start review**. **Verify retest** requires a newer deployment with a passing assertion.
4. Close the finding, then import **Load sample fix**. Return to the finding and click **Verify retest**. Download its Markdown ticket and check **Audit log** for the decision.
5. Use **Intake settings** to pause and resume new imports.

The fixture dates are relative to when the database is first created. A traffic coverage window expires after 24 hours without fresh evidence. Create a new demo database with a new `THE_WATCHER_DB` value to replay the original snapshot.

## Import contract

CI or gateway systems can assemble an evidence bundle and submit it to the local API. Use authorized, sanitized route metadata, aggregate gateway records, and assertion results from your own application tests or trusted telemetry. Take the assertion reference from the source system so repeated imports can be deduplicated. The browser and HTTP endpoint share the same validation.

| Field | Meaning |
| --- | --- |
| `id`, `release` | Opaque import ID and release ID. The import ID must be unique. |
| `service` | `travel-staging`, the local workspace allowlist. |
| `deployedAt` | ISO 8601 deployment timestamp, at or before the current time. |
| `coverageStart`, `coverageEnd` | Optional paired timestamps for a continuous interval of complete gateway coverage. |
| `manifest[]` | `method`, templated `route`, booleans `documented` and `reachable`, `auth`, `data`, and a team-name `owner`. Use `Required`, `Public`, or `Unknown` for auth. Data classes are `None`, `Booking metadata`, `Payment metadata`, `Contact data`, `Travel data`, and `Unknown`. |
| `traffic[]` | `method`, templated `route`, ISO 8601 `lastSeen`, and positive integer `count`. |
| `assertions[]` | `method`, templated `route`, `rule`, `outcome` as `pass` or `fail`, `observedAt` at or after the release, and opaque `reference`. |

Include at least one row in any section. Each section supports up to 500 rows, and the complete JSON body is limited to 256 KB. Routes use templates such as `/api/v3/bookings/{id}`. Manifest updates are incremental. Set `reachable: false` on a manifest entry to record known retirement. Omit coverage dates unless the source can attest to complete coverage during that interval.

The four assertion rules are `tenantBoundary`, `refundLedger`, `fareIntegrity`, and `responsePrivacy`. Findings group by service, HTTP method, route template, and assertion rule. A distinct failure at or after the evidence that verified a fix can reopen the finding.

### API

| Request | Response |
| --- | --- |
| `GET /api/workspace?days=30` | Endpoints, findings, deployments, trend, and audit history. Use `30` or `90`. |
| `GET /api/sample?kind=release` | Ready-to-import example. Use `kind=fix` for the synthetic passing assertion. |
| `POST /api/imports` | Accepts an evidence bundle and returns its deployment summary. |
| `PATCH /api/findings/RW-104` | Accepts `{"action":"review"}` or `{"action":"retest"}`. |
| `GET /api/findings/RW-104/ticket` | Downloads the finding as Markdown. |
| `PATCH /api/intake` | Accepts `{"paused":true}` or `{"paused":false}`. |

```powershell
$watcherUrl = 'http://127.0.0.1:4173'
$evidence = Invoke-RestMethod "$watcherUrl/api/sample?kind=release"
Invoke-RestMethod "$watcherUrl/api/imports" -Method Post -ContentType 'application/json' -Body ($evidence | ConvertTo-Json -Depth 10)
```

## How this maps to the brief

The brief prioritizes real findings, precision, safety, deployment speed, actionable reporting, and zombie/shadow inventory. THE WATCHER processes incoming deployment records immediately. It compares imported manifests with aggregate traffic, checks whether traffic coverage supports a zombie label, and records severity and remediation according to the business assertion that failed. Unobserved routes stay visible while evidence is incomplete. A human reviewer resolves a finding using a passing assertion from a later deployed release.

This project implements the brief's defensive evidence intake, inventory, human triage, reporting, and retest workflow. It relies on trusted upstream observations for reachability and assertion outcomes. The brief also specifies autonomous attack planning, execution, and exploit reproduction. Those components are outside this implementation.

## Verify

```powershell
npm.cmd test
```

The suite checks coverage and classifications, intake validation, deduplication, review gates, regressions, HTTP behavior, ticket output, and persistence across server restarts. Node 24 may emit an experimental SQLite notice on startup.
