/**
 * Analytics: the read side of the product.
 *
 * Every report is computed from `metrics_daily` with SQL aggregation, then
 * enriched with derived metrics. The shape is what the browser renders: a
 * summary, a daily series, and ranked breakdowns. No report reads Amazon
 * directly, so charts never block on the network.
 * @module host/analytics
 */

import { readMetric, sumRows, formatMetric } from '../shared/metrics.js';
import { windowDates } from './store.js';

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 */
export class AnalyticsService {
  constructor(deps) {
    this.repository = deps.repository;
  }

  /**
   * The dashboard: KPI summary, series, and top movers for one window.
   * @param {string} accountId
   * @param {{days?: number, start?: string, end?: string, adType?: string, campaignId?: string}} [options]
   * @returns {Record<string, any>}
   */
  overview(accountId, options = {}) {
    const days = Math.max(1, Math.min(365, Number(options.days ?? 30)));
    const range = options.start !== undefined && options.end !== undefined
      ? { start: options.start, end: options.end }
      : (() => {
        const today = new Date().toISOString().slice(0, 10);
        const current = windowDates({ daysToAnalyze: days, daysToIgnore: 0, today });
        const previous = windowDates({ daysToAnalyze: days, daysToIgnore: days, today });
        return { start: current.start, end: current.end, previousStart: previous.start, previousEnd: previous.end };
      })();

    const campaignRows = this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end);
    const current = sumRows(campaignRows);
    const previous = range.previousStart === undefined
      ? null
      : sumRows(this.repository.aggregateMetrics(accountId, 'campaign', range.previousStart, range.previousEnd));
    const series = this.repository.metricSeries(accountId, { entityType: 'campaign', start: range.start, end: range.end, adType: options.adType });
    const campaigns = this.repository.listCampaigns(accountId);
    const adGroups = this.repository.listAdGroups(accountId);
    const keywords = this.repository.listKeywords(accountId);
    const products = this.repository.listProducts(accountId);
    const revenue = Number(current.sales ?? 0) + Number(current.organicSales ?? 0);

    return {
      accountId,
      window: { start: range.start, end: range.end, days },
      summary: decorate(current),
      previous: previous === null ? null : decorate(previous),
      deltas: previous === null ? null : deltas(decorate(current), decorate(previous)),
      series: series.map((row) => decorate({ ...row, dayCount: 1 })),
      totals: {
        campaigns: campaigns.length,
        activeCampaigns: campaigns.filter((campaign) => campaign.state === 'ENABLED').length,
        adGroups: adGroups.length,
        keywords: keywords.length,
        products: products.length,
      },
      unitEconomics: {
        tacos: revenue > 0 ? (Number(current.spend ?? 0) / revenue) * 100 : null,
        breakEvenAcos: decorate(current).breakEvenAcos,
        profit: decorate(current).profit,
        margin: decorate(current).margin,
      },
    };
  }

  /**
   * Ranked breakdown by campaign, ad group, keyword, target, or search term.
   * @param {string} accountId
   * @param {{level?: 'campaign'|'adGroup'|'keyword'|'target'|'searchTerm', days?: number, start?: string, end?: string, sort?: string, direction?: 'asc'|'desc', limit?: number, search?: string, campaignId?: string, adGroupId?: string}} [options]
   * @returns {Array<Record<string, any>>}
   */
  breakdown(accountId, options = {}) {
    const level = options.level ?? 'campaign';
    const days = Math.max(1, Math.min(365, Number(options.days ?? 30)));
    const range = options.start !== undefined && options.end !== undefined
      ? { start: options.start, end: options.end }
      : windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
    const limit = Math.max(1, Math.min(2000, Number(options.limit ?? 200)));
    const sort = options.sort ?? 'spend';
    const direction = options.direction === 'asc' ? 1 : -1;

    if (level === 'searchTerm') {
      const rows = this.repository.aggregateSearchTerms(accountId, {
        start: range.start,
        end: range.end,
        campaignId: options.campaignId,
        adGroupId: options.adGroupId,
        search: options.search,
        limit: 2000,
      });
      const decorated = rows.map((row) => ({
        id: String(row.id),
        name: String(row.text),
        text: String(row.text),
        campaignId: String(row.campaignId ?? ''),
        adGroupId: String(row.adGroupId ?? ''),
        adGroupCount: Number(row.adGroupCount ?? 1),
        ...decorate(row),
      }));
      return sortRows(decorated, sort, direction).slice(0, limit);
    }

    const entityType = level;
    const rows = this.repository.aggregateMetrics(accountId, entityType, range.start, range.end);
    const names = new Map();
    const parents = new Map();
    if (entityType === 'campaign') {
      for (const campaign of this.repository.listCampaigns(accountId)) {
        names.set(campaign.id, campaign.name);
        parents.set(campaign.id, { adType: campaign.adType, state: campaign.state, budget: campaign.budget, targetingType: campaign.targetingType });
      }
    } else if (entityType === 'adGroup') {
      for (const adGroup of this.repository.listAdGroups(accountId)) {
        names.set(adGroup.id, adGroup.name);
        parents.set(adGroup.id, { campaignId: adGroup.campaignId, state: adGroup.state, defaultBid: adGroup.defaultBid });
      }
    } else if (entityType === 'keyword') {
      for (const keyword of this.repository.listKeywords(accountId)) {
        names.set(keyword.id, keyword.text);
        parents.set(keyword.id, { campaignId: keyword.campaignId, adGroupId: keyword.adGroupId, matchType: keyword.matchType, bid: keyword.bid, state: keyword.state });
      }
    } else if (entityType === 'target') {
      for (const target of this.repository.listTargets(accountId)) {
        names.set(target.id, target.expression.map((entry) => String(entry.value ?? '')).join(' '));
        parents.set(target.id, { campaignId: target.campaignId, adGroupId: target.adGroupId, bid: target.bid, state: target.state });
      }
    }
    const search = (options.search ?? '').trim().toLowerCase();
    const decorated = rows
      .map((row) => ({
        id: String(row.entityId),
        name: names.get(String(row.entityId)) ?? String(row.entityId),
        ...(parents.get(String(row.entityId)) ?? {}),
        ...decorate(row),
      }))
      .filter((row) => {
        if (search.length > 0 && !String(row.name).toLowerCase().includes(search)) return false;
        if (options.campaignId !== undefined && options.campaignId !== '' && row.campaignId !== undefined && row.campaignId !== options.campaignId) return false;
        if (options.adGroupId !== undefined && options.adGroupId !== '' && row.adGroupId !== undefined && row.adGroupId !== options.adGroupId) return false;
        return true;
      });
    return sortRows(decorated, sort, direction).slice(0, limit);
  }

  /**
   * Unique-word performance: the data behind the negative-word rule and the
   * "main words" insight.
   * @param {string} accountId
   * @param {{days?: number, minClicks?: number, minWords?: number, limit?: number, search?: string}} [options]
   * @returns {Array<Record<string, any>>}
   */
  wordPerformance(accountId, options = {}) {
    const days = Math.max(1, Math.min(365, Number(options.days ?? 60)));
    const range = windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
    const minClicks = Math.max(0, Number(options.minClicks ?? 0));
    const limit = Math.max(1, Math.min(2000, Number(options.limit ?? 200)));
    const rows = this.repository.aggregateSearchTerms(accountId, { start: range.start, end: range.end, limit: 5000 });
    /** @type {Map<string, {metrics: Record<string, number>, terms: Set<string>}>} */
    const words = new Map();
    for (const row of rows) {
      const text = String(row.text ?? '').toLowerCase();
      const parts = new Set(text.split(/[^a-z0-9\u00c0-\u024f]+/u).filter((word) => word.length >= 2));
      for (const word of parts) {
        const entry = words.get(word) ?? { metrics: {}, terms: new Set() };
        for (const key of ['impressions', 'clicks', 'spend', 'sales', 'orders', 'units']) {
          entry.metrics[key] = Number(entry.metrics[key] ?? 0) + Number(row[key] ?? 0);
        }
        entry.terms.add(text);
        words.set(word, entry);
      }
    }
    const search = (options.search ?? '').trim().toLowerCase();
    return [...words.entries()]
      .map(([word, entry]) => ({
        id: word,
        name: word,
        word,
        terms: entry.terms.size,
        ...decorate(entry.metrics),
      }))
      .filter((row) => row.clicks >= minClicks && (search.length === 0 || row.word.includes(search)))
      .sort((left, right) => Number(right.spend) - Number(left.spend))
      .slice(0, limit);
  }

  /**
   * Dead keywords: active historically, no recent impressions. The revive
   * rule's candidate list, surfaced as a report.
   * @param {string} accountId
   * @param {{activeDays?: number, historyDays?: number, minOrders?: number, limit?: number}} [options]
   * @returns {Array<Record<string, any>>}
   */
  deadKeywords(accountId, options = {}) {
    const activeDays = Math.max(1, Math.min(180, Number(options.activeDays ?? 30)));
    const historyDays = Math.max(30, Math.min(365, Number(options.historyDays ?? 120)));
    const recent = windowDates({ daysToAnalyze: activeDays, daysToIgnore: 0 });
    const history = windowDates({ daysToAnalyze: historyDays, daysToIgnore: activeDays });
    const recentRows = new Map(this.repository.aggregateMetrics(accountId, 'keyword', recent.start, recent.end).map((row) => [String(row.entityId), row]));
    const historyRows = this.repository.aggregateMetrics(accountId, 'keyword', history.start, history.end);
    const keywords = new Map(this.repository.listKeywords(accountId).map((keyword) => [keyword.id, keyword]));
    const minOrders = Number(options.minOrders ?? 1);
    const limit = Math.max(1, Math.min(1000, Number(options.limit ?? 200)));
    return historyRows
      .filter((row) => Number(row.orders ?? 0) >= minOrders)
      .filter((row) => Number(recentRows.get(String(row.entityId))?.impressions ?? 0) < 1)
      .map((row) => {
        const keyword = keywords.get(String(row.entityId));
        return {
          id: String(row.entityId),
          name: keyword?.text ?? String(row.entityId),
          campaignId: keyword?.campaignId ?? '',
          adGroupId: keyword?.adGroupId ?? '',
          matchType: keyword?.matchType ?? '',
          bid: keyword?.bid ?? null,
          state: keyword?.state ?? '',
          ...decorate(row),
        };
      })
      .sort((left, right) => Number(right.sales) - Number(left.sales))
      .slice(0, limit);
  }

  /**
   * Placement performance: the numbers behind placement rules.
   * @param {string} accountId
   * @param {{days?: number, campaignId?: string, limit?: number}} [options]
   * @returns {Array<Record<string, any>>}
   */
  placements(accountId, options = {}) {
    const days = Math.max(1, Math.min(365, Number(options.days ?? 30)));
    const range = windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
    const rows = options.campaignId === undefined || options.campaignId === ''
      ? this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end)
      : this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end).filter((row) => String(row.entityId) === options.campaignId);
    const campaigns = new Map(this.repository.listCampaigns(accountId).map((campaign) => [campaign.id, campaign]));
    const limit = Math.max(1, Math.min(1000, Number(options.limit ?? 200)));
    return rows.slice(0, limit).map((row) => {
      const campaign = campaigns.get(String(row.entityId));
      const metrics = decorate(row);
      return {
        id: String(row.entityId),
        name: campaign?.name ?? String(row.entityId),
        state: campaign?.state ?? '',
        budget: campaign?.budget ?? null,
        placements: campaign?.placements ?? {},
        topOfSearch: {
          impressions: metrics.impressionsTopOfSearch,
          clicks: metrics.clicksTopOfSearch,
          sales: metrics.salesTopOfSearch,
          acos: metrics.topOfSearchAcos,
          cpc: metrics.topOfSearchCpc,
          ctr: metrics.topOfSearchCtr,
        },
        productPage: {
          impressions: metrics.impressionsProductPage,
          clicks: metrics.clicksProductPage,
          sales: metrics.salesProductPage,
          acos: metrics.productPageAcos,
          cpc: metrics.productPageCpc,
          ctr: metrics.productPageCtr,
        },
        restOfSearch: {
          impressions: metrics.impressionsRestOfSearch,
          clicks: metrics.clicksRestOfSearch,
          sales: metrics.salesRestOfSearch,
          acos: metrics.restOfSearchAcos,
          cpc: metrics.restOfSearchCpc,
          ctr: metrics.restOfSearchCtr,
        },
        acos: metrics.acos,
        spend: metrics.spend,
      };
    }).sort((left, right) => Number(right.spend) - Number(left.spend));
  }

  /**
   * Sales attribution: ad sales against organic sales, per ASIN.
   * @param {string} accountId
   * @param {{days?: number}} [options]
   * @returns {{summary: Record<string, any>, byAsin: Array<Record<string, any>>, series: Array<Record<string, any>>}}
   */
  attribution(accountId, options = {}) {
    const days = Math.max(1, Math.min(365, Number(options.days ?? 30)));
    const range = windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
    const campaignRows = this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end);
    const campaigns = this.repository.listCampaigns(accountId);
    const byAsin = new Map();
    for (const row of campaignRows) {
      const campaign = campaigns.find((entry) => entry.id === String(row.entityId));
      const asin = campaign?.asin || 'unmapped';
      const entry = byAsin.get(asin) ?? { asin, metrics: {} };
      for (const key of ['impressions', 'clicks', 'spend', 'sales', 'orders', 'units', 'organicSales', 'organicOrders', 'newToBrandSales', 'newToBrandOrders', 'returns', 'refundedSales', 'cogs', 'fbaFees']) {
        entry.metrics[key] = Number(entry.metrics[key] ?? 0) + Number(row[key] ?? 0);
      }
      byAsin.set(asin, entry);
    }
    const products = new Map(this.repository.listProducts(accountId).map((product) => [product.asin, product]));
    const summary = decorate(sumRows(campaignRows));
    const totalSales = Number(summary.sales ?? 0) + Number(summary.organicSales ?? 0);
    const series = this.repository.metricSeries(accountId, { entityType: 'campaign', start: range.start, end: range.end })
      .map((row) => decorate({ ...row, dayCount: 1 }));
    return {
      summary: {
        ...summary,
        totalSales,
        organicShare: totalSales > 0 ? (Number(summary.organicSales ?? 0) / totalSales) * 100 : null,
        adShare: totalSales > 0 ? (Number(summary.sales ?? 0) / totalSales) * 100 : null,
        tacos: totalSales > 0 ? (Number(summary.spend ?? 0) / totalSales) * 100 : null,
      },
      byAsin: [...byAsin.values()].map((entry) => {
        const metrics = decorate(entry.metrics);
        const product = products.get(entry.asin);
        return {
          asin: entry.asin,
          title: product?.title ?? '',
          price: product?.price ?? null,
          ...metrics,
          totalSales: Number(metrics.sales ?? 0) + Number(metrics.organicSales ?? 0),
        };
      }).sort((left, right) => Number(right.totalSales) - Number(left.totalSales)),
      series,
    };
  }

  /**
   * Inventory and restock forecast from sales velocity.
   * @param {string} accountId
   * @param {{days?: number}} [options]
   * @returns {Array<Record<string, any>>}
   */
  restock(accountId, options = {}) {
    const days = Math.max(7, Math.min(365, Number(options.days ?? 30)));
    const range = windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
    const campaignRows = this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end);
    const campaigns = this.repository.listCampaigns(accountId);
    const products = this.repository.listProducts(accountId);
    const unitsByAsin = new Map();
    for (const row of campaignRows) {
      const campaign = campaigns.find((entry) => entry.id === String(row.entityId));
      const asin = campaign?.asin || 'unmapped';
      unitsByAsin.set(asin, (unitsByAsin.get(asin) ?? 0) + Number(row.units ?? 0));
    }
    return products.map((product) => {
      const units = unitsByAsin.get(product.asin) ?? 0;
      const dailyUnits = units / days;
      return {
        asin: product.asin,
        title: product.title,
        price: product.price,
        cogs: product.cogs,
        unitsSold: units,
        dailyUnits,
        leadTimeDays: product.leadTimeDays,
        daysOfCover: dailyUnits > 0 ? null : null,
        restockUnits30: Math.ceil(dailyUnits * 30),
        projectedRevenue30: Math.round(dailyUnits * 30 * Number(product.price ?? 0) * 100) / 100,
        projectedProfit30: Math.round(dailyUnits * 30 * (Number(product.price ?? 0) - Number(product.cogs ?? 0) - Number(product.fbaFee ?? 0)) * 100) / 100,
      };
    }).sort((left, right) => Number(right.unitsSold) - Number(left.unitsSold));
  }
}

/**
 * Attach derived metrics to one aggregate row.
 * @param {Record<string, number>} row
 * @returns {Record<string, number|null>}
 */
export function decorate(row) {
  /** @type {Record<string, number|null>} */
  const out = {};
  for (const key of ['impressions', 'clicks', 'spend', 'sales', 'orders', 'units', 'organicSales', 'organicOrders', 'newToBrandSales', 'newToBrandOrders', 'returns', 'refundedSales', 'sessions', 'pageViews', 'buyBoxWins', 'cogs', 'fbaFees', 'dayCount', 'impressionsTopOfSearch', 'impressionsProductPage', 'impressionsRestOfSearch', 'clicksTopOfSearch', 'clicksProductPage', 'clicksRestOfSearch', 'salesTopOfSearch', 'salesProductPage', 'salesRestOfSearch', 'ordersTopOfSearch', 'ordersProductPage', 'ordersRestOfSearch']) {
    out[key] = Number(row[key] ?? 0);
  }
  for (const key of ['ctr', 'cvr', 'acos', 'roas', 'cpc', 'cpa', 'cpm', 'aov', 'unitsPerOrder', 'organicShare', 'tacos', 'returnRate', 'refundRate', 'profit', 'margin', 'breakEvenAcos', 'topOfSearchShare', 'productPageShare', 'restOfSearchShare', 'topOfSearchCtr', 'productPageCtr', 'restOfSearchCtr', 'topOfSearchAcos', 'productPageAcos', 'restOfSearchAcos', 'topOfSearchCpc', 'productPageCpc', 'restOfSearchCpc', 'impressionsPerDay', 'clicksPerDay', 'spendPerDay', 'salesPerDay']) {
    out[key] = readMetric(row, key);
  }
  return out;
}

/**
 * @param {Array<Record<string, any>>} left
 * @param {Array<Record<string, any>>} right
 * @returns {Record<string, number|null>}
 */
function deltas(left, right) {
  /** @type {Record<string, number|null>} */
  const out = {};
  for (const key of ['spend', 'sales', 'orders', 'clicks', 'impressions', 'acos', 'roas', 'cvr', 'ctr', 'cpc']) {
    const a = left[key];
    const b = right[key];
    if (a === null || b === null || b === 0 || a === undefined || b === undefined) {
      out[key] = null;
      continue;
    }
    out[key] = ((a - b) / Math.abs(b)) * 100;
  }
  return out;
}

/**
 * @param {Array<Record<string, any>>} rows
 * @param {string} key
 * @param {number} direction
 * @returns {Array<Record<string, any>>}
 */
function sortRows(rows, key, direction) {
  const copy = [...rows];
  copy.sort((left, right) => {
    const a = left[key];
    const b = right[key];
    const an = a === null || a === undefined ? Number.NEGATIVE_INFINITY : Number(a);
    const bn = b === null || b === undefined ? Number.NEGATIVE_INFINITY : Number(b);
    if (an === bn) return String(left.name ?? '').localeCompare(String(right.name ?? ''));
    return (an - bn) * direction;
  });
  return copy;
}

export { formatMetric };
