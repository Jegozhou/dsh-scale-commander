# Scale Commander

Amazon PPC autopilot for DeepSeek Harness — a native dual-half plugin that
turns your advertising strategy into audited automation.

It implements the full operational surface a seller expects from a dedicated
PPC tool: eleven stackable algorithms, criteria profiles, dayparting with hourly
bid modifiers, negative and whitelist management, keyword harvesting, a mass
campaign builder, budget and placement rules, sales attribution, and a preview
→ apply → rollback pipeline that records every change.

## What it does

| Capability | Where |
|---|---|
| Amazon Ads API client (SP / SB / SD, LWA, reporting) | `package/src/host/amazon.js` |
| Sandbox provider with a realistic generated account | `package/src/host/sandbox.js` |
| Durable store: campaigns, metrics, rules, runs, audit | `package/src/host/store.js`, `repository.js`, `schema.sql` |
| Eleven algorithms with step-by-step calculations | `package/src/shared/algorithms.js` |
| Criteria profiles (reusable AND conditions) | `package/src/shared/criteria.js` |
| Rule engine, preview, apply, rollback | `package/src/host/engine.js` |
| Scheduler (automation window + hourly dayparting) | `package/src/host/scheduler.js` |
| Analytics: overview, breakdowns, words, dead keywords, placements, attribution, restock | `package/src/host/analytics.js` |
| Mass campaign builder with undo | `package/src/host/mass.js` |
| Encrypted credential vault | `package/src/host/vault.js` |
| HTTP API for the browser half | `package/src/host/api.js` |
| Twelve agent tools | `package/src/host/tools.js` |
| Web page (dashboard → campaigns → rules → objectives → preview → change log → insights → dayparting → attribution → placements → mass → audit → accounts) | `package/src/client/` |

## The eleven algorithms

Every algorithm is a pure function over already-aggregated metrics, so the
preview a person reviews and the plan the Host executes are produced by the same
code — a preview cannot drift from execution.

| Algorithm | What it does |
|---|---|
| **Bidding** | Moves keyword and product-target bids toward a target ACOS, one capped step at a time, using the documented optimum-bid formulas (RPC × ACOS, or price × ACOS ÷ clicks). |
| **Dayparting** | Turns ad groups on or off by hour and applies hourly percentage bid modifiers; an optimum-hours mode derives the plan from observed hourly performance. |
| **Import** | Harvests converting search terms into new keywords or product targets, priced as a percentage of their average CPC. |
| **Negative** | Negates search terms that meet the criteria, as negative exact or phrase. |
| **Negative word** | Splits search terms into single words, aggregates them, and negates non-performing words as phrase. |
| **Blacklist / whitelist** | Forces a maintained list to negatives, and protects whitelisted terms from the negative and negative-word algorithms. |
| **Revive** | Raises bids on dead keywords that used to perform, until traffic returns. |
| **Default bid** | Optimises an ad group default bid for legacy auto campaigns. |
| **Status** | Pauses or enables campaigns and ad groups on criteria. |
| **Daily budget** | Applies a baseline, a day-of-week multiplier, and then each matching criterion in sequence. |
| **Placement** | Adjusts top-of-search, product-page, and rest-of-search modifiers toward a target, one increment per run. |

Stackable rules run in priority order; mutually exclusive kinds (dayparting,
blacklist, default bid, daily budget) keep one rule per ad. A directly assigned
rule overrides an inherited one of the same kind.

## Safety model

1. **Preview writes nothing.** Every action carries its before/after values and
   the step-by-step arithmetic behind it.
2. **Applying requires `confirm: true`**, and the agent tool refuses to apply a
   plan the person has not approved.
3. **Every applied action is recorded** with the exact Amazon request, so a run
   can be rolled back from the change log.
4. **Rollback restores before values, newest first**, and is itself audited.
5. **Sandbox accounts are safe by default**: they never touch Amazon.

## Architecture

```
src/shared/      domain vocabulary, metrics, criteria, algorithms — pure, used by both halves
src/host/        store, repository, Amazon client, sandbox, sync, engine,
                 scheduler, analytics, mass builder, vault, HTTP API, tools
src/client/      page shell, views, primitives, API client, state
lib/             build output (esbuild bundle for the browser, copied ESM for the host)
```

The Host half is one Cordis plugin row. Everything it creates is registered
through `ctx.effect`, so disabling the bundle stops the scheduler, closes the
database, unregisters the tools and removes the HTTP routes with no leftovers.

The browser half registers one page into the `main` panel and one icon into
`sidebar.panellist`, so the product is a first-class destination rather than an
overlay. Every colour is a Harness theme token (`--dsw-alias-*`), so light/dark
switching works without the plugin doing anything.

## Data

SQLite through Node's built-in `node:sqlite`, so the bundle has no native
dependency. The database lives in `<DSH_HOME>/scale-commander/` by default;
override it with the `dataDir` config field. Schema changes are additive
migrations, and a stored schema newer than the plugin refuses to open rather
than losing data.

Credentials never touch SQLite: they are AES-256-GCM encrypted in a `0600`
sidecar file, and mirrored into the Harness credential service when available.

## Building and testing

```sh
node scripts/build.mjs   # bundle both halves
node scripts/test.mjs    # 62 assertions across 3 suites
```

- `tests/algorithms.test.mjs` — bid maths, every algorithm, criteria semantics.
- `tests/host.test.mjs` — store, vault, sync, engine, apply, rollback, analytics, API.
- `tests/client.test.mjs` — the built bundle's registration and disposal contract.

## Installing

```sh
# from the DeepSeek Harness profile directory
plugin_manager action=install_bundle target=<absolute path to package/>
```

Or through the Plugin Manager UI. Configuration lives in the bundle row:

```yaml
- insert:
    - id: scale-commander
      name: '@local/dsh-scale-commander'
      config:
        dataDir: ''                # defaults to <DSH_HOME>/scale-commander
        schedulerEnabled: true
        schedulerTickSeconds: 60
        requestTimeoutMs: 45000
```

## Getting started

1. Add a **sandbox** account from the Accounts tab — no credentials needed, and
   it generates ~120 days of realistic campaigns, keywords, targets, search
   terms and hourly performance.
2. Sync it, then create a **strategic objective** from a preset (Bulk Auto,
   Sales Exact, Ranking Exact…) and assign it to a few campaigns.
3. Open **Preview** to see every action the algorithms would take, with the
   maths behind each one, then apply it.
4. Watch the **Change log** and roll a run back to see the before values return.

To connect a real Amazon Ads account, create a Login with Amazon application,
authorize it for your advertising profile, and paste the client id, client
secret and refresh token into the Credentials dialog.

See [docs/USER-GUIDE.md](docs/USER-GUIDE.md) for a walkthrough of every screen,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design decisions.
