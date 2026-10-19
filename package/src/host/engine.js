/**
 * Rule engine and executor.
 *
 * `plan()` turns the stored rules plus the stored metrics into a set of
 * proposed actions — a pure read, so the UI can preview freely. `apply()`
 * executes a plan through the provider, writes one audit row per action, and
 * keeps the before/after values so `rollback()` can restore them.
 *
 * The executor is the only place in the plugin that mutates Amazon state, and
 * every path through it is either a preview (writes nothing) or an audited
 * apply (writes everything it changed).
 * @module host/engine
 */

import { randomUUID } from 'node:crypto';
import { evaluateRule, dedupeActions, analysisWindow } from '../shared/algorithms.js';
import { readMetric } from '../shared/metrics.js';
import { RULE_KINDS, ACTION_KINDS, defaultParams } from '../shared/domain.js';
import { METRIC_LABELS } from '../shared/metrics.js';
import { nowIso, windowDates } from './store.js';

/** Action kinds whose rollback is a plain value write-back to the local model. */
const REVERSIBLE_VALUE_KINDS = new Set([
  'bid', 'targetBid', 'defaultBid', 'campaignStatus', 'adGroupStatus',
  'keywordStatus', 'campaignBudget', 'placement',
]);

/** Settings applied to every rule unless the rule overrides them. */
export const DEFAULT_SETTINGS = {
  daysToAnalyze: 30,
  daysToIgnore: 2,
  maxActionsPerRun: 500,
  requirePreview: true,
};

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 * @param {(accountId: string) => Promise<{provider: any, account: any}>} deps.providerFor
 * @param {(message: string) => void} [deps.log]
 */
export class EngineService {
  constructor(deps) {
    this.repository = deps.repository;
    this.providerFor = deps.providerFor;
    this.log = deps.log ?? (() => {});
  }

  /**
   * Build the context one rule needs from stored state.
   * @param {Record<string, any>} account
   * @param {Record<string, any>} rule
   * @param {{campaignId?: string, adGroupId?: string, now?: Date, settings?: Record<string, number>}} scope
   * @returns {Record<string, any>}
   */
  #contextFor(account, rule, scope) {
    const settings = { ...DEFAULT_SETTINGS, ...(scope.settings ?? {}) };
    const window = analysisWindow(rule, { daysToAnalyze: settings.daysToAnalyze, daysToIgnore: settings.daysToIgnore });
    const dates = windowDates({ daysToAnalyze: window.daysToAnalyze, daysToIgnore: window.daysToIgnore });
    const campaigns = this.repository.listCampaigns(account.id);
    const adGroups = this.repository.listAdGroups(account.id, scope.campaignId === undefined ? {} : { campaignId: scope.campaignId });
    const keywords = this.repository.listKeywords(account.id);
    const targets = this.repository.listTargets(account.id);
    const negatives = this.repository.listNegatives(account.id);
    const products = this.repository.listProducts(account.id);
    const priceByAdGroup = new Map();
    const priceByAsin = new Map(products.map((product) => [product.asin, product.price]));
    for (const adGroup of adGroups) {
      const campaign = campaigns.find((entry) => entry.id === adGroup.campaignId);
      const asin = adGroup.asin || campaign?.asin || '';
      priceByAdGroup.set(adGroup.id, priceByAsin.get(asin) ?? null);
    }

    const campaignMetrics = indexById(this.repository.aggregateMetrics(account.id, 'campaign', dates.start, dates.end));
    const adGroupMetrics = indexById(this.repository.aggregateMetrics(account.id, 'adGroup', dates.start, dates.end));
    const keywordMetrics = indexById(this.repository.aggregateMetrics(account.id, 'keyword', dates.start, dates.end));
    const targetMetrics = indexById(this.repository.aggregateMetrics(account.id, 'target', dates.start, dates.end));
    const allMetrics = new Map([...campaignMetrics, ...adGroupMetrics, ...keywordMetrics, ...targetMetrics]);

    // Historical window for the revive algorithm: everything before the recent one.
    const historyStart = windowDates({ daysToAnalyze: 120, daysToIgnore: window.daysToAnalyze + window.daysToIgnore }).start;
    const historyEnd = windowDates({ daysToAnalyze: 1, daysToIgnore: window.daysToAnalyze + window.daysToIgnore }).end;
    const historyMetrics = new Map([
      ...indexById(this.repository.aggregateMetrics(account.id, 'keyword', historyStart, historyEnd)),
      ...indexById(this.repository.aggregateMetrics(account.id, 'target', historyStart, historyEnd)),
    ]);

    const profilesById = new Map(this.repository.listProfiles(account.id).map((profile) => [profile.id, profile]));
    const blacklist = rule.kind === 'blacklist' ? rule.params : {};
    const whitelistExact = new Set(normalizeList(blacklist.exactWhitelist));
    const whitelistPhrase = new Set(normalizeList(blacklist.phraseWhitelist));
    const protectedWords = new Set(products.flatMap((product) => String(product.title ?? '').toLowerCase().split(/[^a-z0-9]+/u)).filter((word) => word.length > 2));

    const recentActions = this.repository.listAppliedActions({ accountId: account.id, limit: 500 });
    const recentlyChanged = new Set(recentActions.filter((action) => {
      if (action.executedAt === null) return false;
      return Date.now() - Date.parse(action.executedAt) < 86_400_000;
    }).map((action) => `bid:${action.entityId}`));

    const existingKeywords = new Map();
    for (const keyword of keywords) {
      const key = keyword.adGroupId;
      const set = existingKeywords.get(key) ?? new Set();
      set.add(`${keyword.text.toLowerCase()}|${keyword.matchType}`);
      existingKeywords.set(key, set);
    }
    const existingNegatives = new Map();
    for (const negative of negatives) {
      const key = negative.adGroupId || negative.campaignId;
      const set = existingNegatives.get(key) ?? new Set();
      set.add(`${negative.text.toLowerCase()}|${negative.matchType}`);
      existingNegatives.set(key, set);
    }

    const scopedAdGroupIds = new Set(adGroups.map((entry) => entry.id));
    const searchTermCache = new Map();
    const searchTermsFor = (targetRule) => {
      const adGroupId = targetRule.adGroupId ?? scope.adGroupId ?? '';
      const source = String(targetRule.params?.source ?? 'asin');
      let cacheKey;
      let query;
      if (source === 'adGroup') {
        cacheKey = `ag:${adGroupId}`;
        query = { adGroupId, limit: 2000 };
      } else if (source === 'campaign') {
        const campaignId = targetRule.campaignId ?? scope.campaignId ?? '';
        cacheKey = `c:${campaignId}`;
        query = { campaignId, limit: 2000 };
      } else if (source === 'customGroup') {
        const groupName = String(targetRule.params?.customGroup ?? '');
        const ids = adGroups.filter((entry) => entry.customGroup === groupName).map((entry) => entry.id);
        cacheKey = `cg:${groupName}`;
        query = { adGroupIds: ids, limit: 2000 };
      } else {
        cacheKey = `acct:${account.id}`;
        query = { limit: 3000 };
      }
      const cached = searchTermCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const rows = this.repository.aggregateSearchTerms(account.id, { ...query, start: dates.start, end: dates.end });
      const mapped = rows.map((row) => ({
        id: String(row.id),
        text: String(row.text),
        campaignId: String(row.campaignId ?? ''),
        adGroupId: String(row.adGroupId ?? ''),
        matchType: String(row.matchType ?? ''),
        metrics: {
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          spend: Number(row.spend ?? 0),
          sales: Number(row.sales ?? 0),
          orders: Number(row.orders ?? 0),
          units: Number(row.units ?? 0),
        },
      }));
      searchTermCache.set(cacheKey, mapped);
      return mapped;
    };

    const scopedCampaigns = scope.campaignId === undefined ? campaigns : campaigns.filter((entry) => entry.id === scope.campaignId);
    const scopedAdGroups = scope.adGroupId === undefined ? adGroups.filter((entry) => scopedAdGroupIds.has(entry.id)) : adGroups.filter((entry) => entry.id === scope.adGroupId);
    const scopedKeywords = keywords.filter((keyword) => scopedAdGroups.some((adGroup) => adGroup.id === keyword.adGroupId));
    const scopedTargets = targets.filter((target) => scopedAdGroups.some((adGroup) => adGroup.id === target.adGroupId));

    return {
      now: scope.now ?? new Date(),
      timezone: account.timezone,
      labelOf: (key) => METRIC_LABELS[key] ?? key,
      campaigns: scopedCampaigns,
      adGroups: scopedAdGroups,
      targets: [
        ...scopedKeywords.filter((keyword) => keyword.state !== 'ARCHIVED').map((keyword) => ({
          id: keyword.id,
          kind: 'keyword',
          name: keyword.text,
          campaignId: keyword.campaignId,
          adGroupId: keyword.adGroupId,
          state: keyword.state,
          bid: keyword.bid ?? 0.75,
          suggestedBid: keyword.suggestedBid,
        })),
        ...scopedTargets.filter((target) => target.state !== 'ARCHIVED').map((target) => ({
          id: target.id,
          kind: 'target',
          name: expressionText(target.expression),
          campaignId: target.campaignId,
          adGroupId: target.adGroupId,
          state: target.state,
          bid: target.bid ?? 0.75,
          suggestedBid: null,
        })),
      ],
      metricsOf: (id) => allMetrics.get(id) ?? {},
      historicalMetricsOf: (id) => historyMetrics.get(id) ?? {},
      priceOf: (adGroupId) => priceByAdGroup.get(adGroupId) ?? null,
      profileOf: (targetRule) => {
        if (typeof targetRule.profileId === 'string' && targetRule.profileId.length > 0) return profilesById.get(targetRule.profileId) ?? null;
        if (targetRule.params?.inlineProfile !== undefined) return targetRule.params.inlineProfile;
        return null;
      },
      profilesOf: (targetRule) => {
        const entries = [];
        if (typeof targetRule.profileId === 'string' && targetRule.profileId.length > 0) {
          const profile = profilesById.get(targetRule.profileId);
          if (profile !== undefined) entries.push({ profile, adjustmentPercent: Number(targetRule.params?.criteriaAdjustmentPercent ?? 0) });
        }
        for (const extra of Array.isArray(targetRule.profiles) ? targetRule.profiles : []) {
          const profile = profilesById.get(String(extra.profileId));
          if (profile !== undefined) entries.push({ profile, adjustmentPercent: Number(extra.adjustmentPercent ?? 0) });
        }
        return entries;
      },
      searchTermsFor,
      existingKeywordSet: (adGroupId) => existingKeywords.get(adGroupId) ?? new Set(),
      existingNegativeSet: (adGroupId) => existingNegatives.get(adGroupId) ?? new Set(),
      isWhitelisted: (text, matchType) => {
        const needle = String(text).toLowerCase();
        if (matchType === 'negativePhrase' || matchType === undefined) return whitelistPhrase.has(needle) || whitelistExact.has(needle);
        return whitelistExact.has(needle);
      },
      protectedWords,
      hourlyScheduleOf: (adGroupId) => this.repository.hourlyByHour(account.id, { entityId: adGroupId, start: dates.start, end: dates.end }),
      existingScheduleOf: (adGroupId) => this.repository.listSchedules(account.id).find((schedule) => schedule.adGroupId === adGroupId) ?? null,
      recentlyChanged,
      window: { ...window, start: dates.start, end: dates.end },
    };
  }

  /**
   * Evaluate every enabled rule that has an assignment and return a plan.
   * Nothing is written.
   * @param {string} accountId
   * @param {{ruleIds?: string[], campaignId?: string, adGroupId?: string, settings?: Record<string, number>, now?: Date}} [options]
   * @returns {{accountId: string, generatedAt: string, actions: Array<Record<string, any>>, rules: Array<Record<string, any>>, skippedRules: Array<Record<string, any>>}}
   */
  plan(accountId, options = {}) {
    const account = this.repository.getAccount(accountId);
    if (account === undefined) throw new Error(`unknown account ${accountId}`);
    const rules = this.repository.listRules(accountId).filter((rule) => rule.enabled);
    const assignments = this.repository.listAssignments(accountId);
    const only = Array.isArray(options.ruleIds) && options.ruleIds.length > 0 ? new Set(options.ruleIds) : undefined;
    const accountDryRun = options.accountDryRun === true;
    /** @type {Array<Record<string, any>>} */
    const actions = [];
    /** @type {Array<Record<string, any>>} */
    const evaluated = [];
    /** @type {Array<Record<string, any>>} */
    const skippedRules = [];

    for (const rule of rules) {
      if (only !== undefined && !only.has(rule.id)) continue;
      const own = assignments.filter((assignment) => assignment.ruleId === rule.id);
      const scoped = own.filter((assignment) => {
        if (options.campaignId !== undefined && options.campaignId !== '' && assignment.campaignId !== options.campaignId) return false;
        if (options.adGroupId !== undefined && options.adGroupId !== '' && assignment.adGroupId !== options.adGroupId) return false;
        return true;
      });
      if (scoped.length === 0) {
        skippedRules.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, reason: 'No assignment in scope' });
        continue;
      }
      let produced = 0;
      const groups = new Map();
      for (const assignment of scoped) {
        const key = `${assignment.campaignId}|${assignment.adGroupId}`;
        const list = groups.get(key) ?? [];
        list.push(assignment);
        groups.set(key, list);
      }
      for (const [key, group] of groups) {
        const [campaignId, adGroupId] = key.split('|');
        const context = this.#contextFor(account, rule, {
          campaignId: campaignId === '' ? undefined : campaignId,
          adGroupId: adGroupId === '' ? undefined : adGroupId,
          now: options.now,
          settings: options.settings,
        });
        const ruleForScope = { ...rule, campaignId, adGroupId };
        const evaluatedActions = dedupeActions(evaluateRule(ruleForScope, context));
        for (const entry of evaluatedActions) {
          if (entry.kind === 'skip') continue;
          if (entry.kind === 'error') {
            skippedRules.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, reason: entry.reason });
            continue;
          }
          if (!Object.hasOwn(ACTION_KINDS, entry.kind)) continue;
          produced += 1;
          actions.push({
            id: randomUUID(),
            ruleId: rule.id,
            ruleName: rule.name,
            ruleKind: rule.kind,
            dryRun: rule.dryRun === true || accountDryRun,
            accountId,
            ...entry,
            campaignId: entry.campaignId || campaignId,
            adGroupId: entry.adGroupId || adGroupId,
            window: context.window,
            objectiveId: group[0]?.objectiveId ?? '',
          });
        }
      }
      evaluated.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, assignments: scoped.length, actions: produced });
    }

    const limit = Number(options.settings?.maxActionsPerRun ?? DEFAULT_SETTINGS.maxActionsPerRun);
    const trimmed = actions.slice(0, Math.max(1, limit));
    const dropped = actions.length - trimmed.length;
    return {
      accountId,
      generatedAt: nowIso(),
      actions: trimmed,
      rules: evaluated,
      skippedRules,
      droppedByLimit: dropped,
    };
  }

  /**
   * Execute a plan. Actions the plan marked `dryRun`, plus every action when
   * `dryRun` is forced, are recorded as `previewed` and never sent to Amazon.
   * @param {string} accountId
   * @param {{plan?: ReturnType<EngineService['plan']>, ruleIds?: string[], campaignId?: string, adGroupId?: string, trigger?: string, dryRun?: boolean, actor?: string, settings?: Record<string, number>}} options
   * @returns {Promise<Record<string, any>>}
   */
  async apply(accountId, options = {}) {
    const account = this.repository.getAccount(accountId);
    if (account === undefined) throw new Error(`unknown account ${accountId}`);
    const plan = options.plan ?? this.plan(accountId, options);
    const forcedDryRun = options.dryRun === true;
    const run = {
      id: randomUUID(),
      accountId,
      trigger: options.trigger ?? 'manual',
      scope: options.campaignId ?? options.adGroupId ?? '',
      status: 'running',
      dryRun: forcedDryRun,
      startedAt: nowIso(),
      planned: plan.actions.length,
      applied: 0,
      failed: 0,
      skipped: 0,
      summary: {},
    };
    this.repository.putRun(run);
    for (const action of plan.actions) {
      this.repository.putRunAction({
        id: action.id,
        runId: run.id,
        accountId,
        ruleId: action.ruleId,
        ruleName: action.ruleName,
        kind: action.kind,
        entityType: action.entityType,
        entityId: action.entityId,
        entityName: action.entityName,
        campaignId: action.campaignId,
        adGroupId: action.adGroupId,
        before: action.before,
        after: action.after,
        reason: action.reason,
        calculation: action.calculation,
        metrics: action.metrics,
        status: forcedDryRun || action.dryRun ? 'previewed' : 'pending',
      });
    }

    if (forcedDryRun) {
      const summary = summarize(plan.actions, { applied: 0, failed: 0, skipped: plan.actions.length, previewed: plan.actions.length });
      this.repository.putRun({ ...run, status: 'previewed', finishedAt: nowIso(), skipped: plan.actions.length, summary });
      this.repository.audit({ accountId, actor: options.actor ?? 'system', action: 'run.previewed', target: run.id, detail: { planned: plan.actions.length } });
      return { run: this.repository.getRun(run.id), actions: this.repository.listRunActions(run.id) };
    }

    let provider;
    try {
      const resolved = await this.providerFor(accountId);
      provider = resolved.provider;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.putRun({ ...run, status: 'failed', finishedAt: nowIso(), error: message });
      throw error;
    }

    const batches = groupByTarget(plan.actions);
    const results = [];
    for (const batch of batches) {
      const outcome = await this.#executeBatch(provider, account, batch, run.id);
      results.push(...outcome);
    }

    const applied = results.filter((entry) => entry.status === 'applied').length;
    const failed = results.filter((entry) => entry.status === 'failed').length;
    const skipped = results.filter((entry) => entry.status === 'skipped').length;
    const summary = summarize(plan.actions, { applied, failed, skipped, previewed: 0 });
    const finished = this.repository.putRun({
      ...run,
      status: failed > 0 && applied === 0 ? 'failed' : 'completed',
      finishedAt: nowIso(),
      applied,
      failed,
      skipped,
      summary,
    });
    this.repository.audit({
      accountId,
      actor: options.actor ?? 'system',
      action: 'run.applied',
      target: run.id,
      detail: { planned: plan.actions.length, applied, failed, skipped, trigger: run.trigger },
    });
    return { run: finished, actions: this.repository.listRunActions(run.id) };
  }

  /**
   * Execute one homogeneous batch (same action kind, same ad type) in a single
   * Amazon call, then persist the per-action outcome.
   * @param {any} provider
   * @param {Record<string, any>} account
   * @param {Array<Record<string, any>>} batch
   * @param {string} runId
   * @returns {Promise<Array<{id: string, status: string, error?: string}>>}
   */
  async #executeBatch(provider, account, batch, runId) {
    const kind = batch[0].kind;
    const adType = this.#adTypeOf(batch[0], account.id);
    const pending = batch.filter((action) => action.status !== 'previewed');
    if (pending.length === 0) return batch.map((action) => ({ id: action.id, status: 'previewed' }));
    /** @type {Record<string, unknown>} */
    let payload;
    let call;
    switch (kind) {
      case 'bid':
        payload = { keywords: pending.map((action) => ({ keywordId: action.entityId, bid: Number(action.after) })) };
        call = () => provider.updateKeywords(adType, payload.keywords);
        break;
      case 'targetBid':
        payload = { targets: pending.map((action) => ({ targetId: action.entityId, bid: Number(action.after) })) };
        call = () => provider.updateTargets(adType, payload.targets);
        break;
      case 'defaultBid':
        payload = { adGroups: pending.map((action) => ({ adGroupId: action.entityId, defaultBid: Number(action.after) })) };
        call = () => provider.updateAdGroups(adType, payload.adGroups);
        break;
      case 'campaignStatus':
        payload = { campaigns: pending.map((action) => ({ campaignId: action.entityId, state: String(action.after) })) };
        call = () => provider.updateCampaigns(adType, payload.campaigns);
        break;
      case 'adGroupStatus':
        payload = { adGroups: pending.map((action) => ({ adGroupId: action.entityId, state: String(action.after) })) };
        call = () => provider.updateAdGroups(adType, payload.adGroups);
        break;
      case 'keywordStatus':
        payload = { keywords: pending.map((action) => ({ keywordId: action.entityId, state: String(action.after) })) };
        call = () => provider.updateKeywords(adType, payload.keywords);
        break;
      case 'campaignBudget':
        payload = { campaigns: pending.map((action) => ({ campaignId: action.entityId, dailyBudget: Number(action.after) })) };
        call = () => (typeof provider.updateBudgets === 'function'
          ? provider.updateBudgets(pending.map((action) => ({ campaignId: action.entityId, budget: { budget: Number(action.after), budgetType: 'DAILY' } })))
          : provider.updateCampaigns(adType, pending.map((action) => ({ campaignId: action.entityId, dailyBudget: Number(action.after) }))));
        break;
      case 'placement':
        payload = {
          campaigns: pending.map((action) => {
            const campaign = this.repository.getCampaign(action.entityId);
            const placements = { ...(campaign?.placements ?? {}) };
            const key = placementKeyOf(action);
            placements[key] = Number(action.after?.modifier ?? action.after);
            return {
              campaignId: action.entityId,
              placement: {
                placementTop: placements.topOfSearch ?? 0,
                placementProductPage: placements.productPage ?? 0,
                placementRestOfSearch: placements.restOfSearch ?? 0,
              },
            };
          }),
        };
        call = () => provider.updateCampaigns(adType, payload.campaigns);
        break;
      case 'negativeKeyword':
        payload = {
          negativeKeywords: pending.map((action) => ({
            campaignId: action.campaignId,
            adGroupId: action.adGroupId,
            keywordText: String(action.after?.text ?? action.entityName),
            matchType: String(action.after?.matchType ?? 'negativeExact'),
            state: 'ENABLED',
          })),
        };
        call = () => provider.createNegativeKeywords(adType, payload.negativeKeywords);
        break;
      case 'negativeTarget':
        payload = { negativeTargets: pending.map((action) => ({ campaignId: action.campaignId, adGroupId: action.adGroupId, expression: action.after?.expression ?? [] })) };
        call = async () => ({ negativeTargets: { success: [], error: [] } });
        break;
      case 'importKeyword':
        payload = {
          keywords: pending.map((action) => ({
            campaignId: action.campaignId,
            adGroupId: action.adGroupId,
            keywordText: String(action.after?.text ?? action.entityName),
            matchType: String(action.after?.matchType ?? 'exact'),
            bid: Number(action.after?.bid ?? 0.75),
            state: 'ENABLED',
          })),
        };
        call = () => provider.createKeywords(adType, payload.keywords);
        break;
      case 'importTarget':
        payload = { targets: pending.map((action) => ({ campaignId: action.campaignId, adGroupId: action.adGroupId, expression: action.after?.expression ?? [], bid: Number(action.after?.bid ?? 0.75) })) };
        call = () => provider.createTargets(adType, payload.targets);
        break;
      case 'dayparting':
        return this.#applyDayparting(batch, runId);
      default:
        for (const action of pending) {
          this.repository.putRunAction({ ...action, runId, status: 'skipped', error: `no executor for ${kind}` });
        }
        return pending.map((action) => ({ id: action.id, status: 'skipped', error: `no executor for ${kind}` }));
    }

    try {
      const answer = await call();
      const failedIds = collectFailures(answer);
      const outcomes = [];
      for (const action of pending) {
        if (failedIds.has(action.entityId)) {
          this.repository.putRunAction({ ...action, runId, status: 'failed', error: failedIds.get(action.entityId), amazonRequest: JSON.stringify(payload).slice(0, 4000) });
          outcomes.push({ id: action.id, status: 'failed', error: failedIds.get(action.entityId) });
          continue;
        }
        this.#applyLocalEffect(action);
        this.repository.putRunAction({
          ...action,
          runId,
          status: 'applied',
          executedAt: nowIso(),
          amazonRequest: JSON.stringify(payload).slice(0, 4000),
        });
        outcomes.push({ id: action.id, status: 'applied' });
      }
      return [...outcomes, ...batch.filter((action) => action.status === 'previewed').map((action) => ({ id: action.id, status: 'previewed' }))];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const action of pending) {
        this.repository.putRunAction({ ...action, runId, status: 'failed', error: message, amazonRequest: JSON.stringify(payload).slice(0, 4000) });
      }
      return pending.map((action) => ({ id: action.id, status: 'failed', error: message }));
    }
  }

  /**
   * Dayparting is a stored schedule plus a scheduler that enforces it; it does
   * not call Amazon on creation.
   * @param {Array<Record<string, any>>} batch
   * @param {string} runId
   * @returns {Array<{id: string, status: string}>}
   */
  #applyDayparting(batch, runId) {
    const outcomes = [];
    for (const action of batch) {
      const hours = Array.isArray(action.after?.hours) ? action.after.hours : [];
      this.repository.putSchedule({
        id: randomUUID(),
        accountId: action.accountId,
        adGroupId: action.adGroupId,
        campaignId: action.campaignId,
        timezone: action.after?.timezone ?? 'America/Los_Angeles',
        hours,
        mode: action.after?.mode ?? 'schedule',
        ruleId: action.ruleId,
        enabled: true,
      });
      this.repository.putRunAction({ ...action, runId, status: 'applied', executedAt: nowIso() });
      outcomes.push({ id: action.id, status: 'applied' });
    }
    return outcomes;
  }

  /**
   * Reflect a successful Amazon write in the local read model so the next
   * preview sees the new state without waiting for a sync.
   * @param {Record<string, any>} action
   */
  #applyLocalEffect(action) {
    switch (action.kind) {
      case 'bid':
      case 'keywordStatus':
        this.repository.updateKeywordLocal({ id: action.entityId, bid: action.kind === 'bid' ? Number(action.after) : null, state: action.kind === 'keywordStatus' ? String(action.after) : null });
        break;
      case 'targetBid':
        this.repository.updateTargetLocal({ id: action.entityId, bid: Number(action.after) });
        break;
      case 'defaultBid':
      case 'adGroupStatus':
        this.repository.updateAdGroupLocal({ id: action.entityId, defaultBid: action.kind === 'defaultBid' ? Number(action.after) : null, state: action.kind === 'adGroupStatus' ? String(action.after) : null });
        break;
      case 'campaignStatus': {
        const campaign = this.repository.getCampaign(action.entityId);
        if (campaign !== undefined) this.repository.putCampaign({ ...campaign, state: String(action.after) });
        break;
      }
      case 'campaignBudget': {
        const campaign = this.repository.getCampaign(action.entityId);
        if (campaign !== undefined) this.repository.putCampaign({ ...campaign, budget: Number(action.after) });
        break;
      }
      case 'placement': {
        const campaign = this.repository.getCampaign(action.entityId);
        if (campaign !== undefined) {
          const placements = { ...campaign.placements };
          placements[placementKeyOf(action)] = Number(action.after?.modifier ?? action.after);
          this.repository.putCampaign({ ...campaign, placements });
        }
        break;
      }
      case 'negativeKeyword':
        this.repository.putNegative({
          id: randomUUID(),
          accountId: action.accountId,
          campaignId: action.campaignId,
          adGroupId: action.adGroupId,
          level: 'adGroup',
          text: String(action.after?.text ?? action.entityName),
          matchType: String(action.after?.matchType ?? 'negativeExact'),
          state: 'ENABLED',
          source: 'rule',
          ruleId: action.ruleId,
        });
        break;
      case 'importKeyword':
        this.repository.putKeyword({
          id: action.entityId.startsWith('SBX-') || action.entityId.startsWith('new-') ? action.entityId : `new-${action.id}`,
          accountId: action.accountId,
          campaignId: action.campaignId,
          adGroupId: action.adGroupId,
          text: String(action.after?.text ?? ''),
          matchType: String(action.after?.matchType ?? 'exact'),
          state: 'ENABLED',
          bid: Number(action.after?.bid ?? 0.75),
        });
        break;
      default:
        break;
    }
  }

  /**
   * Restore the `before` value of every applied action in a run, newest first.
   * Each restoration is itself an audited Amazon write.
   * @param {string} runId
   * @param {{actor?: string, onlyActionIds?: string[]}} [options]
   * @returns {Promise<{runId: string, restored: number, failed: number, actions: Array<Record<string, any>>}>}
   */
  async rollback(runId, options = {}) {
    const run = this.repository.getRun(runId);
    if (run === undefined) throw new Error(`unknown run ${runId}`);
    const all = this.repository.listRunActions(runId);
    const only = Array.isArray(options.onlyActionIds) && options.onlyActionIds.length > 0 ? new Set(options.onlyActionIds) : undefined;
    const candidates = all
      .filter((action) => action.status === 'applied' && action.rolledBackAt === null)
      .filter((action) => only === undefined || only.has(action.id))
      .reverse();
    if (candidates.length === 0) return { runId, restored: 0, failed: 0, actions: [] };
    const account = this.repository.getAccount(run.accountId);
    if (account === undefined) throw new Error(`unknown account ${run.accountId}`);
    const { provider } = await this.providerFor(account.id);
    const results = [];
    for (const action of candidates) {
      try {
        await this.#restore(provider, account, action);
        this.repository.putRunAction({ ...action, runId, status: 'rolled-back', rolledBackAt: nowIso() });
        // `#restore` owns the local effect for creations (it deletes them) and
        // for dayparting (it removes the schedule); only value changes need the
        // generic write-back, which would otherwise re-create a deleted row.
        if (REVERSIBLE_VALUE_KINDS.has(action.kind)) this.#applyLocalEffect({ ...action, after: action.before });
        results.push({ id: action.id, entityName: action.entityName, status: 'restored' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.repository.putRunAction({ ...action, runId, status: 'rollback-failed', error: message });
        results.push({ id: action.id, entityName: action.entityName, status: 'failed', error: message });
      }
    }
    const restored = results.filter((entry) => entry.status === 'restored').length;
    const failed = results.length - restored;
    this.repository.putRun({ ...run, summary: { ...run.summary, rollback: { restored, failed, at: nowIso() } } });
    this.repository.audit({ accountId: account.id, actor: options.actor ?? 'system', action: 'run.rolled-back', target: runId, detail: { restored, failed } });
    return { runId, restored, failed, actions: results };
  }

  /**
   * Send one inverse write.
   * @param {any} provider
   * @param {Record<string, any>} account
   * @param {Record<string, any>} action
   * @returns {Promise<void>}
   */
  async #restore(provider, account, action) {
    const adType = this.#adTypeOf(action, account.id);
    switch (action.kind) {
      case 'bid':
        await provider.updateKeywords(adType, [{ keywordId: action.entityId, bid: Number(action.before) }]);
        return;
      case 'targetBid':
        await provider.updateTargets(adType, [{ targetId: action.entityId, bid: Number(action.before) }]);
        return;
      case 'defaultBid':
        await provider.updateAdGroups(adType, [{ adGroupId: action.entityId, defaultBid: Number(action.before) }]);
        return;
      case 'campaignStatus':
        await provider.updateCampaigns(adType, [{ campaignId: action.entityId, state: String(action.before) }]);
        return;
      case 'adGroupStatus':
        await provider.updateAdGroups(adType, [{ adGroupId: action.entityId, state: String(action.before) }]);
        return;
      case 'keywordStatus':
        await provider.updateKeywords(adType, [{ keywordId: action.entityId, state: String(action.before) }]);
        return;
      case 'campaignBudget':
        if (typeof provider.updateBudgets === 'function') {
          await provider.updateBudgets([{ campaignId: action.entityId, budget: { budget: Number(action.before), budgetType: 'DAILY' } }]);
        } else {
          await provider.updateCampaigns(adType, [{ campaignId: action.entityId, dailyBudget: Number(action.before) }]);
        }
        return;
      case 'placement': {
        const campaign = this.repository.getCampaign(action.entityId);
        const placements = { ...(campaign?.placements ?? {}) };
        placements[placementKeyOf(action)] = Number(action.before?.modifier ?? action.before);
        await provider.updateCampaigns(adType, [{
          campaignId: action.entityId,
          placement: {
            placementTop: placements.topOfSearch ?? 0,
            placementProductPage: placements.productPage ?? 0,
            placementRestOfSearch: placements.restOfSearch ?? 0,
          },
        }]);
        return;
      }
      case 'negativeKeyword': {
        const candidates = this.repository.listNegatives(account.id).filter((entry) => entry.text === String(action.after?.text ?? '')
          && entry.matchType === String(action.after?.matchType ?? '')
          && entry.adGroupId === action.adGroupId);
        for (const negative of candidates) {
          if (typeof provider.deleteEntities === 'function') {
            await provider.deleteEntities('negativeKeywords', adType, [negative.id]);
          }
          this.repository.deleteNegative(negative.id);
        }
        return;
      }
      case 'importKeyword':
        if (typeof provider.deleteEntities === 'function') {
          await provider.deleteEntities('keywords', adType, [action.entityId]);
        }
        return;
      case 'importTarget':
        if (typeof provider.deleteEntities === 'function') {
          await provider.deleteEntities('targets', adType, [action.entityId]);
        }
        return;
      case 'dayparting': {
        const schedule = this.repository.listSchedules(account.id).find((entry) => entry.adGroupId === action.adGroupId);
        if (schedule !== undefined) this.repository.deleteSchedule(schedule.id);
        return;
      }
      default:
        throw new Error(`no inverse operation for ${action.kind}`);
    }
  }

  /**
   * @param {Record<string, any>} action
   * @param {string} accountId
   * @returns {'SP'|'SB'|'SD'}
   */
  #adTypeOf(action, accountId) {
    const campaign = this.repository.getCampaign(action.campaignId);
    if (campaign !== undefined) return campaign.adType;
    const adGroup = this.repository.getAdGroup(action.adGroupId);
    if (adGroup !== undefined) {
      const parent = this.repository.getCampaign(adGroup.campaignId);
      if (parent !== undefined) return parent.adType;
    }
    const entityCampaign = action.entityType === 'campaign' ? this.repository.getCampaign(action.entityId) : undefined;
    return entityCampaign?.adType ?? 'SP';
  }
}

/**
 * Group actions so one Amazon call covers every action of the same kind and
 * ad type. Ordering is stable: the first action's position decides the batch's
 * position.
 * @param {Array<Record<string, any>>} actions
 * @returns {Array<Array<Record<string, any>>>}
 */
function groupByTarget(actions) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const groups = new Map();
  for (const action of actions) {
    const key = `${action.kind}|${action.campaignId}`;
    const list = groups.get(key) ?? [];
    list.push(action);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/**
 * @param {Record<string, any>} action
 * @returns {'topOfSearch'|'productPage'|'restOfSearch'}
 */
function placementKeyOf(action) {
  const candidate = action.after?.placement ?? action.before?.placement;
  if (candidate === 'productPage' || candidate === 'restOfSearch' || candidate === 'topOfSearch') return candidate;
  return 'topOfSearch';
}

/**
 * Pull per-entity failures out of an Amazon batch answer.
 * @param {any} answer
 * @returns {Map<string, string>}
 */
function collectFailures(answer) {
  const failures = new Map();
  if (answer === null || typeof answer !== 'object') return failures;
  for (const value of Object.values(answer)) {
    if (value === null || typeof value !== 'object') continue;
    const errors = value.error;
    if (Array.isArray(errors)) {
      for (const error of errors) {
        const index = Number(error.index ?? -1);
        const id = String(error.key ?? error.id ?? index);
        failures.set(id, `${String(error.code ?? 'error')}: ${String(error.message ?? '')}`);
      }
    }
  }
  return failures;
}

/**
 * @param {Array<Record<string, any>>} actions
 * @param {{applied: number, failed: number, skipped: number, previewed: number}} counts
 * @returns {Record<string, any>}
 */
function summarize(actions, counts) {
  const byKind = {};
  const byRule = {};
  for (const action of actions) {
    byKind[action.kind] = (byKind[action.kind] ?? 0) + 1;
    const key = action.ruleName || action.ruleId || 'unknown';
    byRule[key] = (byRule[key] ?? 0) + 1;
  }
  return { ...counts, byKind, byRule, total: actions.length };
}

/**
 * @param {Array<Record<string, number>>} rows
 * @returns {Map<string, Record<string, number>>}
 */
function indexById(rows) {
  const map = new Map();
  for (const row of rows) map.set(String(row.entityId), row);
  return map;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry.length > 0))];
}

/**
 * @param {Array<{type?: string, value?: string}>} expression
 * @returns {string}
 */
function expressionText(expression) {
  if (!Array.isArray(expression) || expression.length === 0) return '';
  return expression.map((entry) => String(entry.value ?? entry.type ?? '')).filter((part) => part.length > 0).join(' ');
}

/**
 * A rule's default parameters merged with what the caller supplied. Exported
 * so the API and the UI build the same object.
 * @param {string} kind
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
export function normalizeParams(kind, params) {
  if (!Object.hasOwn(RULE_KINDS, kind)) throw new Error(`unknown rule kind "${kind}"`);
  return { ...defaultParams(kind), ...(params ?? {}) };
}

export { readMetric };
