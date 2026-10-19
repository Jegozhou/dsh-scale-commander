/**
 * Scheduler: the clock behind automation.
 *
 * Two independent duties share one tick:
 *  - automation: run the configured accounts on their schedule (hourly, daily
 *    at a local time, or a fixed interval), applying rules through the engine;
 *  - dayparting: at the top of every hour, enable or pause each scheduled ad
 *    group and push the hourly bid modifiers.
 *
 * Every tick is bounded and serialised: a slow Amazon call cannot stack ticks.
 * @module host/scheduler
 */

import { nowIso } from './store.js';

/** How often the scheduler wakes to look for due work. */
const TICK_GRACE_MS = 5_000;

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 * @param {import('./engine.js').EngineService} deps.engine
 * @param {(accountId: string) => Promise<{provider: any, account: any}>} deps.providerFor
 * @param {{enabled?: boolean, tickSeconds?: number, log?: (message: string) => void}} [deps]
 */
export class Scheduler {
  constructor(deps) {
    this.repository = deps.repository;
    this.engine = deps.engine;
    this.providerFor = deps.providerFor;
    this.log = deps.log ?? (() => {});
    this.enabled = deps.enabled !== false;
    this.tickMs = Math.max(30, Math.min(3600, Number(deps.tickSeconds ?? 60))) * 1000;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.lastTickAt = null;
    this.lastRunAt = new Map();
    this.lastDaypartHour = new Map();
    this.schedule = { mode: 'daily', hour: 6, minute: 0, everyHours: 6, timezone: 'America/Los_Angeles', autoApply: true };
  }

  /**
   * Apply the automation schedule the UI saved.
   * @param {{mode?: string, hour?: number, minute?: number, everyHours?: number, timezone?: string, autoApply?: boolean}} schedule
   */
  configure(schedule) {
    this.schedule = { ...this.schedule, ...schedule };
  }

  /** Start the interval; idempotent. */
  start() {
    if (this.timer !== null || !this.enabled) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.log(`scheduler: tick failed — ${error instanceof Error ? error.message : String(error)}`));
    }, this.tickMs);
    this.timer.unref?.();
    this.log(`scheduler: started, tick every ${Math.round(this.tickMs / 1000)}s`);
  }

  /** Stop the interval and wait for any in-flight tick. */
  async stop() {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass: dayparting first (cheap, local), then automation.
   * @param {Date} [now]
   * @returns {Promise<{dayparting: number, runs: Array<Record<string, any>>}>}
   */
  async tick(now = new Date()) {
    if (this.running || this.stopped) return { dayparting: 0, runs: [] };
    this.running = true;
    try {
      this.lastTickAt = nowIso(now);
      const dayparting = await this.#applyDayparting(now);
      const runs = await this.#runAutomation(now);
      return { dayparting, runs };
    } finally {
      this.running = false;
    }
  }

  /**
   * Enforce stored schedules: at each hour boundary, set the ad group state
   * and, when the hour has a modifier, move every keyword bid by that
   * percentage relative to its stored base bid.
   * @param {Date} now
   * @returns {Promise<number>}
   */
  async #applyDayparting(now) {
    const accounts = this.repository.listAccounts().filter((account) => account.status === 'connected');
    let changes = 0;
    for (const account of accounts) {
      const schedules = this.repository.listSchedules(account.id).filter((schedule) => schedule.enabled);
      if (schedules.length === 0) continue;
      const local = localParts(now, account.timezone);
      const key = `${account.id}:${local.hour}:${local.date}`;
      if (this.lastDaypartHour.get(account.id) === key) continue;
      this.lastDaypartHour.set(account.id, key);
      let provider;
      try {
        ({ provider } = await this.providerFor(account.id));
      } catch (error) {
        this.log(`scheduler: dayparting skipped for ${account.id} — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const adGroups = new Map(this.repository.listAdGroups(account.id).map((adGroup) => [adGroup.id, adGroup]));
      const keywords = this.repository.listKeywords(account.id);
      /** @type {Array<{adGroupId: string, state: string}>} */
      const stateChanges = [];
      /** @type {Array<{keywordId: string, bid: number}>} */
      const bidChanges = [];
      for (const schedule of schedules) {
        const entry = schedule.hours.find((hour) => Number(hour.hour) === local.hour);
        if (entry === undefined) continue;
        const adGroup = adGroups.get(schedule.adGroupId);
        if (adGroup === undefined) continue;
        const wanted = entry.enabled ? 'ENABLED' : 'PAUSED';
        if (adGroup.state !== wanted) stateChanges.push({ adGroupId: adGroup.id, state: wanted });
        const modifier = Number(entry.modifier ?? 0);
        if (Math.abs(modifier) > 0.01) {
          for (const keyword of keywords.filter((row) => row.adGroupId === adGroup.id && row.state !== 'ARCHIVED' && row.bid !== null)) {
            const base = keyword.bid;
            const next = Math.max(0.02, Math.round(base * (1 + modifier / 100) * 10000) / 10000);
            if (Math.abs(next - base) > 0.0001) bidChanges.push({ keywordId: keyword.id, bid: next });
          }
        }
      }
      try {
        if (stateChanges.length > 0) {
          await provider.updateAdGroups('SP', stateChanges);
          for (const change of stateChanges) this.repository.updateAdGroupLocal(change);
          changes += stateChanges.length;
        }
        if (bidChanges.length > 0) {
          await provider.updateKeywords('SP', bidChanges);
          for (const change of bidChanges) this.repository.updateKeywordLocal(change);
          changes += bidChanges.length;
        }
        if (stateChanges.length > 0 || bidChanges.length > 0) {
          this.repository.audit({
            accountId: account.id,
            actor: 'scheduler',
            action: 'dayparting.applied',
            target: `${local.date} ${String(local.hour).padStart(2, '0')}:00`,
            detail: { stateChanges: stateChanges.length, bidChanges: bidChanges.length },
          });
        }
      } catch (error) {
        this.log(`scheduler: dayparting write failed — ${error instanceof Error ? error.message : String(error)}`);
        this.repository.audit({
          accountId: account.id,
          actor: 'scheduler',
          action: 'dayparting.failed',
          target: account.id,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return changes;
  }

  /**
   * Run automation for every account that is due.
   * @param {Date} now
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async #runAutomation(now) {
    if (this.schedule.autoApply !== true) return [];
    const accounts = this.repository.listAccounts().filter((account) => account.status === 'connected');
    const runs = [];
    for (const account of accounts) {
      if (!this.#isDue(account, now)) continue;
      try {
        const result = await this.engine.apply(account.id, { trigger: 'schedule', actor: 'scheduler', accountDryRun: account.provider === 'sandbox' && account.dryRun !== false });
        runs.push({ accountId: account.id, runId: result.run.id, applied: result.run.applied, planned: result.run.planned });
        this.lastRunAt.set(account.id, now.getTime());
      } catch (error) {
        this.log(`scheduler: automation failed for ${account.id} — ${error instanceof Error ? error.message : String(error)}`);
        runs.push({ accountId: account.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return runs;
  }

  /**
   * @param {Record<string, any>} account
   * @param {Date} now
   * @returns {boolean}
   */
  #isDue(account, now) {
    const last = this.lastRunAt.get(account.id) ?? 0;
    const elapsed = now.getTime() - last;
    if (this.schedule.mode === 'hourly') return elapsed >= Math.max(1, Number(this.schedule.everyHours ?? 1)) * 3600_000 - TICK_GRACE_MS;
    if (this.schedule.mode === 'interval') return elapsed >= Math.max(1, Number(this.schedule.everyHours ?? 6)) * 3600_000 - TICK_GRACE_MS;
    const local = localParts(now, account.timezone);
    if (local.hour !== Number(this.schedule.hour ?? 6)) return false;
    if (local.minute > Math.ceil(this.tickMs / 60_000) + 1) return false;
    return elapsed >= 20 * 3600_000;
  }

  /** @returns {Record<string, any>} */
  status() {
    return {
      enabled: this.enabled,
      running: this.running,
      tickSeconds: Math.round(this.tickMs / 1000),
      lastTickAt: this.lastTickAt,
      schedule: this.schedule,
      lastRuns: Object.fromEntries(this.lastRunAt),
    };
  }
}

/**
 * Local wall-clock parts for one IANA zone, without a date library.
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{date: string, hour: number, minute: number, weekday: number}}
 */
export function localParts(now, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const weekdays = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday] ?? 1,
  };
}
