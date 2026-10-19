-- Scale Commander durable schema. All timestamps are ISO-8601 UTC strings.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  provider       TEXT NOT NULL DEFAULT 'amazon',
  region         TEXT NOT NULL DEFAULT 'na',
  marketplace    TEXT NOT NULL DEFAULT 'ATVPDKIKX0DER',
  currency       TEXT NOT NULL DEFAULT 'USD',
  timezone       TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  client_id      TEXT NOT NULL DEFAULT '',
  profile_id     TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at   TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  ad_type        TEXT NOT NULL DEFAULT 'SP',
  targeting_type TEXT NOT NULL DEFAULT 'MANUAL',
  state          TEXT NOT NULL DEFAULT 'ENABLED',
  budget         REAL,
  budget_type    TEXT NOT NULL DEFAULT 'DAILY',
  bidding        TEXT NOT NULL DEFAULT '',
  portfolio_id   TEXT NOT NULL DEFAULT '',
  placement_top  INTEGER NOT NULL DEFAULT 0,
  placement_pp   INTEGER NOT NULL DEFAULT 0,
  placement_ros  INTEGER NOT NULL DEFAULT 0,
  start_date     TEXT NOT NULL DEFAULT '',
  asin           TEXT NOT NULL DEFAULT '',
  synced_at      TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS campaigns_account ON campaigns(account_id);

CREATE TABLE IF NOT EXISTS ad_groups (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT 'ENABLED',
  default_bid    REAL,
  targeting_type TEXT NOT NULL DEFAULT 'MANUAL',
  custom_group   TEXT NOT NULL DEFAULT '',
  asin           TEXT NOT NULL DEFAULT '',
  synced_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_groups_campaign ON ad_groups(campaign_id);

CREATE TABLE IF NOT EXISTS keywords (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  text           TEXT NOT NULL DEFAULT '',
  match_type     TEXT NOT NULL DEFAULT 'exact',
  state          TEXT NOT NULL DEFAULT 'ENABLED',
  bid            REAL,
  suggested_bid  REAL,
  serving_status TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT '',
  synced_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS keywords_ad_group ON keywords(ad_group_id);
CREATE INDEX IF NOT EXISTS keywords_text ON keywords(text);

CREATE TABLE IF NOT EXISTS targets (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  expression     TEXT NOT NULL DEFAULT '[]',
  target_type    TEXT NOT NULL DEFAULT 'KEYWORD',
  state          TEXT NOT NULL DEFAULT 'ENABLED',
  bid            REAL,
  synced_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS targets_ad_group ON targets(ad_group_id);

CREATE TABLE IF NOT EXISTS negatives (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  campaign_id    TEXT NOT NULL DEFAULT '',
  ad_group_id    TEXT NOT NULL DEFAULT '',
  level          TEXT NOT NULL DEFAULT 'adGroup',
  text           TEXT NOT NULL,
  match_type     TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'ENABLED',
  source         TEXT NOT NULL DEFAULT '',
  rule_id        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  UNIQUE(ad_group_id, campaign_id, text, match_type)
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  date           TEXT NOT NULL,
  ad_type        TEXT NOT NULL DEFAULT 'SP',
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  spend          REAL NOT NULL DEFAULT 0,
  sales          REAL NOT NULL DEFAULT 0,
  orders         INTEGER NOT NULL DEFAULT 0,
  units          INTEGER NOT NULL DEFAULT 0,
  organic_sales  REAL NOT NULL DEFAULT 0,
  organic_orders INTEGER NOT NULL DEFAULT 0,
  ntb_sales      REAL NOT NULL DEFAULT 0,
  ntb_orders     INTEGER NOT NULL DEFAULT 0,
  returns        INTEGER NOT NULL DEFAULT 0,
  refunded_sales REAL NOT NULL DEFAULT 0,
  impressions_tos INTEGER NOT NULL DEFAULT 0,
  impressions_pp  INTEGER NOT NULL DEFAULT 0,
  impressions_ros INTEGER NOT NULL DEFAULT 0,
  clicks_tos     INTEGER NOT NULL DEFAULT 0,
  clicks_pp      INTEGER NOT NULL DEFAULT 0,
  clicks_ros     INTEGER NOT NULL DEFAULT 0,
  sales_tos      REAL NOT NULL DEFAULT 0,
  sales_pp       REAL NOT NULL DEFAULT 0,
  sales_ros      REAL NOT NULL DEFAULT 0,
  orders_tos     INTEGER NOT NULL DEFAULT 0,
  orders_pp      INTEGER NOT NULL DEFAULT 0,
  orders_ros     INTEGER NOT NULL DEFAULT 0,
  sessions       INTEGER NOT NULL DEFAULT 0,
  page_views     INTEGER NOT NULL DEFAULT 0,
  buy_box_wins   INTEGER NOT NULL DEFAULT 0,
  cogs           REAL NOT NULL DEFAULT 0,
  fba_fees       REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, date)
);
CREATE INDEX IF NOT EXISTS metrics_account_date ON metrics_daily(account_id, date);
CREATE INDEX IF NOT EXISTS metrics_date ON metrics_daily(date);

CREATE TABLE IF NOT EXISTS hourly_metrics (
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  date         TEXT NOT NULL,
  hour         INTEGER NOT NULL,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  spend        REAL NOT NULL DEFAULT 0,
  sales        REAL NOT NULL DEFAULT 0,
  orders       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, date, hour)
);
CREATE INDEX IF NOT EXISTS hourly_account ON hourly_metrics(account_id, date);

CREATE TABLE IF NOT EXISTS search_terms (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  campaign_id  TEXT NOT NULL,
  ad_group_id  TEXT NOT NULL,
  text         TEXT NOT NULL,
  match_type   TEXT NOT NULL DEFAULT '',
  date         TEXT NOT NULL,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  spend        REAL NOT NULL DEFAULT 0,
  sales        REAL NOT NULL DEFAULT 0,
  orders       INTEGER NOT NULL DEFAULT 0,
  units        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS search_terms_ad_group ON search_terms(ad_group_id, date);
CREATE INDEX IF NOT EXISTS search_terms_text ON search_terms(text);

CREATE TABLE IF NOT EXISTS products (
  account_id   TEXT NOT NULL,
  asin         TEXT NOT NULL,
  sku          TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  price        REAL,
  cogs         REAL,
  fba_fee      REAL,
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, asin)
);

CREATE TABLE IF NOT EXISTS criteria_profiles (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  conditions   TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  params         TEXT NOT NULL DEFAULT '{}',
  profile_id     TEXT NOT NULL DEFAULT '',
  profiles       TEXT NOT NULL DEFAULT '[]',
  priority       INTEGER NOT NULL DEFAULT 100,
  enabled        INTEGER NOT NULL DEFAULT 1,
  dry_run        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_account ON rules(account_id, kind);

CREATE TABLE IF NOT EXISTS assignments (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  rule_id      TEXT NOT NULL,
  campaign_id  TEXT NOT NULL,
  ad_group_id  TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manual',
  objective_id TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE(rule_id, campaign_id, ad_group_id)
);
CREATE INDEX IF NOT EXISTS assignments_campaign ON assignments(account_id, campaign_id);

CREATE TABLE IF NOT EXISTS objectives (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  ad_type      TEXT NOT NULL DEFAULT 'SP',
  targeting_type TEXT NOT NULL DEFAULT 'MANUAL',
  rule_ids     TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  trigger        TEXT NOT NULL DEFAULT 'manual',
  scope          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'preview',
  dry_run        INTEGER NOT NULL DEFAULT 1,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  planned        INTEGER NOT NULL DEFAULT 0,
  applied        INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  error          TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);

CREATE TABLE IF NOT EXISTS run_actions (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  rule_id        TEXT NOT NULL DEFAULT '',
  rule_name      TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL,
  entity_type    TEXT NOT NULL DEFAULT '',
  entity_id      TEXT NOT NULL DEFAULT '',
  entity_name    TEXT NOT NULL DEFAULT '',
  campaign_id    TEXT NOT NULL DEFAULT '',
  ad_group_id    TEXT NOT NULL DEFAULT '',
  before_value   TEXT,
  after_value    TEXT,
  reason         TEXT NOT NULL DEFAULT '',
  calculation    TEXT NOT NULL DEFAULT '[]',
  metrics        TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'planned',
  error          TEXT NOT NULL DEFAULT '',
  amazon_request TEXT NOT NULL DEFAULT '',
  executed_at    TEXT,
  rolled_back_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS run_actions_run ON run_actions(run_id);
CREATE INDEX IF NOT EXISTS run_actions_entity ON run_actions(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS schedules (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  ad_group_id  TEXT NOT NULL,
  campaign_id  TEXT NOT NULL DEFAULT '',
  timezone     TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  hours        TEXT NOT NULL DEFAULT '[]',
  mode         TEXT NOT NULL DEFAULT 'schedule',
  rule_id      TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL,
  UNIQUE(account_id, ad_group_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id  TEXT NOT NULL,
  resource    TEXT NOT NULL,
  cursor      TEXT NOT NULL DEFAULT '',
  synced_at   TEXT NOT NULL,
  row_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, resource)
);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  payload      TEXT NOT NULL DEFAULT '{}',
  result       TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
