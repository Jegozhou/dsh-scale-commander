# Architecture

## The problem

A PPC automation tool has one hard requirement that ordinary CRUD software does
not: **the plan a person reviews must be exactly the plan that executes**. A
preview computed from one code path and an apply computed from another drifts,
and drift in advertising means money spent on wrong bids.

Scale Insights' architecture encodes this: one engine, one evaluation pass,
preview and apply distinguished only by whether the executor runs.

## Decisions

### 1. Two halves, one domain

The domain layer (`src/shared/`) is pure JavaScript with no imports outside
itself. Both halves import it:

- the Host evaluates rules against stored metrics;
- the browser renders the same criteria, the same metric catalogue, and the same
  calculation steps.

Because there is one implementation of "what a bidding rule means", a preview
cannot disagree with execution, and the audit trail never shows an action the
reviewer did not see.

**Alternative rejected:** duplicating the rule maths in the client for a live
preview without a round trip. Two implementations of optimum-bid formulas is
two chances to be wrong, and the wrong one would be the one nobody tests.

### 2. SQLite through `node:sqlite`

The plugin owns its data: campaigns, ad groups, keywords, targets, negatives,
daily and hourly metrics, search terms, products, criteria profiles, rules,
assignments, objectives, runs, run actions, schedules, the audit log, and sync
state. Reporting-heavy reads want indexes and window functions; the audit log
wants append-only durability; the change log wants a query.

`node:sqlite` is built into Node 22.5+, so the bundle has no native module to
compile and no install script — which also means `install_bundle` never has to
ask permission to run a build.

**Alternative rejected:** routing through `ctx.storageDomain`. That service is
for small, schema-validated KV sets. Aggregating 30-day keyword performance with
`GROUP BY` over a JSON backend would either be unusable or would re-implement
SQL in JavaScript.

**Consequence:** the plugin manages its own migrations. They are additive
steps guarded by `PRAGMA table_info`, safe to replay, and a stored schema newer
than the plugin refuses to open instead of guessing.

### 3. Metrics are stored raw and derived on demand

Raw columns only: impressions, clicks, spend, sales, orders, units, and the
placement and organic splits. Derived metrics (CTR, CVR, ACOS, ROAS, CPC, TACOS,
profit…) are computed by the shared registry at read time.

Aggregates therefore always agree: `ACOS` over a week is `SUM(spend)/SUM(sales)`,
never an average of daily ACOS. This is the classic analytics bug, and the
ratio/percent split in `metrics.js` exists specifically to keep `ROAS` from
being reported 100× too large.

### 4. Provider behind one interface

`providerFor(accountId)` returns either the real `AmazonAdsClient` or a
`SandboxProvider`, and both implement the same method set. The sync service,
the engine executor, and the mass builder never branch on the provider.

The sandbox generates a full account — 5 products, 20 campaigns, 40 keywords,
auto targeting groups, ASIN targets, 120 days of daily metrics with placement
splits and attribution lag, 30 days of hourly metrics with real time-of-day
shape, and aggregated search terms — from a deterministic seed. It is the reason
every workflow in this repo has an end-to-end test with no credentials.

### 5. Credential handling

Secrets are encrypted at rest with AES-256-GCM under a key derived from the
data directory (or an explicit config value), stored `0600`, and mirrored into
the Harness credential service when it is mounted. `status()` returns a masked
hint and never the secret. The test suite asserts the sidecar file does not
contain the plaintext token.

### 6. One HTTP route, guarded by the Host

The browser half talks to `/scale-commander/api/...`. Every request first passes
through `ctx.connection.requestRejection(req)`, so the plugin adds no second
authentication scheme: a page that is not authenticated for the Harness API gets
`401` from the same fence the rest of the product uses.

Failures use a stable envelope — `{error: {code, message, details}}` — so the UI
can show exactly why a write was refused (`confirmation-required`,
`unknown-rule`, `profile-in-use`, …) rather than a generic failure.

### 7. Preview is a read

`EngineService.plan()` only reads: no run row, no writes, no Amazon calls. The
UI can therefore re-evaluate freely, and the apply path takes either a caller's
plan or computes its own — with the same code.

### 8. Batch execution with per-action audit

Actions are grouped by kind and ad type so one Amazon call covers every action
of the same family. Outcomes are recorded per action: `applied`, `failed`,
`previewed`, or `skipped`, each with the exact request body that was sent.

The local read model is updated on success so the next preview sees the new
state without waiting for a sync — which is what makes a second preview
immediately show "already at the computed bid" rather than repeating the change.

### 9. Rollback is a first-class operation

Every applied row keeps its `before` value. Rollback replays them newest first,
through the same provider, and marks each restored row. Creation actions
(negatives, imported keywords) invert by deletion; dayparting inverts by
removing the stored schedule. Value changes invert by writing the before value.

A row that failed to restore stays `rollback-failed` with its error, so a
partial rollback is visible rather than silent.

### 10. Scheduler: two duties, one tick

The scheduler wakes on a bounded interval and does the cheap, local work first
(dayparting enforcement), then automation. Both are serialised, so a slow
Amazon call cannot stack ticks. Dayparting records only once per account per
hour, and each tick's writes are audited.

Automatic apply is off by default: with it off, automation runs only when a
person presses Apply, which keeps the audit trail under operator control.

## Failure modes and how they are handled

| Failure | Handling |
|---|---|
| Amazon rate-limits or 5xx | Retry with backoff honouring `Retry-After`; `429/5xx` are retryable, `4xx` are not. |
| LWA token expires mid-job | Token refreshed on `401` and once per retry. |
| Report never completes | Bounded polling (default 30 min) with a typed timeout error. |
| A batch action is rejected by Amazon | That action is `failed` with Amazon's message; the rest of the batch still applies. |
| Synced data is incomplete | Attribution lag is modelled: `daysToIgnore` drops recent days from the analysis window. |
| A corrupt credential file | Skipped with a warning; the account reports `disconnected` rather than crashing. |
| A stored schema is newer | Open refuses, naming both versions. |
| The plugin is disabled mid-job | Effects fire in reverse: routes removed, timer stopped, database closed, tools unregistered. |
| A sandbox account is asked for real credentials | Refused with `sandbox-account` before any network call. |

## Testing

62 assertions, no framework, no install:

- **algorithms** — optimum-bid formulas, step limits, bounds, every algorithm
  including edge cases (no clicks, negligible raise, whitelist protection,
  duplicate negation, day-of-week budget compounding, placement increments).
- **host** — schema, vault round-trip with a plaintext-leak assertion, sandbox
  seeding, incremental sync, preview purity (asserting nothing was written),
  apply, rollback restoring the before value, negative create + rollback, mass
  preview/create/undo, preset objective expansion, dayparting, audit pagination,
  settings round-trip, and the API's error envelope.
- **client** — the built bundle registers exactly one factory, exposes `apply`,
  registers the page, the icon, the locale and the stylesheet as effects, and
  every effect returns a disposer that removes its resources.
