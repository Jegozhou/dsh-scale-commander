/**
 * Sync service: pulls structure and performance from Amazon into SQLite.
 *
 * Three phases, each independently re-runnable:
 *  1. structure — campaigns, ad groups, keywords, targets, negatives;
 *  2. reporting — daily performance for campaign / ad-group / keyword / target;
 *  3. search terms — the aggregated queries that the harvest and negation rules read.
 *
 * A sync is incremental by default: it re-reads the last `overlapDays` days
 * because Amazon restates attribution, and only fetches older data when the
 * store has no history yet.
 * @module host/sync
 */

import { nowIso, windowDates } from './store.js';
import { marketplaceInfo } from './amazon.js';

const AD_TYPES = ['SP', 'SB', 'SD'];

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 * @param {(accountId: string) => Promise<{provider: any, account: any}>} deps.providerFor
 * @param {(message: string) => void} [deps.log]
 */
export class SyncService {
  constructor(deps) {
    this.repository = deps.repository;
    this.providerFor = deps.providerFor;
    this.log = deps.log ?? (() => {});
    this.inFlight = new Map();
  }

  /**
   * Sync one account. Concurrent calls for the same account share one run.
   * @param {string} accountId
   * @param {{structure?: boolean, metrics?: boolean, searchTerms?: boolean, hourly?: boolean, days?: number, overlapDays?: number, signal?: AbortSignal}} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async sync(accountId, options = {}) {
    const existing = this.inFlight.get(accountId);
    if (existing !== undefined) return existing;
    const promise = this.#sync(accountId, options).finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, promise);
    return promise;
  }

  async #sync(accountId, options) {
    const started = Date.now();
    const account = this.repository.getAccount(accountId);
    if (account === undefined) throw new Error(`unknown account ${accountId}`);
    const { provider } = await this.providerFor(accountId);
    const wantStructure = options.structure !== false;
    const wantMetrics = options.metrics !== false;
    const wantTerms = options.searchTerms !== false;
    const wantHourly = options.hourly === true;
    const overlapDays = Math.max(0, Math.min(14, Number(options.overlapDays ?? 3)));
    const today = new Date().toISOString().slice(0, 10);
    const summary = { structure: {}, metrics: { rows: 0, days: 0 }, searchTerms: 0, hourly: 0, provider: account.provider };

    try {
      if (wantStructure) summary.structure = await this.#syncStructure(account, provider);

      if (wantMetrics) {
        const requestedDays = Math.max(7, Math.min(365, Number(options.days ?? 90)));
        const lastSynced = this.repository.syncState(accountId, 'metrics')?.synced_at;
        const lastDate = this.repository.latestMetricDate(accountId);
        let start;
        if (lastDate === undefined || lastSynced === undefined) {
          start = windowDates({ daysToAnalyze: requestedDays, daysToIgnore: 0, today }).start;
        } else {
          start = shiftDate(lastDate, -overlapDays);
          const earliest = windowDates({ daysToAnalyze: requestedDays, daysToIgnore: 0, today }).start;
          if (start > earliest) start = earliest;
        }
        const rows = await this.#syncMetrics(account, provider, start, today);
        summary.metrics = { rows, days: daysBetween(start, today) + 1, start, end: today };
        this.repository.putSyncState(accountId, 'metrics', today, rows);
      }

      if (wantTerms) {
        const start = windowDates({ daysToAnalyze: 60, daysToIgnore: 0, today }).start;
        summary.searchTerms = await this.#syncSearchTerms(account, provider, start, today);
        this.repository.putSyncState(accountId, 'searchTerms', today, summary.searchTerms);
      }

      if (wantHourly) {
        const start = windowDates({ daysToAnalyze: 30, daysToIgnore: 0, today }).start;
        summary.hourly = await this.#syncHourly(account, provider, start, today);
        this.repository.putSyncState(accountId, 'hourly', today, summary.hourly);
      }

      if (account.provider === 'sandbox' && typeof provider.products === 'function') {
        for (const product of provider.products()) this.repository.putProduct(accountId, product);
        summary.products = provider.products().length;
      }

      const updated = this.repository.putAccount({
        ...account,
        status: 'connected',
        lastSyncAt: nowIso(),
        lastError: '',
      });
      summary.account = updated;
      summary.durationMs = Date.now() - started;
      this.repository.audit({
        accountId,
        actor: 'sync',
        action: 'sync.completed',
        target: accountId,
        detail: { metrics: summary.metrics.rows, searchTerms: summary.searchTerms, durationMs: summary.durationMs },
      });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.putAccount({ ...account, status: 'error', lastError: message });
      this.repository.audit({
        accountId,
        actor: 'sync',
        action: 'sync.failed',
        target: accountId,
        detail: { message, code: error?.code ?? '' },
      });
      throw error;
    }
  }

  /**
   * @param {Record<string, any>} account
   * @param {any} provider
   * @returns {Promise<Record<string, number>>}
   */
  async #syncStructure(account, provider) {
    const counts = { campaigns: 0, adGroups: 0, keywords: 0, targets: 0, negatives: 0 };
    /** @type {Map<string, string>} */
    const campaignAsin = new Map();
    for (const adType of AD_TYPES) {
      let campaigns = [];
      try {
        campaigns = await provider.listCampaigns(adType);
      } catch (error) {
        if (adType === 'SP') throw error;
        this.log(`sync: ${adType} campaigns unavailable — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const raw of campaigns) {
        const id = String(raw.campaignId ?? raw.campaign_id ?? '');
        if (id.length === 0) continue;
        const placement = raw.placement ?? raw.dynamicBiddingPlacement ?? {};
        const asin = String(raw.asin ?? raw.associatedAsin ?? '');
        campaignAsin.set(id, asin);
        this.repository.putCampaign({
          id,
          accountId: account.id,
          name: String(raw.name ?? ''),
          adType,
          targetingType: String(raw.targetingType ?? 'MANUAL'),
          state: String(raw.state ?? 'ENABLED'),
          budget: numberOrNull(raw.dailyBudget ?? raw.budget?.budget ?? raw.budget),
          bidding: String(raw.dynamicBidding?.strategy ?? raw.bidding?.strategy ?? ''),
          portfolioId: String(raw.portfolioId ?? ''),
          placements: {
            topOfSearch: Number(placement.placementTop ?? placement.topOfSearch ?? 0),
            productPage: Number(placement.placementProductPage ?? placement.productPage ?? 0),
            restOfSearch: Number(placement.placementRestOfSearch ?? placement.restOfSearch ?? 0),
          },
          startDate: String(raw.startDate ?? ''),
          asin,
        });
        counts.campaigns += 1;
      }

      let adGroups = [];
      try {
        adGroups = await provider.listAdGroups(adType);
      } catch (error) {
        if (adType === 'SP') throw error;
        adGroups = [];
      }
      for (const raw of adGroups) {
        const id = String(raw.adGroupId ?? raw.ad_group_id ?? '');
        if (id.length === 0) continue;
        const campaignId = String(raw.campaignId ?? '');
        this.repository.putAdGroup({
          id,
          accountId: account.id,
          campaignId,
          name: String(raw.name ?? ''),
          state: String(raw.state ?? 'ENABLED'),
          defaultBid: numberOrNull(raw.defaultBid),
          targetingType: String(raw.targetingType ?? 'MANUAL'),
          asin: campaignAsin.get(campaignId) ?? '',
        });
        counts.adGroups += 1;
      }

      if (adType !== 'SD') {
        let keywords = [];
        try {
          keywords = await provider.listKeywords(adType);
        } catch {
          keywords = [];
        }
        for (const raw of keywords) {
          const id = String(raw.keywordId ?? raw.keyword_id ?? '');
          if (id.length === 0) continue;
          this.repository.putKeyword({
            id,
            accountId: account.id,
            campaignId: String(raw.campaignId ?? ''),
            adGroupId: String(raw.adGroupId ?? ''),
            text: String(raw.keywordText ?? raw.keyword ?? ''),
            matchType: String(raw.matchType ?? 'exact').toLowerCase(),
            state: String(raw.state ?? 'ENABLED'),
            bid: numberOrNull(raw.bid),
            suggestedBid: numberOrNull(raw.suggestedBid),
            servingStatus: String(raw.servingStatus ?? ''),
            createdAt: String(raw.creationDate ?? ''),
          });
          counts.keywords += 1;
        }
      }

      let targets = [];
      try {
        targets = await provider.listTargets(adType);
      } catch {
        targets = [];
      }
      for (const raw of targets) {
        const id = String(raw.targetId ?? raw.targetingId ?? raw.target_id ?? '');
        if (id.length === 0) continue;
        this.repository.putTarget({
          id,
          accountId: account.id,
          campaignId: String(raw.campaignId ?? ''),
          adGroupId: String(raw.adGroupId ?? ''),
          expression: Array.isArray(raw.expression) ? raw.expression : [],
          targetType: String(raw.expressionType ?? raw.targetingType ?? 'ASIN'),
          state: String(raw.state ?? 'ENABLED'),
          bid: numberOrNull(raw.bid),
        });
        counts.targets += 1;
      }

      // Product ads associate each ad group with the ASIN it sells; the engine
      // needs that to find a product price for bid maths.
      let productAds = [];
      try {
        productAds = typeof provider.listProductAds === 'function' ? await provider.listProductAds(adType) : [];
      } catch {
        productAds = [];
      }
      for (const raw of productAds) {
        const adGroupId = String(raw.adGroupId ?? '');
        const asin = String(raw.asin ?? '');
        if (adGroupId.length === 0 || asin.length === 0) continue;
        const adGroup = this.repository.getAdGroup(adGroupId);
        if (adGroup !== undefined) this.repository.putAdGroup({ ...adGroup, asin });
        const campaignId = String(raw.campaignId ?? adGroup?.campaignId ?? '');
        if (campaignId.length > 0) {
          const campaign = this.repository.getCampaign(campaignId);
          if (campaign !== undefined && campaign.asin.length === 0) this.repository.putCampaign({ ...campaign, asin });
        }
      }

      for (const loader of ['listNegativeKeywords', 'listCampaignNegativeKeywords']) {
        let negatives = [];
        try {
          negatives = await provider[loader](adType);
        } catch {
          negatives = [];
        }
        for (const raw of negatives) {
          const text = String(raw.keywordText ?? raw.keyword ?? raw.expression?.[0]?.value ?? '');
          if (text.length === 0) continue;
          const level = loader === 'listCampaignNegativeKeywords' ? 'campaign' : 'adGroup';
          this.repository.putNegative({
            id: String(raw.keywordId ?? raw.campaignNegativeKeywordId ?? `${level}-${text}`),
            accountId: account.id,
            campaignId: String(raw.campaignId ?? ''),
            adGroupId: String(raw.adGroupId ?? ''),
            level,
            text,
            matchType: String(raw.matchType ?? 'negativeExact'),
            state: String(raw.state ?? 'ENABLED'),
            source: 'amazon',
          });
          counts.negatives += 1;
        }
      }
    }
    return counts;
  }

  /**
   * @param {Record<string, any>} account
   * @param {any} provider
   * @param {string} start
   * @param {string} end
   * @returns {Promise<number>}
   */
  async #syncMetrics(account, provider, start, end) {
    const report = await provider.createReport({
      adProduct: 'sp',
      reportTypeId: 'spCampaigns',
      startDate: start,
      endDate: end,
      groupBy: ['campaign', 'adGroup'],
      hourly: false,
    });
    const ready = await provider.waitForReport(report.reportId);
    const rows = await provider.downloadReport(ready.url ?? 'sandbox://report');
    let written = 0;
    this.repository.store.transaction(() => {
      for (const row of rows) {
        const date = String(row.date ?? '');
        if (date.length === 0) continue;
        const campaignId = String(row.campaignId ?? '');
        const adGroupId = String(row.adGroupId ?? '');
        const keywordId = String(row.keywordId ?? '');
        const targetId = String(row.targetId ?? '');
        const common = mapReportRow(row, account.id, date);
        if (campaignId.length > 0 && keywordId.length === 0 && targetId.length === 0 && adGroupId.length === 0) {
          this.repository.putMetric({ ...common, entityType: 'campaign', entityId: campaignId });
          written += 1;
        }
        if (adGroupId.length > 0 && keywordId.length === 0 && targetId.length === 0) {
          this.repository.putMetric({ ...common, entityType: 'adGroup', entityId: adGroupId });
          written += 1;
        }
        if (keywordId.length > 0) {
          this.repository.putMetric({ ...common, entityType: 'keyword', entityId: keywordId });
          written += 1;
        }
        if (targetId.length > 0) {
          this.repository.putMetric({ ...common, entityType: 'target', entityId: targetId });
          written += 1;
        }
      }
    });
    return written;
  }

  /**
   * @param {Record<string, any>} account
   * @param {any} provider
   * @param {string} start
   * @param {string} end
   * @returns {Promise<number>}
   */
  async #syncSearchTerms(account, provider, start, end) {
    const report = await provider.createReport({
      adProduct: 'sp',
      reportTypeId: 'spSearchTerm',
      startDate: start,
      endDate: end,
      groupBy: ['searchTerm'],
      hourly: false,
    });
    const ready = await provider.waitForReport(report.reportId);
    const rows = await provider.downloadReport(ready.url ?? 'sandbox://report');
    let written = 0;
    this.repository.store.transaction(() => {
      for (const row of rows) {
        const text = String(row.searchTerm ?? row.query ?? '').trim();
        if (text.length === 0) continue;
        const date = String(row.date ?? end);
        const adGroupId = String(row.adGroupId ?? '');
        const campaignId = String(row.campaignId ?? '');
        const keywordId = String(row.keywordId ?? '');
        this.repository.putSearchTerm({
          id: `${adGroupId}|${text}|${date}|${keywordId}`,
          accountId: account.id,
          campaignId,
          adGroupId,
          text,
          matchType: String(row.matchType ?? ''),
          date,
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          spend: Number(row.cost ?? row.spend ?? 0),
          sales: Number(row.sales ?? 0),
          orders: Number(row.purchases ?? row.orders ?? 0),
          units: Number(row.unitsSold ?? row.units ?? 0),
        });
        written += 1;
      }
    });
    return written;
  }

  /**
   * @param {Record<string, any>} account
   * @param {any} provider
   * @param {string} start
   * @param {string} end
   * @returns {Promise<number>}
   */
  async #syncHourly(account, provider, start, end) {
    const report = await provider.createReport({
      adProduct: 'sp',
      reportTypeId: 'spCampaigns',
      startDate: start,
      endDate: end,
      groupBy: ['campaign', 'adGroup'],
      hourly: true,
    });
    const ready = await provider.waitForReport(report.reportId);
    const rows = await provider.downloadReport(ready.url ?? 'sandbox://report');
    let written = 0;
    this.repository.store.transaction(() => {
      for (const row of rows) {
        const campaignId = String(row.campaignId ?? '');
        if (campaignId.length === 0) continue;
        const date = String(row.date ?? '');
        if (date.length === 0) continue;
        this.repository.putHourly({
          entityType: 'campaign',
          entityId: campaignId,
          accountId: account.id,
          date,
          hour: Number(row.hour ?? 0),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          spend: Number(row.cost ?? row.spend ?? 0),
          sales: Number(row.sales ?? 0),
          orders: Number(row.purchases ?? row.orders ?? 0),
        });
        written += 1;
      }
    });
    return written;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} accountId
 * @param {string} date
 * @returns {Record<string, unknown>}
 */
function mapReportRow(row, accountId, date) {
  return {
    accountId,
    date,
    adType: 'SP',
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(row.cost ?? row.spend ?? 0),
    sales: Number(row.sales ?? 0),
    orders: Number(row.purchases ?? row.orders ?? 0),
    units: Number(row.unitsSold ?? row.units ?? 0),
    organicSales: Number(row.organicSales ?? 0),
    organicOrders: Number(row.organicOrders ?? 0),
    newToBrandSales: Number(row.newToBrandSales ?? 0),
    newToBrandOrders: Number(row.newToBrandPurchases ?? 0),
    returns: Number(row.returns ?? 0),
    refundedSales: Number(row.refundedSales ?? 0),
    impressionsTopOfSearch: Number(row.impressionsTopOfSearch ?? 0),
    impressionsProductPage: Number(row.impressionsProductPage ?? 0),
    impressionsRestOfSearch: Number(row.impressionsRestOfSearch ?? 0),
    clicksTopOfSearch: Number(row.clicksTopOfSearch ?? 0),
    clicksProductPage: Number(row.clicksProductPage ?? 0),
    clicksRestOfSearch: Number(row.clicksRestOfSearch ?? 0),
    salesTopOfSearch: Number(row.salesTopOfSearch ?? 0),
    salesProductPage: Number(row.salesProductPage ?? 0),
    salesRestOfSearch: Number(row.salesRestOfSearch ?? 0),
    ordersTopOfSearch: Number(row.purchasesTopOfSearch ?? 0),
    ordersProductPage: Number(row.purchasesProductPage ?? 0),
    ordersRestOfSearch: Number(row.purchasesRestOfSearch ?? 0),
    sessions: Number(row.sessions ?? 0),
    pageViews: Number(row.pageViews ?? 0),
    buyBoxWins: Number(row.buyBoxWins ?? 0),
    cogs: Number(row.cogs ?? 0),
    fbaFees: Number(row.fbaFees ?? 0),
  };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} date
 * @param {number} days
 * @returns {string}
 */
function shiftDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * @param {string} start
 * @param {string} end
 * @returns {number}
 */
function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export { marketplaceInfo };
