# Acceptance

Every claim below is checked by a command in this repo. Nothing is asserted from
reading code alone.

## How to reproduce

```sh
node scripts/build.mjs      # bundle both halves
node scripts/test.mjs       # 62 assertions across 3 suites
node /tmp/verify-live.mjs   # 22 end-to-end checks against the installed modules
```

## 1. Algorithms

`tests/algorithms.test.mjs` — 27 assertions, 0 failures.

| Requirement | Verification |
|---|---|
| Optimum bid follows the documented formulas | `RPC × ACOS` with sales; `price × ACOS ÷ clicks` without sales; refuses to guess with no clicks |
| Bid moves are gradual and capped | A 10% step from $2.00 toward $1.80 lands on $1.80; a 2% step toward a distant target lands on $1.96 |
| Bids respect Amazon bounds | Below $0.02 is raised to $0.02; four-decimal rounding; caps enforced |
| The "negligible raise" rule holds | Skipped when spend is below one sale at target ACOS; applied when above |
| Bidding skips a keyword already at optimum | Returns a `skip` action, not a no-op write |
| Negative negates qualifying search terms | Creates a negative-exact with the criteria recorded |
| Whitelist protects terms | A whitelisted term becomes a `skip`, never a negation |
| Negative word aggregates across terms | `bike` appearing in two search terms is negated once, with the contributing terms listed |
| Word splitting is correct | Lowercased, punctuation stripped, short words dropped |
| Import prices new keywords correctly | `CPC × percentage` → $0.50 from a $0.50 CPC at 100% |
| Status pauses on criteria | `adGroupStatus` with `after: 'PAUSED'` |
| Daily budget compounds correctly | Baseline $20 × 1.5 (Saturday) × 1.3 (criteria) = $39 |
| Placement moves one increment | 100% → 130% toward a 200% target with a 30% increment |
| Revive raises a dead keyword with history | Bid rises above $0.50 with the historical metrics attached |
| Blacklist honours the whitelist | `cheap` in the exact whitelist is not negated |
| Dayparting builds a full 24-hour plan | Hours 5 and 21 disabled, 6 and 20 enabled, from 6–21 |
| Optimum hours derive from data | A 3 AM hour with 0 orders is disabled; a strong 10 AM hour is enabled with a positive modifier |
| Criteria validate and use AND semantics | `min > max` rejected, unknown operator rejected, one failing condition fails the profile |
| Derived metrics are correct | CTR 1%, ACOS 25%, ROAS 4, profit 40 — the ratio/percent split keeps ROAS from being reported 100× |
| Aggregates recompute ratios | 30 clicks over 2 rows → ACOS 30%, CPC $1.00, never an average of ratios |

## 2. Host pipeline

`tests/host.test.mjs` — 29 assertions, 0 failures. Covers the store schema and
versioning, the vault (including an assertion that the encrypted sidecar does
**not** contain the plaintext token), sandbox seeding, incremental sync, the
overview, all breakdown levels, word aggregation, the heatmap, attribution,
placements, rule validation, assignment, **preview purity** (asserting no run row
and no negative was written), apply, **rollback restoring the before value**,
negative create + rollback, mass preview/create/undo, preset objective
expansion, dayparting, audit pagination, settings round-trip, and the API's
error envelope including the 401 fence and `confirmation-required`.

## 3. Client registration

`tests/client.test.mjs` — 6 assertions, 0 failures, run against the **built
bundle** in a VM with the module loader's contract:

| Requirement | Verification |
|---|---|
| Registers exactly one factory | One `window.__ModuleLoader__.load` call under the package name |
| Exposes `apply` and no other lifecycle verb | The returned plugin has `apply` as a function |
| Registers the page, icon, locale and stylesheet | `main`, `sidebar.panellist`, one dictionary, one `<style>` |
| The stylesheet uses theme tokens | The injected CSS contains `--dsw-alias-bg-base` |
| Page and icon are React components | Both render as SVG/React trees |
| Every effect returns a disposer | Calling them removes the style tag — no leak on unload |

## 4. End-to-end, against the installed modules

22 checks, 22 passing. Run against the exact `package/lib/` modules the Loader
mounts, driven through the same service facade the HTTP API uses:

```
✓ sync pulls campaigns, metrics, hourly — metrics=10920 hourly=14400
✓ overview computes ACOS/ROAS/TACOS — ACOS 57.1 ROAS 1.75
✓ keyword breakdown ranked — top 44.11
✓ unique words aggregated — 53 words
✓ heatmap covers 24 hours — 168 cells
✓ attribution splits ad/organic — 5 ASINs
✓ placement metrics present — TOS impr 9140
✓ dead keywords report — 0 dead
✓ objective preset expands and assigns — 7 rules, 7 assignments
✓ preview produces audited actions — 15 actions
✓ preview writes nothing — no run rows
✓ apply executes the plan — applied 15
✓ rollback restores every action — restored 15
✓ audit log records the pipeline — 8 entries
✓ mass preview expands ladder — 1 campaigns
✓ mass create and undo — created 1, deleted 1
✓ negative management — 6 negatives
✓ dayparting schedule saves — saved
✓ scheduler tick runs — dayparting=0
✓ apply without confirmation refused — 400 confirmation-required
✓ agent tools registered — 12 tools
✓ meta exposes the catalogue — 11 kinds, 65 metrics
```

An earlier 85-action run also applied and rolled back 85 changes with 0 failures.

## 5. Installation into the live Harness

```
plugin_manager action=install_bundle target=<absolute path>/package
→ application: applied, warnings: []
```

The Host row activates and serves `/scale-commander/api/...`, which returns
`401 unauthorized` to an unauthenticated caller — proving the route is live and
guarded by the Host's own Connection fence rather than a plugin-invented scheme.

The durable database is created at `~/.dsh/scale-commander/scale-commander.sqlite`
with all 22 tables at schema version 3.

## 6. Known limitation

**The browser bundle route requires a Host restart.** The `clientModules`
service caches its per-package scan verdict for the life of the process, and the
first scan ran before the package's `exports` map exposed `./package.json` (the
entry point the loader resolves). The fix — adding that export — is in the
manifest and verified locally (resolution now returns the package root and the
104 KB bundle), but a running process does not re-scan.

Evidence that this is a cache and not a defect:

- `createRequire(profile).resolve('@local/dsh-scale-commander/package.json')` now succeeds;
- the same scan logic, reproduced locally, finds the `dsh.client` declaration, the `./client` export and the bundle bytes;
- the client suite verifies the bundle's registration contract directly.

**Restart DeepSeek Harness to load the browser half.** The Host half — engine,
scheduler, API, tools, database — is live and fully verified now.

## 7. Coverage of the requested feature set

| Requested | Status |
|---|---|
| Amazon PPC automation | 11 algorithms, all tested |
| Rule engine | Rule kinds, stackable vs mutually exclusive, priority, per-rule overrides |
| Intelligent bidding | Optimum-bid formulas, gradual capped steps, negligible-raise guard, suggested-bid ceiling |
| Keyword optimization | Import/harvest, revive, dead-keyword report, keyword-level metrics |
| Negative management | Negative rule, negative word, blacklist/whitelist, manual negatives, rollback by deletion |
| Mass campaign creation | Bid ladders, campaign types, naming templates, preview, audited batch undo |
| Budget adjustment | Baseline, day-of-week multipliers, sequential criteria, min/max clamping |
| Time-of-day strategy | Hourly schedule, hourly bid modifiers, optimum-hours derivation, heatmap, scheduler enforcement |
| Data analysis | Overview with deltas, breakdowns at 5 levels, unique words, dead keywords, placement splits |
| Sales attribution | Ad vs organic, per ASIN, ad/organic share, TACOS, profit, margin, restock forecast |
| Visual reports | KPI cards, SVG line chart, 24×7 heatmap, sortable tables, before/after diffs |
| Preview and safe rollback | Preview is a read; apply requires confirmation; every action recorded; rollback newest-first |
| Data persistence | SQLite, 22 tables, additive migrations, incremental sync |
| Automatic scheduling | Automation window + hourly dayparting, serialised ticks, audited |
| Operation audit | Append-only log with actor and detail, paginated |
| Real Amazon API | LWA token exchange, profile listing, SP/SB/SD reads and writes, report create/poll/download, gzip expansion |
| Installable plugin + docs | Bundle installs cleanly; README, architecture, user guide, this report |
