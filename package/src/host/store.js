/**
 * Durable store: one SQLite database owned by the plugin, opened with Node's
 * built-in `node:sqlite` so the bundle has no native dependency to compile.
 *
 * The store is deliberately a thin, synchronous data layer: the services above
 * it own validation and transactions. Every write that matters to a person is
 * paired with an audit row by the caller, not here.
 * @module host/store
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_CANDIDATES = [
  join(HERE, 'schema.sql'),
  join(HERE, '..', 'src', 'host', 'schema.sql'),
];

/** Current schema version; bumping it runs the additive migrations below. */
export const SCHEMA_VERSION = 3;

/**
 * @typedef {object} StoreOptions
 * @property {string} file     Database path, or ':memory:'.
 * @property {(message: string, error?: unknown) => void} [log]
 */

/**
 * The durable store. Methods are synchronous because SQLite is; callers that
 * need to keep the event loop responsive batch their work in a job.
 */
export class Store {
  /** @type {DatabaseSync} */
  #db;
  #statements = new Map();
  #closed = false;

  /**
   * @param {StoreOptions} options
   */
  constructor(options) {
    this.file = options.file;
    this.log = options.log ?? (() => {});
    if (this.file !== ':memory:') mkdirSync(dirname(this.file), { recursive: true });
    this.#db = new DatabaseSync(this.file);
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#applySchema();
  }

  #applySchema() {
    const schemaPath = SCHEMA_CANDIDATES.find((candidate) => existsSync(candidate));
    if (schemaPath === undefined) throw new Error('scale-commander: schema.sql is missing from the bundle');
    this.#db.exec(readFileSync(schemaPath, 'utf8'));
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    const current = row === undefined ? 0 : Number(row.value);
    if (current > SCHEMA_VERSION) {
      throw new Error(`scale-commander: database schema ${current} is newer than this plugin (${SCHEMA_VERSION})`);
    }
    this.#migrate(current);
    this.#db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(SCHEMA_VERSION));
  }

  /**
   * Additive migrations. Each step must be safe to re-run, because a crash
   * between the DDL and the version write replays it.
   * @param {number} from
   */
  #migrate(from) {
    const has = (table, column) => {
      const rows = this.#db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some((row) => row.name === column);
    };
    if (from < 2) {
      if (!has('campaigns', 'budget_type')) this.#db.exec("ALTER TABLE campaigns ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'DAILY'");
      if (!has('rules', 'profiles')) this.#db.exec("ALTER TABLE rules ADD COLUMN profiles TEXT NOT NULL DEFAULT '[]'");
    }
    if (from < 3) {
      if (!has('schedules', 'mode')) this.#db.exec("ALTER TABLE schedules ADD COLUMN mode TEXT NOT NULL DEFAULT 'schedule'");
      if (!has('run_actions', 'amazon_request')) this.#db.exec("ALTER TABLE run_actions ADD COLUMN amazon_request TEXT NOT NULL DEFAULT ''");
    }
  }

  /**
   * Prepare once and reuse: the plugin runs the same handful of statements
   * thousands of times during a sync.
   * @param {string} sql
   * @returns {ReturnType<DatabaseSync['prepare']>}
   */
  prepare(sql) {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  /** @param {string} sql */
  exec(sql) {
    this.#db.exec(sql);
  }

  /**
   * @param {string} sql
   * @param {...unknown} params
   * @returns {Record<string, unknown>|undefined}
   */
  get(sql, ...params) {
    return this.prepare(sql).get(...params);
  }

  /**
   * @param {string} sql
   * @param {...unknown} params
   * @returns {Array<Record<string, unknown>>}
   */
  all(sql, ...params) {
    return this.prepare(sql).all(...params);
  }

  /**
   * @param {string} sql
   * @param {...unknown} params
   * @returns {{changes: number, lastInsertRowid: number|bigint}}
   */
  run(sql, ...params) {
    return this.prepare(sql).run(...params);
  }

  /**
   * Run `work` inside one transaction; a throw rolls everything back.
   * @template T
   * @param {() => T} work
   * @returns {T}
   */
  transaction(work) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        /* the transaction was already rolled back by SQLite */
      }
      throw error;
    }
  }

  /** Close the handle; safe to call twice. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#statements.clear();
    try {
      this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* an in-memory database has no WAL to checkpoint */
    }
    this.#db.close();
  }
}

/**
 * Parse a JSON column without letting one corrupt row break a listing.
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @returns {T}
 */
export function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function toJson(value) {
  return JSON.stringify(value ?? null);
}

/**
 * ISO-8601 UTC timestamp used for every stored instant.
 * @param {Date} [date]
 * @returns {string}
 */
export function nowIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/**
 * Add whole days to a `YYYY-MM-DD` date without timezone drift.
 * @param {string} date
 * @param {number} days
 * @returns {string}
 */
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The analysis window a rule evaluates: `daysToIgnore` recent days are dropped
 * from the end, then `daysToAnalyze` days are taken before that point.
 * @param {{daysToAnalyze: number, daysToIgnore: number, today?: string}} input
 * @returns {{start: string, end: string, days: string[]}}
 */
export function windowDates({ daysToAnalyze, daysToIgnore, today = new Date().toISOString().slice(0, 10) }) {
  const end = addDays(today, -Math.max(0, daysToIgnore) - 1);
  const start = addDays(end, -(Math.max(1, daysToAnalyze) - 1));
  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) days.push(date);
  return { start, end, days };
}
