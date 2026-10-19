# User Guide

## Contents

1. [Getting started with a sandbox account](#1-getting-started-with-a-sandbox-account)
2. [The dashboard](#2-the-dashboard)
3. [Campaigns, ad groups and keywords](#3-campaigns-ad-groups-and-keywords)
4. [Strategic objectives](#4-strategic-objectives)
5. [Rules](#5-rules)
6. [Criteria profiles](#6-criteria-profiles)
7. [Preview, apply and the change log](#7-preview-apply-and-the-change-log)
8. [Insights](#8-insights)
9. [Dayparting](#9-dayparting)
10. [Attribution, placements and restock](#10-attribution-placements-and-restock)
11. [Mass campaigns](#11-mass-campaigns)
12. [Audit and settings](#12-audit-and-settings)
13. [Agent tools](#13-agent-tools)
14. [Connecting a real Amazon Ads account](#14-connecting-a-real-amazon-ads-account)

---

## 1. Getting started with a sandbox account

A sandbox account needs no credentials. It generates a realistic Amazon account
locally — five products, twenty campaigns across four structures per product,
forty keywords, auto targeting groups, ASIN targets, 120 days of daily metrics
with placement splits and attribution lag, 30 days of hourly performance, and
aggregated search terms.

**Accounts → Add account → Provider: Sandbox → Create.**

The account is created already connected and seeded, so every other tab works
immediately.

> A sandbox account never contacts Amazon. Every write is recorded against the
> generated account, so preview, apply and rollback behave exactly as they do in
> production.

---

## 2. The dashboard

The default view. Eight KPI cards with period-over-period deltas (spend, ad
sales, ACOS, ROAS, orders, CVR, TACOS, profit), a spend-and-sales trend, account
composition, the biggest spenders, and the search terms spending money without
orders.

Deltas compare the current window against the immediately preceding window of
the same length. Green means better: rising ACOS is red, falling ACOS is green.

**Break-even ACOS** uses COGS and FBA fees from the product catalogue. Add those
under **Accounts → products** to make it meaningful; until then it reads 100%.

---

## 3. Campaigns, ad groups and keywords

A three-pane browser. Click a campaign to load its ad groups; click an ad group
to load its keywords and product targets with their current bids and metrics.

The **Rules** column on a campaign shows every rule assigned to it — directly or
through a strategic objective. **Assign** opens the rule picker.

The header filter searches campaigns and filters by state; the account picker
and the date-range selector in the page header apply to every tab.

---

## 4. Strategic objectives

An objective bundles several algorithms into one strategy, then applies it to
every ad group you choose. Seven presets ship with the plugin:

| Preset | Shape |
|---|---|
| Bulk Auto | Discovery at scale: aggressive negation, dayparting, status protection |
| Sales Exact | Harvest winners, bid moderately, negate conservatively |
| Ranking Exact | Push top-of-search share while protecting margin |
| Discovery Auto | Cheap discovery with fast negation |
| Product Targeting | ASIN and category targeting with ACOS defence |
| Video Exact | Sponsored Brands video harvesting with tighter caps |
| Single Keyword with TOS | One keyword per ad group, top-of-search focused |

**Creating from a preset** instantiates a real rule (and a criteria profile)
per algorithm, so you can then edit any of them individually. **Assign** applies
the whole objective to the selected ad groups in one step.

---

## 5. Rules

A rule is an algorithm plus parameters plus an optional criteria profile.

**New rule** opens the editor. Pick the algorithm; the parameter form adapts to
it. Every field has a default, so you can create a working rule by naming it and
saving.

Each algorithm's parameters:

| Algorithm | Parameters |
|---|---|
| Bidding | Target ACOS, max change per run, bid cap, bid floor, days to observe a change, cap at Amazon suggested bid |
| Dayparting | Fixed schedule (start/end hour) or optimum hours from data, minimum orders per hour, hourly bid modifiers |
| Import | Search-term source, new keyword match type, initial bid as % of CPC, max new keywords per run |
| Negative | Search-term source, negative match type, whitelist protection |
| Negative word | Search-term source, negative match type, minimum word length |
| Blacklist | Negative-exact and negative-phrase lists, exact and phrase whitelists |
| Revive | Target ACOS, bid increase per run, active impressions threshold |
| Default bid | Target ACOS, max change, bid cap |
| Status | Applies to (campaign or ad group), action (pause or enable) |
| Daily budget | Baseline, min/max, day-of-week multipliers |
| Placement | Placement, target modifier, increment, decrement |

**Search-term source** decides where the aggregated search terms come from:
*Same ASIN across the account* (default), *This campaign*, *This ad group*, or
*Custom group* (tag both source and destination ad groups with the same custom
group name).

**Dry run** records the rule but never applies it — useful for staging a
strategy and watching the preview before you trust it.

---

## 6. Criteria profiles

A criteria profile is a reusable filter: a list of conditions on metrics, with
AND semantics — each added condition narrows the set.

**Rules → New rule → Criteria Profile** attaches one. A profile can be reused
across any number of rules; changing it changes every rule that uses it, which
is why the profile list shows what is using each profile.

Six starter profiles are seeded with a new account: *No orders | Spend ≥ $10*,
*Wasted clicks | 20 clicks, 0 orders*, *High ACOS | ≥ 80% with sales*,
*Winner | 5 orders, ≥ 15% CVR, ACOS ≤ 35%*, *Low CTR | ≥ 1000 impressions*,
and *Budget risk | Spend ≥ $50, ACOS ≥ 60%*.

A profile does nothing on its own. It defines *what qualifies*; the rule defines
*what happens*.

---

## 7. Preview, apply and the change log

**Preview** is the safety contract. It evaluates every enabled rule with an
assignment against the stored metrics and returns:

- the action count, grouped by rule;
- every action with its entity, its change, its before → after values, and its
  reason;
- **Show maths** — the step-by-step arithmetic behind that action, plus the
  metrics it was computed from.

A preview writes nothing. Re-evaluate as often as you like.

**Apply changes…** asks for confirmation and then sends the plan to Amazon. Each
action is recorded with the exact request body. The resulting run shows planned,
applied, failed and skipped counts.

> Apply requires `confirm: true`. The agent tool enforces the same rule, so an
> assistant cannot apply a plan you have not approved.

**Change log** lists runs newest first with their counts. **Details** shows every
action in the run; **Roll back** restores the recorded before value of every
applied action, newest first. A rollback is itself audited, and a partially
failed rollback keeps its failures visible.

---

## 8. Insights

Six analysis levels, switchable from the picker: **campaigns, ad groups,
keywords, product targets, search terms, unique words**.

Each row carries impressions, clicks, CTR, spend, sales, orders, ACOS and CVR.
Sort by any of them; filter by name. On the search-term level, **Negate** opens
the negative dialog pre-filled with that term.

**Unique words** is the view behind the negative-word algorithm: it splits every
search term into words, aggregates each word's performance across all the terms
that contain it, and shows how many terms contribute. A word with hundreds of
clicks, no orders, and dozens of contributing terms is the classic case for a
negative phrase.

**Dead keywords** (available through the same view when you switch the level)
lists keywords with historical sales and no recent impressions — the revive
rule's candidate list.

---

## 9. Dayparting

Two capabilities in one screen.

**The heatmap** shows your chosen metric by day of week and hour, from the
Amazon hourly report. Darker cells are stronger hours. Hover any cell for its
exact value. If the heatmap is empty, run a sync with hourly data enabled.

**The schedule editor** builds a 24-hour plan for one ad group:

- click an hour chip to toggle it on or off;
- **All on / All off** set every hour;
- **Smart select** enables the hours whose metric is at or above the median;
- the hourly bid modifier row applies a percentage to the keyword base bid for
  that hour — `+10%` on a $1.00 bid makes it $1.10, `-20%` makes it $0.80.

Save the schedule and the scheduler enforces it at the top of every hour:
it sets the ad group state for the current hour and, for hours with a modifier,
moves each keyword bid by that percentage relative to its stored base bid.

Adjustments are never cumulative: each hour is computed from the base bid, not
from the previous hour's bid.

> A 0% modifier means no bid change. If the hour is enabled, the ad group state
> change still takes effect.

---

## 10. Attribution, placements and restock

**Attribution** splits sales into ad-attributed and organic, per ASIN, with
ad share, organic share, TACOS, profit and margin. The restock forecast
projects 30-day units, revenue and profit from the observed velocity.

Add COGS and FBA fees per product to make profit, margin and break-even ACOS
real: **Attribution → By ASIN** reads them from the product catalogue, which you
edit through the API (`POST /accounts/:id/products`) or the Accounts tab.

**Placements** shows top-of-search, product-page and rest-of-search ACOS beside
each campaign's current modifiers — the numbers behind a placement rule.

---

## 11. Mass campaigns

The batch builder creates many campaigns in one audited operation.

- **ASINs** — one per line or comma-separated.
- **Campaign types** — auto, manual, ASIN targeting, in any combination.
- **Bid ladder** (auto) — one auto campaign per bid, so traffic tiers can be
  compared against each other.
- **Keyword seeds and match types** (manual) — each seed becomes one keyword per
  selected match type.
- **Daily budget, default bid, initial state, naming template.**

Naming templates accept `{asin} {index} {bid} {theme} {date} {matchType}
{campaignType}`.

**Preview batch** renders every planned campaign with its budget, bid and
keyword count. **Create** executes it. **Undo this batch** deletes exactly the
campaigns that batch created.

> Campaigns are created **paused** by default, so a mistake costs nothing until
> you enable it.

---

## 12. Audit and settings

**Audit** is an append-only log of every configuration change, sync, preview,
apply, rollback and scheduler tick, with the actor and a JSON detail. Paginate
through it and filter by action.

**Accounts** holds the automation settings:

- **Apply automation automatically** — off by default. With it on, the scheduler
  runs the plan on the configured frequency. Off means automation runs only when
  you press Apply.
- **Frequency** — daily at a local hour, or every N hours.
- **Analysis window** — how many days of history the algorithms read.
- **Recent days to ignore** — attribution lag. Recent days are incomplete, so
  the algorithms skip them. The defaults (30 days analysed, 2 ignored) match the
  documented behaviour.
- **Max actions per run** — a safety cap.

---

## 13. Agent tools

The plugin registers twelve tools, so an assistant in the same profile can work
the account conversationally:

| Tool | Purpose |
|---|---|
| `scale_commander_accounts` | List accounts with status and counts |
| `scale_commander_overview` | Performance overview with the previous window |
| `scale_commander_preview` | Evaluate rules and return the exact actions with their calculations |
| `scale_commander_apply` | Apply a previewed plan (**requires `confirm: true`**) |
| `scale_commander_rollback` | Undo an applied run |
| `scale_commander_runs` | List runs with planned/applied/failed counts |
| `scale_commander_rules` | List rules with parameters and assignment counts |
| `scale_commander_create_rule` | Create a rule (returns the id for assigning) |
| `scale_commander_assign` | Assign a rule to campaigns or ad groups |
| `scale_commander_insights` | Read a breakdown at any level, including unique words |
| `scale_commander_audit` | Read the audit log |
| `scale_commander_sync` | Pull the latest data from Amazon |

Every tool calls the same service method the browser calls, so validation,
auditing and the confirmation rule are identical on both paths.

---

## 14. Connecting a real Amazon Ads account

1. In Amazon Ads, create a **Login with Amazon** application and authorize it for
   your advertising profile.
2. **Accounts → Add account → Provider: Amazon Ads**, pick the marketplace.
3. Open **Credentials** on the new account and paste the client id, client
   secret and refresh token.
4. **Test connection** resolves the profiles the token grants and stores the
   selected profile id.
5. **Sync** pulls campaigns, ad groups, keywords, targets, negatives, 90 days of
   daily metrics, search terms, and 30 days of hourly performance.

Credentials are encrypted at rest, never returned to the browser, and the status
dialog shows only a masked hint.
