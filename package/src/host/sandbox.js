/**
 * Sandbox Amazon Ads provider.
 *
 * Implements the same surface as {@link AmazonAdsClient} against a deterministic
 * in-memory account so every workflow — sync, preview, apply, rollback — can be
 * exercised and verified without Amazon credentials. The generator models real
 * PPC behaviour: a long tail of low-volume keywords, a few winners, hourly
 * seasonality, placement skew, and delayed attribution on recent days.
 *
 * Nothing here pretends to be Amazon: the provider reports `provider: 'sandbox'`
 * on every account it serves, and the UI labels it.
 * @module host/sandbox
 */

import { MARKETPLACES } from '../shared/domain.js';

/** Deterministic PRNG so a sandbox account looks the same across restarts. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Product seeds: a plausible catalogue with prices that make ACOS maths real. */
const CATALOG = [
  { asin: 'B0SILICONE01', title: 'Silicone Spatula Set — 5 Piece Heat Resistant', price: 24.99, cogs: 6.2, fba: 4.15 },
  { asin: 'B0RESIST02', title: 'Resistance Bands Set — 5 Levels with Door Anchor', price: 29.99, cogs: 7.4, fba: 4.85 },
  { asin: 'B0KNIFE03', title: 'Chef Knife 8 Inch — High Carbon Stainless', price: 42.5, cogs: 12.1, fba: 5.2 },
  { asin: 'B0YOGA04', title: 'Yoga Mat 6mm Non-Slip with Carry Strap', price: 34.99, cogs: 9.8, fba: 6.4 },
  { asin: 'B0LAMP05', title: 'LED Desk Lamp with USB-C Charging Port', price: 39.99, cogs: 11.5, fba: 5.9 },
];

/** Keyword themes per product, used to generate realistic search terms. */
const THEMES = {
  B0SILICONE01: ['silicone spatula', 'spatula set', 'heat resistant spatula', 'kitchen utensils', 'baking spatula', 'spatula toys', 'kids spatula', 'rubber spatula'],
  B0RESIST02: ['resistance bands', 'exercise bands', 'workout bands', 'bike resistance bands', 'choke bands', 'physical therapy bands', 'home gym equipment'],
  B0KNIFE03: ['chef knife', 'kitchen knife', '8 inch knife', 'carbon steel knife', 'knife for cooking', 'chef knife set'],
  B0YOGA04: ['yoga mat', 'exercise mat', 'non slip yoga mat', 'thick yoga mat', 'travel yoga mat', 'yoga mat bag'],
  B0LAMP05: ['desk lamp', 'led desk lamp', 'usb c lamp', 'office lamp', 'reading lamp', 'dimmable desk lamp'],
};

const MODIFIERS = ['', ' for kitchen', ' set', ' heavy duty', ' professional', ' cheap', ' best', ' with stand', ' large', ' small', ' for beginners'];

/**
 * Generate the sandbox account graph.
 * @param {string} accountId
 * @param {{seed?: number, days?: number, today?: string}} [options]
 * @returns {SandboxData}
 */
function generate(accountId, options = {}) {
  const seed = options.seed ?? hashSeed(accountId);
  const random = mulberry32(seed);
  const days = Math.max(30, Math.min(400, options.days ?? 120));
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  /** @type {SandboxCampaign[]} */
  const campaigns = [];
  /** @type {SandboxAdGroup[]} */
  const adGroups = [];
  /** @type {SandboxKeyword[]} */
  const keywords = [];
  /** @type {SandboxTarget[]} */
  const targets = [];
  /** @type {SandboxNegative[]} */
  const negatives = [];
  /** @type {SandboxMetrics[]} */
  const metrics = [];
  /** @type {SandboxHourly[]} */
  const hourly = [];
  /** @type {SandboxSearchTerm[]} */
  const searchTerms = [];
  const products = CATALOG.map((entry) => ({ ...entry, accountId }));

  let campaignSeq = 0;
  for (const [productIndex, product] of CATALOG.entries()) {
    const theme = THEMES[product.asin] ?? ['product'];
    const isAuto = productIndex % 2 === 0;
    const structures = [
      { suffix: 'Exact — Winners', targeting: 'MANUAL', budget: 40 + productIndex * 5, keywords: theme.slice(0, 4), matchType: 'exact' },
      { suffix: 'Phrase — Discovery', targeting: 'MANUAL', budget: 25 + productIndex * 3, keywords: theme.slice(2, 6), matchType: 'phrase' },
      { suffix: 'Auto — Discovery', targeting: 'AUTO', budget: 20 + productIndex * 2, keywords: [], matchType: 'broad' },
      { suffix: 'ASIN Targeting', targeting: 'MANUAL', budget: 18 + productIndex * 2, keywords: [], matchType: 'broad', targets: true },
    ];
    for (const [structureIndex, structure] of structures.entries()) {
      campaignSeq += 1;
      // A real Amazon id is opaque; these only need to be unique and stable.
      const campaignId = `${productIndex + 1}${String(structureIndex + 1).padStart(2, '0')}${String(campaignSeq).padStart(4, '0')}`;
      const campaign = {
        id: campaignId,
        name: `${product.asin} · ${structure.suffix}`,
        adType: 'SP',
        targetingType: structure.targeting,
        state: random() < 0.12 ? 'PAUSED' : 'ENABLED',
        budget: structure.budget,
        bidding: random() < 0.5 ? 'LEGACY_FOR_SALES' : 'AUTO_FOR_SALES',
        portfolioId: '',
        placements: {
          topOfSearch: [0, 30, 50, 75, 100][Math.floor(random() * 5)],
          productPage: [0, 20, 40][Math.floor(random() * 3)],
          restOfSearch: [0, 10][Math.floor(random() * 2)],
        },
        asin: product.asin,
        startDate: shiftDate(today, -days - 20),
        price: product.price,
        performance: {
          // Per-campaign strength: some campaigns are simply better than others.
          quality: 0.55 + random() * 0.9,
          baseCpc: 0.55 + random() * 0.85,
          baseCtr: 0.0025 + random() * 0.006,
          baseCvr: 0.045 + random() * 0.14,
          decay: structureIndex === 2 ? 0.55 : 1,
        },
      };
      campaigns.push(campaign);

      const adGroupId = `${campaignId}AG1`;
      adGroups.push({
        id: adGroupId,
        campaignId,
        name: `${campaign.name} — AG`,
        state: campaign.state,
        defaultBid: 0.75 + random() * 0.4,
        targetingType: structure.targeting,
        customGroup: productIndex === 1 ? 'research' : '',
        asin: product.asin,
      });

      if (structure.keywords.length > 0) {
        for (const [keywordIndex, text] of structure.keywords.entries()) {
          const quality = 0.5 + random() * 1.2;
          keywords.push({
            id: `${adGroupId}KW${keywordIndex}`,
            campaignId,
            adGroupId,
            text,
            matchType: structure.matchType,
            state: random() < 0.08 ? 'PAUSED' : 'ENABLED',
            bid: Math.round((0.5 + random() * 1.4) * 100) / 100,
            suggestedBid: Math.round((0.6 + random() * 1.1) * 100) / 100,
            quality,
            theme,
          });
        }
      }
      if (structure.targets === true) {
        for (let targetIndex = 0; targetIndex < 4; targetIndex += 1) {
          const competitor = CATALOG[(productIndex + targetIndex + 1) % CATALOG.length];
          targets.push({
            id: `${adGroupId}TG${targetIndex}`,
            campaignId,
            adGroupId,
            expression: [{ type: 'ASIN', value: competitor.asin }],
            targetType: 'ASIN',
            state: random() < 0.1 ? 'PAUSED' : 'ENABLED',
            bid: Math.round((0.45 + random() * 0.9) * 100) / 100,
            quality: 0.4 + random() * 1.0,
            theme,
          });
        }
      }
      if (structure.targeting === 'AUTO') {
        // Auto campaigns expose four targeting groups as target clauses.
        for (const [groupIndex, group] of ['close-match', 'loose-match', 'substitutes', 'complements'].entries()) {
          targets.push({
            id: `${adGroupId}AT${groupIndex}`,
            campaignId,
            adGroupId,
            expression: [{ type: 'AUTO', value: group }],
            targetType: 'AUTO',
            state: 'ENABLED',
            bid: null,
            quality: 0.5 + random() * 0.9,
            theme,
          });
        }
      }
    }
  }

  // Negative keywords already present (some pre-existing, some from earlier runs).
  for (const adGroup of adGroups.slice(0, 6)) {
    negatives.push({
      id: `${adGroup.id}NK0`,
      campaignId: adGroup.campaignId,
      adGroupId: adGroup.id,
      text: 'free',
      matchType: 'negativeExact',
      state: 'ENABLED',
      level: 'adGroup',
    });
  }

  // Daily metrics for every campaign and ad group, plus placement splits.
  const startDate = shiftDate(today, -(days - 1));
  for (const campaign of campaigns) {
    const adGroup = adGroups.find((entry) => entry.campaignId === campaign.id);
    if (adGroup === undefined) continue;
    const product = products.find((entry) => entry.asin === campaign.asin);
    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const date = shiftDate(startDate, dayOffset);
      const ageDays = days - dayOffset;
      // Attribution lag: the last two days report less than they will later.
      const lagFactor = ageDays <= 2 ? 0.55 + ageDays * 0.15 : 1;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekly = [0.82, 0.9, 0.95, 1.0, 1.05, 1.12, 1.18][weekday];
      const season = 1 + Math.sin((dayOffset / days) * Math.PI * 2) * 0.12;
      const trend = 1 + (dayOffset / days) * 0.18;
      const base = 60 * campaign.performance.quality * weekly * season * trend;
      const impressions = Math.round(base * (0.75 + random() * 0.5) * 10);
      const clicks = Math.max(0, Math.round(impressions * campaign.performance.baseCtr * (0.8 + random() * 0.4)));
      const cpc = campaign.performance.baseCpc * (0.85 + random() * 0.3);
      const spend = round2(clicks * cpc);
      const cvr = campaign.performance.baseCvr * campaign.performance.decay * (0.7 + random() * 0.6);
      const orders = Math.max(0, Math.round(clicks * cvr * lagFactor));
      const units = orders + (orders > 0 && random() < 0.18 ? Math.round(orders * random() * 0.5) : 0);
      const sales = round2(units * product.price);
      const returns = random() < 0.06 ? Math.round(units * 0.2) : 0;
      const refunded = round2(returns * product.price);
      const tosShare = 0.25 + random() * 0.3;
      const ppShare = 0.15 + random() * 0.25;
      const rosShare = Math.max(0, 1 - tosShare - ppShare);
      const row = {
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        adGroupId: adGroup.id,
        date,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        units,
        organicSales: round2(sales * (0.4 + random() * 0.8)),
        organicOrders: Math.round(orders * (0.5 + random() * 0.8)),
        newToBrandSales: round2(sales * random() * 0.25),
        newToBrandOrders: Math.round(orders * random() * 0.2),
        returns,
        refundedSales: refunded,
        impressionsTopOfSearch: Math.round(impressions * tosShare),
        impressionsProductPage: Math.round(impressions * ppShare),
        impressionsRestOfSearch: Math.round(impressions * rosShare),
        clicksTopOfSearch: Math.round(clicks * (tosShare * 1.15)),
        clicksProductPage: Math.round(clicks * ppShare),
        clicksRestOfSearch: Math.round(clicks * (rosShare * 0.9)),
        salesTopOfSearch: round2(sales * tosShare * 1.2),
        salesProductPage: round2(sales * ppShare),
        salesRestOfSearch: round2(sales * rosShare * 0.85),
        ordersTopOfSearch: Math.round(orders * tosShare * 1.2),
        ordersProductPage: Math.round(orders * ppShare),
        ordersRestOfSearch: Math.round(orders * rosShare * 0.85),
        sessions: Math.round(orders * (8 + random() * 12)),
        pageViews: Math.round(orders * (12 + random() * 18)),
        buyBoxWins: 0,
        cogs: round2(units * product.cogs),
        fbaFees: round2(units * product.fba),
      };
      row.buyBoxWins = Math.round(row.pageViews * (0.9 + random() * 0.1));
      metrics.push(row);
      // Ad-group level mirrors the campaign row so both aggregations agree.
      metrics.push({ ...row, entityType: 'adGroup', entityId: adGroup.id });

      // Keyword-level split of the ad group's row.
      const groupKeywords = keywords.filter((keyword) => keyword.adGroupId === adGroup.id);
      const groupTargets = targets.filter((target) => target.adGroupId === adGroup.id);
      const weighted = [
        ...groupKeywords.map((keyword) => ({ id: keyword.id, weight: keyword.quality * (keyword.matchType === 'exact' ? 1.4 : 1) })),
        ...groupTargets.map((target) => ({ id: target.id, weight: target.quality })),
      ];
      const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
      for (const entry of weighted) {
        const share = entry.weight / totalWeight;
        const wImpressions = Math.round(impressions * share);
        const wClicks = Math.round(clicks * share);
        const wOrders = Math.max(0, Math.round(orders * share * (0.7 + random() * 0.6)));
        const wUnits = Math.max(wOrders, Math.round(units * share * (0.7 + random() * 0.6)));
        const isKeyword = groupKeywords.some((keyword) => keyword.id === entry.id);
        metrics.push({
          ...row,
          entityType: isKeyword ? 'keyword' : 'target',
          entityId: entry.id,
          impressions: wImpressions,
          clicks: wClicks,
          spend: round2(spend * share),
          sales: round2(wUnits * product.price),
          orders: wOrders,
          units: wUnits,
          returns: Math.round(returns * share),
          refundedSales: round2(refunded * share),
          impressionsTopOfSearch: Math.round(wImpressions * tosShare),
          impressionsProductPage: Math.round(wImpressions * ppShare),
          impressionsRestOfSearch: Math.round(wImpressions * rosShare),
          clicksTopOfSearch: Math.round(wClicks * tosShare),
          clicksProductPage: Math.round(wClicks * ppShare),
          clicksRestOfSearch: Math.round(wClicks * rosShare),
          salesTopOfSearch: round2(wUnits * product.price * tosShare),
          salesProductPage: round2(wUnits * product.price * ppShare),
          salesRestOfSearch: round2(wUnits * product.price * rosShare),
          ordersTopOfSearch: Math.round(wOrders * tosShare),
          ordersProductPage: Math.round(wOrders * ppShare),
          ordersRestOfSearch: Math.round(wOrders * rosShare),
          cogs: round2(wUnits * product.cogs),
          fbaFees: round2(wUnits * product.fba),
        });
      }
    }
  }

  // Hourly distribution for the last 30 days, with real day-of-time shape.
  const hourlyStart = shiftDate(today, -29);
  for (const campaign of campaigns) {
    const adGroup = adGroups.find((entry) => entry.campaignId === campaign.id);
    if (adGroup === undefined) continue;
    for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
      const date = shiftDate(hourlyStart, dayOffset);
      const dayRow = metrics.find((row) => row.entityType === 'campaign' && row.entityId === campaign.id && row.date === date);
      if (dayRow === undefined) continue;
      const shape = HOUR_SHAPE.map((weight) => weight * (0.75 + random() * 0.5));
      const total = shape.reduce((sum, value) => sum + value, 0);
      for (let hour = 0; hour < 24; hour += 1) {
        const share = shape[hour] / total;
        hourly.push({
          entityType: 'campaign',
          entityId: campaign.id,
          campaignId: campaign.id,
          adGroupId: adGroup.id,
          date,
          hour,
          impressions: Math.round(dayRow.impressions * share),
          clicks: Math.round(dayRow.clicks * share),
          spend: round2(dayRow.spend * share),
          sales: round2(dayRow.sales * share),
          orders: Math.round(dayRow.orders * share),
        });
      }
    }
  }

  // Search terms: real query text with aggregation across the window.
  for (const campaign of campaigns) {
    const adGroup = adGroups.find((entry) => entry.campaignId === campaign.id);
    if (adGroup === undefined) continue;
    const theme = THEMES[campaign.asin] ?? ['product'];
    const groupKeywords = keywords.filter((keyword) => keyword.adGroupId === adGroup.id);
    for (let index = 0; index < 14; index += 1) {
      const base = theme[Math.floor(random() * theme.length)];
      const modifier = MODIFIERS[Math.floor(random() * MODIFIERS.length)];
      const text = `${base}${modifier}`.trim();
      if (text.length === 0) continue;
      const impressions = Math.round(200 + random() * 4200);
      const clicks = Math.round(impressions * (0.003 + random() * 0.012));
      const spend = round2(clicks * (0.5 + random() * 1.1));
      // A fifth of the terms convert; the rest are the waste the rules remove.
      const converts = random() < 0.32;
      const orders = converts ? Math.max(1, Math.round(clicks * (0.05 + random() * 0.18))) : 0;
      const product = products.find((entry) => entry.asin === campaign.asin);
      const sales = round2(orders * (product?.price ?? 25));
      const anchor = groupKeywords[index % Math.max(1, groupKeywords.length)];
      searchTerms.push({
        id: `${adGroup.id}ST${index}`,
        accountId,
        campaignId: campaign.id,
        adGroupId: adGroup.id,
        text,
        matchType: anchor?.matchType ?? 'broad',
        keywordId: anchor?.id ?? '',
        date: shiftDate(today, -(random() < 0.5 ? 3 : 20)),
        impressions,
        clicks,
        spend,
        sales,
        orders,
        units: orders,
      });
    }
  }

  return { campaigns, adGroups, keywords, targets, negatives, metrics, hourly, searchTerms, products, days };
}

/** Hour-of-day traffic shape for a US marketplace: quiet overnight, peaks mid-morning and evening. */
const HOUR_SHAPE = [0.35, 0.22, 0.16, 0.13, 0.12, 0.15, 0.24, 0.42, 0.62, 0.78, 0.88, 0.94, 0.96, 0.92, 0.88, 0.86, 0.84, 0.86, 0.92, 1.0, 1.05, 1.02, 0.86, 0.6];

/**
 * @param {string} accountId
 * @returns {number}
 */
function hashSeed(accountId) {
  let hash = 2166136261;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @typedef {object} SandboxData
 * @property {Array<any>} campaigns
 * @property {Array<any>} adGroups
 * @property {Array<any>} keywords
 * @property {Array<any>} targets
 * @property {Array<any>} negatives
 * @property {Array<any>} metrics
 * @property {Array<any>} hourly
 * @property {Array<any>} searchTerms
 * @property {Array<any>} products
 * @property {number} days
 */

/**
 * Sandbox provider. Mirrors the public methods the sync and apply services use.
 */
export class SandboxProvider {
  /**
   * @param {object} options
   * @param {string} options.accountId
   * @param {string} [options.marketplace]
   * @param {string} [options.seed]
   * @param {number} [options.days]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options) {
    this.accountId = options.accountId;
    this.marketplace = options.marketplace ?? 'ATVPDKIKX0DER';
    this.log = options.log ?? (() => {});
    this.dryRun = false;
    this.calls = 0;
    this.data = generate(options.accountId, { seed: options.seed === undefined ? undefined : Number(options.seed), days: options.days });
    this.mutations = [];
  }

  /** @returns {Promise<Array<{profileId: string, countryCode: string, currencyCode: string, accountName: string, timezone: string}>>} */
  async profiles() {
    const info = MARKETPLACES[this.marketplace] ?? MARKETPLACES.ATVPDKIKX0DER;
    return [{
      profileId: `sandbox-${this.accountId}`,
      countryCode: info.country,
      currencyCode: info.currency,
      accountName: 'Sandbox account',
      accountType: 'seller',
      timezone: info.timezone,
    }];
  }

  /** @returns {Promise<string>} */
  async token() {
    return 'sandbox-token';
  }

  /**
   * The sandbox models a Sponsored Products account, so every ad-type-specific
   * reader answers for SP and an empty list for SB/SD — exactly as a real
   * account without those ad products would.
   * @param {string} [adType]
   * @returns {boolean}
   */
  #serves(adType) {
    return adType === undefined || adType === 'SP';
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listCampaigns(adType) {
    this.calls += 1;
    if (!this.#serves(adType)) return [];
    return this.data.campaigns.map((campaign) => ({
      campaignId: campaign.id,
      name: campaign.name,
      targetingType: campaign.targetingType,
      state: campaign.state,
      dailyBudget: campaign.budget,
      dynamicBidding: { strategy: campaign.bidding },
      startDate: campaign.startDate,
      portfolioId: campaign.portfolioId,
      placement: {
        placementTop: campaign.placements.topOfSearch,
        placementProductPage: campaign.placements.productPage,
        placementRestOfSearch: campaign.placements.restOfSearch,
      },
    }));
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listAdGroups(adType) {
    this.calls += 1;
    if (!this.#serves(adType)) return [];
    return this.data.adGroups.map((adGroup) => ({
      adGroupId: adGroup.id,
      campaignId: adGroup.campaignId,
      name: adGroup.name,
      state: adGroup.state,
      defaultBid: adGroup.defaultBid,
    }));
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listKeywords(adType) {
    this.calls += 1;
    if (!this.#serves(adType)) return [];
    return this.data.keywords.map((keyword) => ({
      keywordId: keyword.id,
      campaignId: keyword.campaignId,
      adGroupId: keyword.adGroupId,
      keywordText: keyword.text,
      matchType: keyword.matchType,
      state: keyword.state,
      bid: keyword.bid,
      suggestedBid: keyword.suggestedBid,
    }));
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listTargets(adType) {
    this.calls += 1;
    if (!this.#serves(adType)) return [];
    return this.data.targets.map((target) => ({
      targetId: target.id,
      campaignId: target.campaignId,
      adGroupId: target.adGroupId,
      expression: target.expression,
      state: target.state,
      bid: target.bid,
      expressionType: 'MANUAL',
    }));
  }

  /**
   * Product ads: one per ad group, carrying the ASIN the ad group sells.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async listProductAds(adType) {
    if (!this.#serves(adType)) return [];
    this.calls += 1;
    return this.data.adGroups.map((adGroup) => ({
      adId: `${adGroup.id}AD1`,
      campaignId: adGroup.campaignId,
      adGroupId: adGroup.id,
      asin: adGroup.asin,
      sku: `SKU-${String(adGroup.asin).slice(-4)}`,
      state: 'ENABLED',
    }));
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listNegativeKeywords(adType) {
    this.calls += 1;
    if (!this.#serves(adType)) return [];
    return this.data.negatives.map((negative) => ({
      keywordId: negative.id,
      campaignId: negative.campaignId,
      adGroupId: negative.adGroupId,
      keywordText: negative.text,
      matchType: negative.matchType,
      state: negative.state,
    }));
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listCampaignNegativeKeywords(adType) {
    if (!this.#serves(adType)) return [];
    return [];
  }

  /**
   * Every sandbox write is recorded and applied in memory so a subsequent read
   * reflects it — which is what makes rollback verification meaningful.
   * @param {Array<Record<string, unknown>>} campaigns
   * @returns {Promise<{campaigns: {success: Array<{campaignId: string, index: number}>, error: []}>}>}
   */
  async updateCampaigns(_adType, campaigns) {
    this.calls += 1;
    const success = [];
    for (const [index, update] of campaigns.entries()) {
      const campaign = this.data.campaigns.find((entry) => entry.id === String(update.campaignId));
      if (campaign === undefined) continue;
      if (update.state !== undefined) campaign.state = String(update.state);
      if (update.dailyBudget !== undefined && typeof update.dailyBudget === 'object' && update.dailyBudget !== null) {
        campaign.budget = Number(update.dailyBudget.budget ?? campaign.budget);
      }
      if (update.placement !== undefined && typeof update.placement === 'object' && update.placement !== null) {
        campaign.placements.topOfSearch = Number(update.placement.placementTop ?? campaign.placements.topOfSearch);
        campaign.placements.productPage = Number(update.placement.placementProductPage ?? campaign.placements.productPage);
        campaign.placements.restOfSearch = Number(update.placement.placementRestOfSearch ?? campaign.placements.restOfSearch);
      }
      success.push({ campaignId: campaign.id, index });
      this.mutations.push({ at: new Date().toISOString(), resource: 'campaign', id: campaign.id, update });
    }
    return { campaigns: { success, error: [] } };
  }

  /** @returns {Promise<{campaigns: {success: Array<{campaignId: string, index: number}>, error: []}>}>} */
  async updateBudgets(budgets) {
    this.calls += 1;
    const success = [];
    for (const [index, update] of budgets.entries()) {
      const campaign = this.data.campaigns.find((entry) => entry.id === String(update.campaignId));
      if (campaign === undefined) continue;
      campaign.budget = Number(update.budget?.budget ?? update.dailyBudget ?? campaign.budget);
      success.push({ campaignId: campaign.id, index });
      this.mutations.push({ at: new Date().toISOString(), resource: 'budget', id: campaign.id, update });
    }
    return { campaigns: { success, error: [] } };
  }

  /** @returns {Promise<{adGroups: {success: Array<{adGroupId: string, index: number}>, error: []}>}>} */
  async updateAdGroups(_adType, adGroups) {
    this.calls += 1;
    const success = [];
    for (const [index, update] of adGroups.entries()) {
      const adGroup = this.data.adGroups.find((entry) => entry.id === String(update.adGroupId));
      if (adGroup === undefined) continue;
      if (update.state !== undefined) adGroup.state = String(update.state);
      if (update.defaultBid !== undefined) adGroup.defaultBid = Number(update.defaultBid);
      success.push({ adGroupId: adGroup.id, index });
      this.mutations.push({ at: new Date().toISOString(), resource: 'adGroup', id: adGroup.id, update });
    }
    return { adGroups: { success, error: [] } };
  }

  /** @returns {Promise<{keywords: {success: Array<{keywordId: string, index: number}>, error: []}>}>} */
  async updateKeywords(_adType, keywords) {
    this.calls += 1;
    const success = [];
    for (const [index, update] of keywords.entries()) {
      const keyword = this.data.keywords.find((entry) => entry.id === String(update.keywordId));
      if (keyword === undefined) continue;
      if (update.bid !== undefined) keyword.bid = Number(update.bid);
      if (update.state !== undefined) keyword.state = String(update.state);
      success.push({ keywordId: keyword.id, index });
      this.mutations.push({ at: new Date().toISOString(), resource: 'keyword', id: keyword.id, update });
    }
    return { keywords: { success, error: [] } };
  }

  /** @returns {Promise<{targets: {success: Array<{targetId: string, index: number}>, error: []}>}>} */
  async updateTargets(_adType, targets) {
    this.calls += 1;
    const success = [];
    for (const [index, update] of targets.entries()) {
      const target = this.data.targets.find((entry) => entry.id === String(update.targetId));
      if (target === undefined) continue;
      if (update.bid !== undefined) target.bid = Number(update.bid);
      if (update.state !== undefined) target.state = String(update.state);
      success.push({ targetId: target.id, index });
      this.mutations.push({ at: new Date().toISOString(), resource: 'target', id: target.id, update });
    }
    return { targets: { success, error: [] } };
  }

  /** @returns {Promise<{negativeKeywords: {success: Array<{keywordId: string, index: number}>, error: []}>}>} */
  async createNegativeKeywords(_adType, keywords) {
    this.calls += 1;
    const success = [];
    for (const [index, keyword] of keywords.entries()) {
      const id = `SBX-NK-${this.data.negatives.length + index + 1}`;
      const exists = this.data.negatives.some((entry) => entry.adGroupId === String(keyword.adGroupId)
        && entry.text.toLowerCase() === String(keyword.keywordText ?? keyword.text ?? '').toLowerCase()
        && entry.matchType === String(keyword.matchType));
      if (exists) continue;
      this.data.negatives.push({
        id,
        campaignId: String(keyword.campaignId ?? ''),
        adGroupId: String(keyword.adGroupId ?? ''),
        text: String(keyword.keywordText ?? keyword.text ?? ''),
        matchType: String(keyword.matchType ?? 'negativeExact'),
        state: 'ENABLED',
        level: 'adGroup',
      });
      success.push({ keywordId: id, index });
    }
    return { negativeKeywords: { success, error: [] } };
  }

  /** @returns {Promise<{campaignNegativeKeywords: {success: Array<{keywordId: string, index: number}>, error: []}>}>} */
  async createCampaignNegativeKeywords(keywords) {
    return { campaignNegativeKeywords: { success: keywords.map((_keyword, index) => ({ keywordId: `SBX-CNK-${index}`, index })), error: [] } };
  }

  /** @returns {Promise<{keywords: {success: Array<{keywordId: string, index: number}>, error: []}>}>} */
  async createKeywords(_adType, keywords) {
    this.calls += 1;
    const success = [];
    for (const [index, keyword] of keywords.entries()) {
      const id = `SBX-KW-${this.data.keywords.length + index + 1}`;
      this.data.keywords.push({
        id,
        campaignId: String(keyword.campaignId ?? ''),
        adGroupId: String(keyword.adGroupId ?? ''),
        text: String(keyword.keywordText ?? keyword.text ?? ''),
        matchType: String(keyword.matchType ?? 'exact'),
        state: 'ENABLED',
        bid: Number(keyword.bid ?? 0.75),
        suggestedBid: Number(keyword.bid ?? 0.75),
        quality: 0.9,
        theme: [],
      });
      success.push({ keywordId: id, index });
    }
    return { keywords: { success, error: [] } };
  }

  /** @returns {Promise<{targets: {success: Array<{targetId: string, index: number}>, error: []}>}>} */
  async createTargets(_adType, targets) {
    this.calls += 1;
    const success = [];
    for (const [index, target] of targets.entries()) {
      const id = `SBX-TG-${this.data.targets.length + index + 1}`;
      this.data.targets.push({
        id,
        campaignId: String(target.campaignId ?? ''),
        adGroupId: String(target.adGroupId ?? ''),
        expression: Array.isArray(target.expression) ? target.expression : [],
        targetType: 'ASIN',
        state: 'ENABLED',
        bid: Number(target.bid ?? 0.75),
        quality: 0.8,
        theme: [],
      });
      success.push({ targetId: id, index });
    }
    return { targets: { success, error: [] } };
  }

  /** @returns {Promise<{success: string[], error: []}>} */
  async deleteEntities(resource, _adType, ids) {
    this.calls += 1;
    const wanted = new Set(ids.map(String));
    const removed = [];
    if (resource === 'negativeKeywords') {
      this.data.negatives = this.data.negatives.filter((entry) => {
        if (!wanted.has(entry.id)) return true;
        removed.push(entry.id);
        return false;
      });
    } else if (resource === 'keywords') {
      this.data.keywords = this.data.keywords.filter((entry) => {
        if (!wanted.has(entry.id)) return true;
        removed.push(entry.id);
        return false;
      });
    } else if (resource === 'targets') {
      this.data.targets = this.data.targets.filter((entry) => {
        if (!wanted.has(entry.id)) return true;
        removed.push(entry.id);
        return false;
      });
    }
    return { success: removed, error: [] };
  }

  /** @returns {Promise<{campaignId: string, adGroupId: string, responses: unknown[]}>} */
  async createCampaignSkeleton(plan) {
    this.calls += 1;
    const campaignId = `SBX-C-${this.data.campaigns.length + 1}`;
    const adGroupId = `SBX-AG-${this.data.adGroups.length + 1}`;
    this.data.campaigns.push({
      id: campaignId,
      name: String(plan.name ?? 'Sandbox campaign'),
      adType: 'SP',
      targetingType: String(plan.targetingType ?? 'MANUAL'),
      state: String(plan.state ?? 'PAUSED'),
      budget: Number(plan.dailyBudget ?? 20),
      bidding: 'LEGACY_FOR_SALES',
      portfolioId: '',
      placements: { topOfSearch: 0, productPage: 0, restOfSearch: 0 },
      asin: String(plan.asin ?? CATALOG[0].asin),
      startDate: String(plan.startDate ?? new Date().toISOString().slice(0, 10)),
      price: 25,
      performance: { quality: 0.8, baseCpc: 0.8, baseCtr: 0.004, baseCvr: 0.09, decay: 1 },
    });
    this.data.adGroups.push({
      id: adGroupId,
      campaignId,
      name: String(plan.adGroupName ?? `${String(plan.name ?? 'Sandbox')} — AG`),
      state: String(plan.state ?? 'PAUSED'),
      defaultBid: Number(plan.defaultBid ?? 0.75),
      targetingType: String(plan.targetingType ?? 'MANUAL'),
      customGroup: '',
      asin: String(plan.asin ?? CATALOG[0].asin),
    });
    const responses = [{ campaigns: { success: [{ campaignId, index: 0 }], error: [] } }];
    if (Array.isArray(plan.keywords) && plan.keywords.length > 0) {
      responses.push(await this.createKeywords('SP', plan.keywords.map((keyword) => ({ ...keyword, campaignId, adGroupId }))));
    }
    return { campaignId, adGroupId, responses };
  }

  /**
   * The sandbox answers reporting synchronously with its generated rows, which
   * keeps the sync path identical while removing the polling wait.
   * @param {object} spec
   * @returns {Promise<{reportId: string}>}
   */
  async createReport(spec) {
    this.calls += 1;
    this.pendingReport = spec;
    return { reportId: `sandbox-report-${Date.now()}` };
  }

  /** @returns {Promise<{url: string, status: string}>} */
  async waitForReport() {
    return { url: 'sandbox://report', status: 'COMPLETED' };
  }

  /**
   * @param {string} _url
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async downloadReport(_url) {
    const spec = this.pendingReport ?? {};
    const from = spec.startDate ?? shiftDate(new Date().toISOString().slice(0, 10), -30);
    const to = spec.endDate ?? new Date().toISOString().slice(0, 10);
    if (spec.hourly === true) {
      return this.data.hourly
        .filter((row) => row.date >= from && row.date <= to)
        .map((row) => ({
          campaignId: row.campaignId,
          adGroupId: row.adGroupId,
          date: row.date,
          hour: row.hour,
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.spend,
          sales: row.sales,
          purchases: row.orders,
        }));
    }
    const groupBy = Array.isArray(spec.groupBy) ? spec.groupBy : ['campaign'];
    if (groupBy.includes('searchTerm')) {
      return this.data.searchTerms
        .filter((row) => row.date >= from && row.date <= to)
        .map((row) => ({
          campaignId: row.campaignId,
          adGroupId: row.adGroupId,
          searchTerm: row.text,
          keywordId: row.keywordId,
          matchType: row.matchType,
          date: row.date,
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.spend,
          sales: row.sales,
          purchases: row.orders,
          unitsSold: row.units,
        }));
    }
    // Amazon reports one row per requested entity level. The campaign rows carry
    // no ad-group id, so the sync can tell the levels apart exactly as it does
    // against the real report.
    return this.data.metrics
      .filter((row) => row.date >= from && row.date <= to)
      .map((row) => ({
        campaignId: row.campaignId,
        campaignName: this.data.campaigns.find((entry) => entry.id === row.campaignId)?.name ?? '',
        adGroupId: row.entityType === 'campaign' ? undefined : row.adGroupId,
        keywordId: row.entityType === 'keyword' ? row.entityId : undefined,
        targetId: row.entityType === 'target' ? row.entityId : undefined,
        date: row.date,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.spend,
        sales: row.sales,
        purchases: row.orders,
        unitsSold: row.units,
        impressionsTopOfSearch: row.impressionsTopOfSearch,
        impressionsProductPage: row.impressionsProductPage,
        impressionsRestOfSearch: row.impressionsRestOfSearch,
        clicksTopOfSearch: row.clicksTopOfSearch,
        clicksProductPage: row.clicksProductPage,
        clicksRestOfSearch: row.clicksRestOfSearch,
        salesTopOfSearch: row.salesTopOfSearch,
        salesProductPage: row.salesProductPage,
        salesRestOfSearch: row.salesRestOfSearch,
        purchasesTopOfSearch: row.ordersTopOfSearch,
        purchasesProductPage: row.ordersProductPage,
        purchasesRestOfSearch: row.ordersRestOfSearch,
        newToBrandSales: row.newToBrandSales,
        newToBrandPurchases: row.newToBrandOrders,
        organicSales: row.organicSales,
        organicOrders: row.organicOrders,
        returns: row.returns,
        refundedSales: row.refundedSales,
        sessions: row.sessions,
        pageViews: row.pageViews,
        buyBoxWins: row.buyBoxWins,
        cogs: row.cogs,
        fbaFees: row.fbaFees,
      }));
  }

  /** @returns {Array<{asin: string, sku: string, title: string, price: number, cogs: number, fbaFee: number}>} */
  products() {
    return this.data.products.map((product) => ({
      asin: product.asin,
      sku: `SKU-${product.asin.slice(-4)}`,
      title: product.title,
      price: product.price,
      cogs: product.cogs,
      fbaFee: product.fba,
    }));
  }
}

/**
 * @param {string} accountId
 * @param {{seed?: string, days?: number, log?: (message: string) => void}} [options]
 * @returns {SandboxProvider}
 */
export function createSandboxProvider(accountId, options = {}) {
  return new SandboxProvider({ accountId, ...options });
}
