/**
 * Scale Commander — Host half.
 *
 * Owns the durable store, the Amazon client (real or sandbox), the rule engine,
 * the scheduler, the HTTP API the browser half calls, and the agent tools.
 *
 * Everything the plugin creates is registered through `ctx.effect`, so
 * disabling the plugin removes the routes, stops the timer, closes the database
 * and unregisters the tools with no leftovers.
 * @module host/index
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';

import { Store, nowIso } from './store.js';
import { Repository } from './repository.js';
import { CredentialVault } from './vault.js';
import { createAmazonClient } from './amazon.js';
import { createSandboxProvider } from './sandbox.js';
import { SyncService } from './sync.js';
import { EngineService } from './engine.js';
import { AnalyticsService } from './analytics.js';
import { MassService } from './mass.js';
import { Scheduler } from './scheduler.js';
import { ScaleService } from './service.js';
import { ApiServer, API_PREFIX } from './api.js';
import { registerTools } from './tools.js';
import { MARKETPLACES } from '../shared/domain.js';

/** Plugin id used in logs and in the data directory name. */
export const PLUGIN_ID = 'scale-commander';

/**
 * Services the plugin cannot work without. `tools` is required because the
 * agent surface is part of the product; the web carrier and Connection are
 * optional and injected below, so a headless composition still loads.
 */
export const inject = ['tools'];

/**
 * Resolve the data directory: the configured path, else a stable directory
 * under the DSH home so the data survives a plugin reinstall.
 * @param {string} configured
 * @param {string} [dshHome]
 * @returns {string}
 */
export function resolveDataDir(configured, dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return join(dshHome, 'scale-commander');
}

/**
 * Resolve the passphrase used to encrypt the credential sidecar. The configured
 * value wins; otherwise a per-install secret derived from the DSH home path is
 * used so a copied data directory alone cannot decrypt the file.
 * @param {string} configured
 * @param {string} dataDir
 * @returns {string}
 */
export function resolvePassphrase(configured, dataDir) {
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return createHash('sha256').update(`scale-commander:${dataDir}:v1`).digest('hex');
}

/**
 * Cordis plugin body.
 * @param {any} ctx
 * @param {Record<string, any>} config
 */
export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  const log = (message, error) => {
    if (error !== undefined) ctx.logger?.warn?.(`${PLUGIN_ID}: ${message} ${error instanceof Error ? error.message : String(error)}`);
    else ctx.logger?.info?.(`${PLUGIN_ID}: ${message}`);
  };

  const dataDir = resolveDataDir(settings.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const store = new Store({ file: join(dataDir, 'scale-commander.sqlite'), log: (message, error) => log(message, error) });
  const repository = new Repository(store);
  const credentials = ctx.get('credentials');
  const vault = new CredentialVault({
    dataDir,
    passphrase: resolvePassphrase(settings.tokenEncryptionKey, dataDir),
    credentials,
    log: (message, error) => log(message, error),
  });

  // Settings that the UI edits live in one meta row, so they survive restarts
  // without a schema change.
  let runtimeSettings = loadSettings(store, settings);
  const persistSettings = async (next) => {
    runtimeSettings = next;
    store.run("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
  };

  /**
   * Build (and memoise) the provider for one account. A sandbox account always
   * gets a sandbox provider; a real account gets the Amazon client with the
   * stored credentials.
   * @param {string} accountId
   * @param {{credentials?: any}} [override]
   * @returns {Promise<{provider: any, account: Record<string, any>}>}
   */
  const providerFor = async (accountId, override = {}) => {
    const account = repository.getAccount(accountId);
    if (account === undefined) throw new Error(`unknown account ${accountId}`);
    if (account.provider === 'sandbox') {
      const cached = providers.get(accountId);
      if (cached !== undefined) return { provider: cached, account };
      const provider = createSandboxProvider(accountId, { log: (message) => log(message) });
      provider.dryRun = false;
      providers.set(accountId, provider);
      return { provider, account };
    }
    const creds = override.credentials ?? await vault.get(accountId);
    if (creds === undefined) throw new Error('this account has no Amazon credentials yet');
    const provider = createAmazonClient(
      {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
        profileId: creds.profileId || account.profileId,
        region: account.region,
      },
      { timeoutMs: settings.requestTimeoutMs, dryRun: false, log: (message) => log(message) },
    );
    return { provider, account };
  };
  /** @type {Map<string, any>} */
  const providers = new Map();

  const sync = new SyncService({ repository, providerFor, log });
  const engine = new EngineService({ repository, providerFor, log });
  const analytics = new AnalyticsService({ repository });
  const mass = new MassService({ repository, providerFor, log });
  const scheduler = new Scheduler({
    repository,
    engine,
    providerFor,
    enabled: settings.schedulerEnabled,
    tickSeconds: settings.schedulerTickSeconds,
    log,
  });
  scheduler.configure(runtimeSettings.schedule);
  const service = new ScaleService({
    repository,
    engine,
    syncService: sync,
    analytics,
    mass,
    scheduler,
    vault,
    providerFor,
    settings: () => runtimeSettings,
    persistSettings,
    log,
  });

  // Expose the service so other plugins and the tools can reach it.
  const disposeService = ctx.provide('scaleCommander', service);
  ctx.effect(() => disposeService, 'scale-commander: service');

  const api = new ApiServer({
    service,
    admit: (req) => ctx.get('connection')?.requestRejection?.(req),
    log,
  });

  // The browser half needs the HTTP carrier; a headless composition keeps the
  // engine, the scheduler and the tools and simply serves no page.
  ctx.inject(['webServer'], (webCtx) => {
    if (typeof webCtx.webServer?.register !== 'function') return;
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => api.handle(req, res),
    }), `scale-commander: ${API_PREFIX}`);
  });

  ctx.effect(() => {
    scheduler.start();
    return async () => {
      await scheduler.stop();
    };
  }, 'scale-commander: scheduler');

  ctx.effect(() => () => {
    providers.clear();
    store.close();
  }, 'scale-commander: database');

  const toolDisposers = registerTools(ctx, { service, repository });
  ctx.effect(() => () => {
    for (const dispose of toolDisposers) dispose();
  }, 'scale-commander: tools');

  log(`ready — data in ${dataDir}, ${repository.listAccounts().length} account(s), scheduler ${settings.schedulerEnabled ? 'on' : 'off'}`);
}

/**
 * @param {Record<string, any>} config
 * @returns {Record<string, any>}
 */
function normalizeConfig(config) {
  return {
    dataDir: typeof config.dataDir === 'string' ? config.dataDir : '',
    provider: config.provider === 'sandbox' ? 'sandbox' : 'auto',
    defaultMarketplace: typeof config.defaultMarketplace === 'string' && MARKETPLACES[config.defaultMarketplace] !== undefined
      ? config.defaultMarketplace
      : 'ATVPDKIKX0DER',
    currency: typeof config.currency === 'string' && config.currency.length === 3 ? config.currency : 'USD',
    timezone: typeof config.timezone === 'string' && config.timezone.length > 0 ? config.timezone : 'America/Los_Angeles',
    dryRun: config.dryRun !== false,
    schedulerEnabled: config.schedulerEnabled !== false,
    schedulerTickSeconds: clamp(Number(config.schedulerTickSeconds ?? 60), 30, 3600, 60),
    historyDays: clamp(Number(config.historyDays ?? 400), 30, 1000, 400),
    maxPreviewRows: clamp(Number(config.maxPreviewRows ?? 2000), 50, 20000, 2000),
    requestTimeoutMs: clamp(Number(config.requestTimeoutMs ?? 45000), 5000, 180000, 45000),
    tokenEncryptionKey: typeof config.tokenEncryptionKey === 'string' ? config.tokenEncryptionKey : '',
  };
}

/**
 * @param {Store} store
 * @param {Record<string, any>} config
 * @returns {Record<string, any>}
 */
function loadSettings(store, config) {
  const row = store.get("SELECT value FROM meta WHERE key = 'settings'");
  let stored = {};
  if (row !== undefined) {
    try {
      stored = JSON.parse(String(row.value));
    } catch {
      stored = {};
    }
  }
  return {
    autoApply: stored.autoApply === true,
    schedule: {
      mode: stored.schedule?.mode ?? 'daily',
      hour: Number(stored.schedule?.hour ?? 6),
      minute: Number(stored.schedule?.minute ?? 0),
      everyHours: Number(stored.schedule?.everyHours ?? 6),
      timezone: stored.schedule?.timezone ?? config.timezone,
      autoApply: stored.schedule?.autoApply ?? false,
    },
    defaults: {
      daysToAnalyze: Number(stored.defaults?.daysToAnalyze ?? 30),
      daysToIgnore: Number(stored.defaults?.daysToIgnore ?? 2),
      maxActionsPerRun: Number(stored.defaults?.maxActionsPerRun ?? 500),
    },
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export { randomUUID, nowIso };
