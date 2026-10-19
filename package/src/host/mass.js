/**
 * Mass campaign builder.
 *
 * Turns a compact specification into a batch of real campaign skeletons:
 *  1. preview — render exactly what would be created, with per-campaign ids,
 *     names, bids and keyword sets, and no writes;
 *  2. create — call Amazon for each campaign, record every created id, and
 *     write one audit row per campaign so the batch can be undone;
 *  3. undo — delete the campaigns a batch created, newest first.
 *
 * The builder is intentionally conservative: campaigns are created PAUSED
 * unless the caller explicitly asks for ENABLED, so a mistake costs nothing.
 * @module host/mass
 */

import { randomUUID } from 'node:crypto';
import { nowIso } from './store.js';

/** Naming templates a seller can use in a mass build. */
export const NAME_TOKENS = ['{asin}', '{index}', '{bid}', '{theme}', '{date}', '{matchType}', '{campaignType}'];

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 * @param {(accountId: string) => Promise<{provider: any, account: any}>} deps.providerFor
 * @param {(message: string) => void} [deps.log]
 */
export class MassService {
  constructor(deps) {
    this.repository = deps.repository;
    this.providerFor = deps.providerFor;
    this.log = deps.log ?? (() => {});
  }

  /**
   * Expand a specification into concrete campaign plans.
   * @param {string} accountId
   * @param {Record<string, any>} spec
   * @returns {Array<Record<string, any>>}
   */
  plan(accountId, spec) {
    const account = this.repository.getAccount(accountId);
    if (account === undefined) throw new Error(`unknown account ${accountId}`);
    const asins = normalizeAsins(spec.asins);
    if (asins.length === 0) throw new Error('at least one ASIN is required');
    const bidLadder = normalizeLadder(spec.bidLadder ?? spec.bids ?? [0.5]);
    const matchTypes = normalizeMatchTypes(spec.matchTypes ?? ['exact']);
    const keywords = normalizeKeywordSeeds(spec.keywords);
    const themes = normalizeThemes(spec.themes);
    const naming = typeof spec.naming === 'string' && spec.naming.trim().length > 0
      ? spec.naming.trim()
      : '{asin} · {campaignType} · {bid}';
    const budget = Math.max(1, Number(spec.dailyBudget ?? 10));
    const defaultBid = Math.max(0.02, Number(spec.defaultBid ?? 0.75));
    const state = spec.state === 'ENABLED' ? 'ENABLED' : 'PAUSED';
    const startDate = typeof spec.startDate === 'string' && spec.startDate.length > 0 ? spec.startDate : new Date().toISOString().slice(0, 10);
    const portfolioId = String(spec.portfolioId ?? '');
    const products = new Map(this.repository.listProducts(accountId).map((product) => [product.asin, product]));
    /** @type {Array<Record<string, any>>} */
    const plans = [];
    let index = 0;
    for (const asin of asins) {
      const product = products.get(asin);
      for (const campaignType of normalizeCampaignTypes(spec.campaignTypes ?? ['auto'])) {
        const bids = campaignType === 'manual' ? [defaultBid] : bidLadder;
        for (const bid of bids) {
          index += 1;
          const name = renderName(naming, {
            asin,
            index,
            bid: bid.toFixed(2),
            theme: themes[0] ?? '',
            date: startDate,
            matchType: matchTypes[0] ?? '',
            campaignType: labelFor(campaignType),
          });
          const plan = {
            index,
            asin,
            campaignType,
            name,
            targetingType: campaignType === 'auto' ? 'AUTO' : 'MANUAL',
            dailyBudget: budget,
            defaultBid: bid,
            state,
            startDate,
            portfolioId,
            productTitle: product?.title ?? '',
            keywords: campaignType === 'manual'
              ? keywords.flatMap((keyword) => matchTypes.map((matchType) => ({ text: keyword, matchType, bid })))
              : [],
            productTargets: campaignType === 'asin' ? asins.filter((entry) => entry !== asin).slice(0, 4).map((entry) => ({
              expression: [{ type: 'ASIN', value: entry }],
              bid,
            })) : [],
          };
          plans.push(plan);
        }
      }
    }
    const max = Math.max(1, Math.min(500, Number(spec.limit ?? 200)));
    return plans.slice(0, max);
  }

  /**
   * Create the planned campaigns. Each campaign is one Amazon call set; a
   * failure on one campaign does not stop the batch.
   * @param {string} accountId
   * @param {Record<string, any>} spec
   * @param {{dryRun?: boolean, actor?: string, signal?: AbortSignal}} [options]
   * @returns {Promise<{batchId: string, planned: number, created: number, failed: number, campaigns: Array<Record<string, any>>}>}
   */
  async create(accountId, spec, options = {}) {
    const plans = this.plan(accountId, spec);
    const batchId = randomUUID();
    const dryRun = options.dryRun === true;
    /** @type {Array<Record<string, any>>} */
    const results = [];
    if (dryRun) {
      for (const plan of plans) {
        results.push({ index: plan.index, name: plan.name, asin: plan.asin, status: 'preview', plan });
      }
      this.repository.audit({ accountId, actor: options.actor ?? 'system', action: 'mass.preview', target: batchId, detail: { planned: plans.length } });
      return { batchId, planned: plans.length, created: 0, failed: 0, campaigns: results };
    }
    const { provider } = await this.providerFor(accountId);
    for (const plan of plans) {
      if (options.signal?.aborted === true) break;
      try {
        const answer = await provider.createCampaignSkeleton({
          name: plan.name,
          campaignType: 'sponsoredProducts',
          targetingType: plan.targetingType,
          state: plan.state,
          dailyBudget: plan.dailyBudget,
          startDate: plan.startDate,
          portfolioId: plan.portfolioId,
          defaultBid: plan.defaultBid,
          adGroupName: `${plan.name} — AG`,
          keywords: plan.keywords,
          productTargets: plan.productTargets,
        });
        const campaignId = String(answer.campaignId ?? '');
        const adGroupId = String(answer.adGroupId ?? '');
        if (campaignId.length > 0) {
          this.repository.putCampaign({
            id: campaignId,
            accountId,
            name: plan.name,
            adType: 'SP',
            targetingType: plan.targetingType,
            state: plan.state,
            budget: plan.dailyBudget,
            startDate: plan.startDate,
            asin: plan.asin,
            portfolioId: plan.portfolioId,
          });
        }
        if (adGroupId.length > 0) {
          this.repository.putAdGroup({
            id: adGroupId,
            accountId,
            campaignId,
            name: `${plan.name} — AG`,
            state: plan.state,
            defaultBid: plan.defaultBid,
            targetingType: plan.targetingType,
            asin: plan.asin,
          });
        }
        results.push({ index: plan.index, name: plan.name, asin: plan.asin, campaignId, adGroupId, status: 'created' });
      } catch (error) {
        results.push({
          index: plan.index,
          name: plan.name,
          asin: plan.asin,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const created = results.filter((entry) => entry.status === 'created').length;
    const failed = results.filter((entry) => entry.status === 'failed').length;
    this.repository.audit({
      accountId,
      actor: options.actor ?? 'system',
      action: 'mass.created',
      target: batchId,
      detail: { planned: plans.length, created, failed, campaignIds: results.filter((entry) => entry.campaignId !== undefined).map((entry) => entry.campaignId) },
    });
    return { batchId, planned: plans.length, created, failed, campaigns: results };
  }

  /**
   * Delete the campaigns one batch created.
   * @param {string} accountId
   * @param {{campaignIds: string[], actor?: string, dryRun?: boolean}} request
   * @returns {Promise<{deleted: number, failed: number, results: Array<Record<string, any>>}>}
   */
  async undo(accountId, request) {
    const ids = Array.isArray(request.campaignIds) ? request.campaignIds.map(String).filter((id) => id.length > 0) : [];
    if (ids.length === 0) throw new Error('campaignIds is required');
    if (request.dryRun === true) return { deleted: 0, failed: 0, results: ids.map((id) => ({ campaignId: id, status: 'preview' })) };
    const { provider } = await this.providerFor(accountId);
    const results = [];
    for (const id of ids) {
      try {
        await provider.deleteEntities('campaigns', 'SP', [id]);
        results.push({ campaignId: id, status: 'deleted' });
        this.repository.store.run('DELETE FROM campaigns WHERE id = ?', id);
      } catch (error) {
        results.push({ campaignId: id, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
    const deleted = results.filter((entry) => entry.status === 'deleted').length;
    this.repository.audit({ accountId, actor: request.actor ?? 'system', action: 'mass.undone', target: ids.join(','), detail: { deleted, failed: results.length - deleted } });
    return { deleted, failed: results.length - deleted, results };
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeAsins(value) {
  if (Array.isArray(value)) return [...new Set(value.map((entry) => String(entry).trim().toUpperCase()).filter((entry) => entry.length > 0))];
  if (typeof value === 'string') {
    return [...new Set(value.split(/[\s,;]+/u).map((entry) => entry.trim().toUpperCase()).filter((entry) => entry.length > 0))];
  }
  return [];
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function normalizeLadder(value) {
  const list = Array.isArray(value) ? value : String(value).split(/[\s,;]+/u);
  const numbers = list.map(Number).filter((entry) => Number.isFinite(entry) && entry > 0);
  return numbers.length === 0 ? [0.5] : [...new Set(numbers)].sort((left, right) => left - right);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeMatchTypes(value) {
  const list = Array.isArray(value) ? value : [value];
  const allowed = new Set(['exact', 'phrase', 'broad']);
  const out = list.map((entry) => String(entry).toLowerCase()).filter((entry) => allowed.has(entry));
  return out.length === 0 ? ['exact'] : [...new Set(out)];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeKeywordSeeds(value) {
  if (Array.isArray(value)) return [...new Set(value.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry.length > 0))];
  if (typeof value === 'string') return [...new Set(value.split(/[\n,;]+/u).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0))];
  return [];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeThemes(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/[,;]+/u).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return [];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCampaignTypes(value) {
  const list = Array.isArray(value) ? value : [value];
  const allowed = new Set(['auto', 'manual', 'asin']);
  const out = list.map((entry) => String(entry).toLowerCase()).filter((entry) => allowed.has(entry));
  return out.length === 0 ? ['auto'] : [...new Set(out)];
}

/**
 * @param {string} template
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
function renderName(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value));
  return out.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} type
 * @returns {string}
 */
function labelFor(type) {
  if (type === 'auto') return 'Auto';
  if (type === 'manual') return 'Manual';
  return 'ASIN';
}

export { nowIso };
