/**
 * Repository: every SQL read and write the services need, in one place.
 *
 * Rows are mapped to camelCase domain objects at this boundary so the services
 * and the browser never see a column name. Nothing here validates business
 * rules; it only keeps SQL out of the service layer.
 * @module host/repository
 */

import { parseJson, toJson, nowIso } from './store.js';

/**
 * @param {import('./store.js').Store} store
 */
export class Repository {
  constructor(store) {
    this.store = store;
  }

  /* ---------------------------------------------------------------- *
   * Accounts
   * ---------------------------------------------------------------- */

  /** @returns {Array<Record<string, unknown>>} */
  listAccounts() {
    return this.store.all('SELECT * FROM accounts ORDER BY created_at').map(mapAccount);
  }

  /** @param {string} id */
  getAccount(id) {
    const row = this.store.get('SELECT * FROM accounts WHERE id = ?', id);
    return row === undefined ? undefined : mapAccount(row);
  }

  /** @param {Record<string, any>} account */
  putAccount(account) {
    const at = nowIso();
    this.store.run(
      `INSERT INTO accounts (id, name, provider, region, marketplace, currency, timezone, client_id, profile_id, status, last_sync_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, provider = excluded.provider, region = excluded.region,
         marketplace = excluded.marketplace, currency = excluded.currency, timezone = excluded.timezone,
         client_id = excluded.client_id, profile_id = excluded.profile_id, status = excluded.status,
         last_sync_at = excluded.last_sync_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      account.id,
      account.name,
      account.provider ?? 'amazon',
      account.region ?? 'na',
      account.marketplace ?? 'ATVPDKIKX0DER',
      account.currency ?? 'USD',
      account.timezone ?? 'America/Los_Angeles',
      account.clientId ?? '',
      account.profileId ?? '',
      account.status ?? 'disconnected',
      account.lastSyncAt ?? null,
      account.lastError ?? '',
      account.createdAt ?? at,
      at,
    );
    return this.getAccount(account.id);
  }

  /** @param {string} id */
  deleteAccount(id) {
    this.store.run('DELETE FROM accounts WHERE id = ?', id);
  }

  /* ---------------------------------------------------------------- *
   * Campaign structure
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @param {{adType?: string, state?: string, search?: string}} [filter]
   * @returns {Array<Record<string, unknown>>}
   */
  listCampaigns(accountId, filter = {}) {
    const rows = this.store.all('SELECT * FROM campaigns WHERE account_id = ? ORDER BY name', accountId);
    const search = (filter.search ?? '').trim().toLowerCase();
    return rows.map(mapCampaign).filter((campaign) => {
      if (filter.adType !== undefined && filter.adType !== '' && campaign.adType !== filter.adType) return false;
      if (filter.state !== undefined && filter.state !== '' && campaign.state !== filter.state) return false;
      if (search.length > 0 && !campaign.name.toLowerCase().includes(search) && !campaign.id.includes(search)) return false;
      return true;
    });
  }

  /** @param {string} id */
  getCampaign(id) {
    const row = this.store.get('SELECT * FROM campaigns WHERE id = ?', id);
    return row === undefined ? undefined : mapCampaign(row);
  }

  /** @param {Record<string, any>} campaign */
  putCampaign(campaign) {
    this.store.run(
      `INSERT INTO campaigns (id, account_id, name, ad_type, targeting_type, state, budget, budget_type, bidding, portfolio_id, placement_top, placement_pp, placement_ros, start_date, asin, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, ad_type = excluded.ad_type, targeting_type = excluded.targeting_type,
         state = excluded.state, budget = excluded.budget, budget_type = excluded.budget_type,
         bidding = excluded.bidding, portfolio_id = excluded.portfolio_id,
         placement_top = excluded.placement_top, placement_pp = excluded.placement_pp,
         placement_ros = excluded.placement_ros, start_date = excluded.start_date,
         asin = excluded.asin, synced_at = excluded.synced_at`,
      campaign.id,
      campaign.accountId,
      campaign.name ?? '',
      campaign.adType ?? 'SP',
      campaign.targetingType ?? 'MANUAL',
      campaign.state ?? 'ENABLED',
      campaign.budget ?? null,
      campaign.budgetType ?? 'DAILY',
      campaign.bidding ?? '',
      campaign.portfolioId ?? '',
      campaign.placements?.topOfSearch ?? 0,
      campaign.placements?.productPage ?? 0,
      campaign.placements?.restOfSearch ?? 0,
      campaign.startDate ?? '',
      campaign.asin ?? '',
      nowIso(),
    );
  }

  /** @param {string} accountId */
  clearStructure(accountId) {
    this.store.run('DELETE FROM campaigns WHERE account_id = ?', accountId);
    this.store.run('DELETE FROM ad_groups WHERE account_id = ?', accountId);
    this.store.run('DELETE FROM keywords WHERE account_id = ?', accountId);
    this.store.run('DELETE FROM targets WHERE account_id = ?', accountId);
  }

  /**
   * @param {string} accountId
   * @param {{campaignId?: string, search?: string}} [filter]
   * @returns {Array<Record<string, unknown>>}
   */
  listAdGroups(accountId, filter = {}) {
    const rows = filter.campaignId === undefined
      ? this.store.all('SELECT * FROM ad_groups WHERE account_id = ? ORDER BY name', accountId)
      : this.store.all('SELECT * FROM ad_groups WHERE account_id = ? AND campaign_id = ? ORDER BY name', accountId, filter.campaignId);
    const search = (filter.search ?? '').trim().toLowerCase();
    return rows.map(mapAdGroup).filter((adGroup) => search.length === 0 || adGroup.name.toLowerCase().includes(search));
  }

  /** @param {string} id */
  getAdGroup(id) {
    const row = this.store.get('SELECT * FROM ad_groups WHERE id = ?', id);
    return row === undefined ? undefined : mapAdGroup(row);
  }

  /** @param {Record<string, any>} adGroup */
  putAdGroup(adGroup) {
    this.store.run(
      `INSERT INTO ad_groups (id, account_id, campaign_id, name, state, default_bid, targeting_type, custom_group, asin, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         campaign_id = excluded.campaign_id, name = excluded.name, state = excluded.state,
         default_bid = excluded.default_bid, targeting_type = excluded.targeting_type,
         custom_group = excluded.custom_group, asin = excluded.asin, synced_at = excluded.synced_at`,
      adGroup.id,
      adGroup.accountId,
      adGroup.campaignId,
      adGroup.name ?? '',
      adGroup.state ?? 'ENABLED',
      adGroup.defaultBid ?? null,
      adGroup.targetingType ?? 'MANUAL',
      adGroup.customGroup ?? '',
      adGroup.asin ?? '',
      nowIso(),
    );
  }

  /** @param {Record<string, any>} adGroup */
  updateAdGroupLocal(adGroup) {
    this.store.run(
      'UPDATE ad_groups SET state = COALESCE(?, state), default_bid = COALESCE(?, default_bid) WHERE id = ?',
      adGroup.state ?? null,
      adGroup.defaultBid ?? null,
      adGroup.id,
    );
  }

  /** @param {string} accountId */
  listKeywords(accountId) {
    return this.store.all('SELECT * FROM keywords WHERE account_id = ?', accountId).map(mapKeyword);
  }

  /** @param {string} id */
  getKeyword(id) {
    const row = this.store.get('SELECT * FROM keywords WHERE id = ?', id);
    return row === undefined ? undefined : mapKeyword(row);
  }

  /** @param {Record<string, any>} keyword */
  putKeyword(keyword) {
    this.store.run(
      `INSERT INTO keywords (id, account_id, campaign_id, ad_group_id, text, match_type, state, bid, suggested_bid, serving_status, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id, text = excluded.text,
         match_type = excluded.match_type, state = excluded.state, bid = excluded.bid,
         suggested_bid = excluded.suggested_bid, serving_status = excluded.serving_status, synced_at = excluded.synced_at`,
      keyword.id,
      keyword.accountId,
      keyword.campaignId,
      keyword.adGroupId,
      keyword.text ?? '',
      keyword.matchType ?? 'exact',
      keyword.state ?? 'ENABLED',
      keyword.bid ?? null,
      keyword.suggestedBid ?? null,
      keyword.servingStatus ?? '',
      keyword.createdAt ?? '',
      nowIso(),
    );
  }

  /** @param {{id: string, bid?: number|null, state?: string|null}} change */
  updateKeywordLocal(change) {
    this.store.run('UPDATE keywords SET bid = COALESCE(?, bid), state = COALESCE(?, state) WHERE id = ?', change.bid ?? null, change.state ?? null, change.id);
  }

  /** @param {string} accountId */
  listTargets(accountId) {
    return this.store.all('SELECT * FROM targets WHERE account_id = ?', accountId).map(mapTarget);
  }

  /** @param {Record<string, any>} target */
  putTarget(target) {
    this.store.run(
      `INSERT INTO targets (id, account_id, campaign_id, ad_group_id, expression, target_type, state, bid, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id, expression = excluded.expression,
         target_type = excluded.target_type, state = excluded.state, bid = excluded.bid, synced_at = excluded.synced_at`,
      target.id,
      target.accountId,
      target.campaignId,
      target.adGroupId,
      toJson(target.expression ?? []),
      target.targetType ?? 'ASIN',
      target.state ?? 'ENABLED',
      target.bid ?? null,
      nowIso(),
    );
  }

  /** @param {{id: string, bid?: number|null, state?: string|null}} change */
  updateTargetLocal(change) {
    this.store.run('UPDATE targets SET bid = COALESCE(?, bid), state = COALESCE(?, state) WHERE id = ?', change.bid ?? null, change.state ?? null, change.id);
  }

  /* ---------------------------------------------------------------- *
   * Negatives
   * ---------------------------------------------------------------- */

  /** @param {string} accountId */
  listNegatives(accountId) {
    return this.store.all('SELECT * FROM negatives WHERE account_id = ? ORDER BY created_at DESC', accountId).map(mapNegative);
  }

  /**
   * @param {Record<string, any>} negative
   * @returns {boolean} whether the row was new
   */
  putNegative(negative) {
    const existing = this.store.get(
      'SELECT id FROM negatives WHERE ad_group_id = ? AND campaign_id = ? AND text = ? AND match_type = ?',
      negative.adGroupId ?? '',
      negative.campaignId ?? '',
      negative.text,
      negative.matchType,
    );
    if (existing !== undefined) return false;
    this.store.run(
      `INSERT INTO negatives (id, account_id, campaign_id, ad_group_id, level, text, match_type, state, source, rule_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      negative.id,
      negative.accountId,
      negative.campaignId ?? '',
      negative.adGroupId ?? '',
      negative.level ?? 'adGroup',
      negative.text,
      negative.matchType,
      negative.state ?? 'ENABLED',
      negative.source ?? '',
      negative.ruleId ?? '',
      nowIso(),
    );
    return true;
  }

  /** @param {string} id */
  deleteNegative(id) {
    this.store.run('DELETE FROM negatives WHERE id = ?', id);
  }

  /** @param {string} id */
  getNegative(id) {
    const row = this.store.get('SELECT * FROM negatives WHERE id = ?', id);
    return row === undefined ? undefined : mapNegative(row);
  }

  /* ---------------------------------------------------------------- *
   * Metrics
   * ---------------------------------------------------------------- */

  /**
   * Upsert one daily metric row.
   * @param {Record<string, any>} row
   */
  putMetric(row) {
    this.store.run(
      `INSERT INTO metrics_daily (
        entity_type, entity_id, account_id, date, ad_type, impressions, clicks, spend, sales, orders, units,
        organic_sales, organic_orders, ntb_sales, ntb_orders, returns, refunded_sales,
        impressions_tos, impressions_pp, impressions_ros, clicks_tos, clicks_pp, clicks_ros,
        sales_tos, sales_pp, sales_ros, orders_tos, orders_pp, orders_ros,
        sessions, page_views, buy_box_wins, cogs, fba_fees
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, date) DO UPDATE SET
        impressions = excluded.impressions, clicks = excluded.clicks, spend = excluded.spend,
        sales = excluded.sales, orders = excluded.orders, units = excluded.units,
        organic_sales = excluded.organic_sales, organic_orders = excluded.organic_orders,
        ntb_sales = excluded.ntb_sales, ntb_orders = excluded.ntb_orders,
        returns = excluded.returns, refunded_sales = excluded.refunded_sales,
        impressions_tos = excluded.impressions_tos, impressions_pp = excluded.impressions_pp,
        impressions_ros = excluded.impressions_ros, clicks_tos = excluded.clicks_tos,
        clicks_pp = excluded.clicks_pp, clicks_ros = excluded.clicks_ros,
        sales_tos = excluded.sales_tos, sales_pp = excluded.sales_pp, sales_ros = excluded.sales_ros,
        orders_tos = excluded.orders_tos, orders_pp = excluded.orders_pp, orders_ros = excluded.orders_ros,
        sessions = excluded.sessions, page_views = excluded.page_views, buy_box_wins = excluded.buy_box_wins,
        cogs = excluded.cogs, fba_fees = excluded.fba_fees`,
      row.entityType,
      row.entityId,
      row.accountId,
      row.date,
      row.adType ?? 'SP',
      int(row.impressions),
      int(row.clicks),
      num(row.spend),
      num(row.sales),
      int(row.orders),
      int(row.units),
      num(row.organicSales),
      int(row.organicOrders),
      num(row.newToBrandSales),
      int(row.newToBrandOrders),
      int(row.returns),
      num(row.refundedSales),
      int(row.impressionsTopOfSearch),
      int(row.impressionsProductPage),
      int(row.impressionsRestOfSearch),
      int(row.clicksTopOfSearch),
      int(row.clicksProductPage),
      int(row.clicksRestOfSearch),
      num(row.salesTopOfSearch),
      num(row.salesProductPage),
      num(row.salesRestOfSearch),
      int(row.ordersTopOfSearch),
      int(row.ordersProductPage),
      int(row.ordersRestOfSearch),
      int(row.sessions),
      int(row.pageViews),
      int(row.buyBoxWins),
      num(row.cogs),
      num(row.fbaFees),
    );
  }

  /**
   * Aggregate stored metrics for one entity type over a date window.
   * @param {string} accountId
   * @param {string} entityType
   * @param {string} start
   * @param {string} end
   * @returns {Array<Record<string, number>>}
   */
  aggregateMetrics(accountId, entityType, start, end) {
    return this.store.all(
      `SELECT entity_id AS entityId,
              SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend,
              SUM(sales) AS sales, SUM(orders) AS orders, SUM(units) AS units,
              SUM(organic_sales) AS organicSales, SUM(organic_orders) AS organicOrders,
              SUM(ntb_sales) AS newToBrandSales, SUM(ntb_orders) AS newToBrandOrders,
              SUM(returns) AS returns, SUM(refunded_sales) AS refundedSales,
              SUM(impressions_tos) AS impressionsTopOfSearch, SUM(impressions_pp) AS impressionsProductPage,
              SUM(impressions_ros) AS impressionsRestOfSearch,
              SUM(clicks_tos) AS clicksTopOfSearch, SUM(clicks_pp) AS clicksProductPage,
              SUM(clicks_ros) AS clicksRestOfSearch,
              SUM(sales_tos) AS salesTopOfSearch, SUM(sales_pp) AS salesProductPage,
              SUM(sales_ros) AS salesRestOfSearch,
              SUM(orders_tos) AS ordersTopOfSearch, SUM(orders_pp) AS ordersProductPage,
              SUM(orders_ros) AS ordersRestOfSearch,
              SUM(sessions) AS sessions, SUM(page_views) AS pageViews, SUM(buy_box_wins) AS buyBoxWins,
              SUM(cogs) AS cogs, SUM(fba_fees) AS fbaFees,
              COUNT(DISTINCT date) AS dayCount
         FROM metrics_daily
        WHERE account_id = ? AND entity_type = ? AND date >= ? AND date <= ?
        GROUP BY entity_id`,
      accountId,
      entityType,
      start,
      end,
    );
  }

  /**
   * Daily series for charts.
   * @param {string} accountId
   * @param {{entityType?: string, entityId?: string, start: string, end: string, adType?: string}} query
   * @returns {Array<Record<string, unknown>>}
   */
  metricSeries(accountId, query) {
    const conditions = ['account_id = ?', 'date >= ?', 'date <= ?'];
    const params = [accountId, query.start, query.end];
    if (query.entityType !== undefined && query.entityType !== null && query.entityType !== '') {
      conditions.push('entity_type = ?');
      params.push(String(query.entityType));
    }
    if (query.entityId !== undefined && query.entityId !== null && query.entityId !== '') {
      conditions.push('entity_id = ?');
      params.push(String(query.entityId));
    }
    if (query.adType !== undefined && query.adType !== null && query.adType !== '') {
      conditions.push('ad_type = ?');
      params.push(String(query.adType));
    }
    return this.store.all(
      `SELECT date,
              SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend,
              SUM(sales) AS sales, SUM(orders) AS orders, SUM(units) AS units,
              SUM(organic_sales) AS organicSales, SUM(ntb_sales) AS newToBrandSales,
              SUM(returns) AS returns, SUM(sessions) AS sessions,
              SUM(cogs) AS cogs, SUM(fba_fees) AS fbaFees
         FROM metrics_daily WHERE ${conditions.join(' AND ')}
        GROUP BY date ORDER BY date`,
      ...params,
    );
  }

  /**
   * The latest date that has data for an account.
   * @param {string} accountId
   * @returns {string|undefined}
   */
  latestMetricDate(accountId) {
    const row = this.store.get('SELECT MAX(date) AS date FROM metrics_daily WHERE account_id = ?', accountId);
    return row?.date ?? undefined;
  }

  /** @param {string} accountId */
  clearMetrics(accountId) {
    this.store.run('DELETE FROM metrics_daily WHERE account_id = ?', accountId);
    this.store.run('DELETE FROM hourly_metrics WHERE account_id = ?', accountId);
    this.store.run('DELETE FROM search_terms WHERE account_id = ?', accountId);
  }

  /**
   * @param {Record<string, any>} row
   */
  putHourly(row) {
    this.store.run(
      `INSERT INTO hourly_metrics (entity_type, entity_id, account_id, date, hour, impressions, clicks, spend, sales, orders)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, date, hour) DO UPDATE SET
         impressions = excluded.impressions, clicks = excluded.clicks, spend = excluded.spend,
         sales = excluded.sales, orders = excluded.orders`,
      row.entityType,
      row.entityId,
      row.accountId,
      row.date,
      int(row.hour),
      int(row.impressions),
      int(row.clicks),
      num(row.spend),
      num(row.sales),
      int(row.orders),
    );
  }

  /**
   * Hourly totals per hour of day for one account or ad group.
   * @param {string} accountId
   * @param {{entityId?: string, entityType?: string, start: string, end: string}} query
   * @returns {Array<{hour: number, dayOfWeek: number, impressions: number, clicks: number, spend: number, sales: number, orders: number}>}
   */
  hourlyHeatmap(accountId, query) {
    const conditions = ['account_id = ?', 'date >= ?', 'date <= ?'];
    const params = [accountId, query.start, query.end];
    if (query.entityId !== undefined && query.entityId !== null && query.entityId !== '') {
      conditions.push('entity_id = ?');
      params.push(String(query.entityId));
    }
    if (query.entityType !== undefined && query.entityType !== null && query.entityType !== '') {
      conditions.push('entity_type = ?');
      params.push(String(query.entityType));
    }
    const rows = this.store.all(
      `SELECT hour,
              CAST(strftime('%w', date) AS INTEGER) AS dayOfWeek,
              SUM(impressions) AS impressions, SUM(clicks) AS clicks,
              SUM(spend) AS spend, SUM(sales) AS sales, SUM(orders) AS orders
         FROM hourly_metrics WHERE ${conditions.join(' AND ')}
        GROUP BY hour, dayOfWeek ORDER BY dayOfWeek, hour`,
      ...params,
    );
    return rows.map((row) => ({
      hour: Number(row.hour),
      dayOfWeek: Number(row.dayOfWeek),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spend: Number(row.spend ?? 0),
      sales: Number(row.sales ?? 0),
      orders: Number(row.orders ?? 0),
    }));
  }

  /**
   * Per-hour totals across the whole window, for the optimum-hours planner.
   * @param {string} accountId
   * @param {{entityId?: string, start: string, end: string}} query
   * @returns {Array<{hour: number, metrics: Record<string, number>}>}
   */
  hourlyByHour(accountId, query) {
    const conditions = ['account_id = ?', 'date >= ?', 'date <= ?'];
    const params = [accountId, query.start, query.end];
    if (query.entityId !== undefined && query.entityId !== null && query.entityId !== '') {
      conditions.push('entity_id = ?');
      params.push(String(query.entityId));
    }
    const rows = this.store.all(
      `SELECT hour, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
              SUM(spend) AS spend, SUM(sales) AS sales, SUM(orders) AS orders
         FROM hourly_metrics WHERE ${conditions.join(' AND ')}
        GROUP BY hour ORDER BY hour`,
      ...params,
    );
    return rows.map((row) => ({
      hour: Number(row.hour),
      metrics: {
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        spend: Number(row.spend ?? 0),
        sales: Number(row.sales ?? 0),
        orders: Number(row.orders ?? 0),
      },
    }));
  }

  /**
   * @param {Record<string, any>} row
   */
  putSearchTerm(row) {
    this.store.run(
      `INSERT INTO search_terms (id, account_id, campaign_id, ad_group_id, text, match_type, date, impressions, clicks, spend, sales, orders, units)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         impressions = excluded.impressions, clicks = excluded.clicks, spend = excluded.spend,
         sales = excluded.sales, orders = excluded.orders, units = excluded.units`,
      row.id,
      row.accountId,
      row.campaignId,
      row.adGroupId,
      row.text,
      row.matchType ?? '',
      row.date,
      int(row.impressions),
      int(row.clicks),
      num(row.spend),
      num(row.sales),
      int(row.orders),
      int(row.units),
    );
  }

  /**
   * Aggregated search terms.
   * @param {string} accountId
   * @param {{start: string, end: string, campaignId?: string, adGroupId?: string, campaignIds?: string[], adGroupIds?: string[], search?: string, limit?: number}} query
   * @returns {Array<Record<string, unknown>>}
   */
  aggregateSearchTerms(accountId, query) {
    const conditions = ['account_id = ?', 'date >= ?', 'date <= ?'];
    const params = [accountId, query.start, query.end];
    if (query.adGroupId !== undefined && query.adGroupId !== null && query.adGroupId !== '') {
      conditions.push('ad_group_id = ?');
      params.push(String(query.adGroupId));
    }
    if (query.campaignId !== undefined && query.campaignId !== null && query.campaignId !== '') {
      conditions.push('campaign_id = ?');
      params.push(String(query.campaignId));
    }
    if (Array.isArray(query.adGroupIds) && query.adGroupIds.length > 0) {
      conditions.push(`ad_group_id IN (${query.adGroupIds.map(() => '?').join(',')})`);
      params.push(...query.adGroupIds);
    }
    if (Array.isArray(query.campaignIds) && query.campaignIds.length > 0) {
      conditions.push(`campaign_id IN (${query.campaignIds.map(() => '?').join(',')})`);
      params.push(...query.campaignIds);
    }
    if (typeof query.search === 'string' && query.search.trim().length > 0) {
      conditions.push('text LIKE ?');
      params.push(`%${query.search.trim()}%`);
    }
    const limit = Math.max(1, Math.min(5000, Number(query.limit ?? 500)));
    return this.store.all(
      `SELECT text, MIN(id) AS id, MIN(campaign_id) AS campaignId, MIN(ad_group_id) AS adGroupId,
              MIN(match_type) AS matchType,
              SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend,
              SUM(sales) AS sales, SUM(orders) AS orders, SUM(units) AS units,
              COUNT(DISTINCT ad_group_id) AS adGroupCount
         FROM search_terms WHERE ${conditions.join(' AND ')}
        GROUP BY text ORDER BY SUM(spend) DESC LIMIT ${limit}`,
      ...params,
    );
  }

  /* ---------------------------------------------------------------- *
   * Products
   * ---------------------------------------------------------------- */

  /** @param {string} accountId */
  listProducts(accountId) {
    return this.store.all('SELECT * FROM products WHERE account_id = ? ORDER BY asin', accountId).map((row) => ({
      asin: String(row.asin),
      sku: String(row.sku ?? ''),
      title: String(row.title ?? ''),
      price: row.price === null ? null : Number(row.price),
      cogs: row.cogs === null ? null : Number(row.cogs),
      fbaFee: row.fba_fee === null ? null : Number(row.fba_fee),
      leadTimeDays: Number(row.lead_time_days ?? 0),
      active: Number(row.active) === 1,
      updatedAt: String(row.updated_at),
    }));
  }

  /** @param {Record<string, any>} product */
  putProduct(accountId, product) {
    this.store.run(
      `INSERT INTO products (account_id, asin, sku, title, price, cogs, fba_fee, lead_time_days, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, asin) DO UPDATE SET
         sku = excluded.sku, title = excluded.title, price = excluded.price, cogs = excluded.cogs,
         fba_fee = excluded.fba_fee, lead_time_days = excluded.lead_time_days, active = excluded.active,
         updated_at = excluded.updated_at`,
      accountId,
      product.asin,
      product.sku ?? '',
      product.title ?? '',
      product.price ?? null,
      product.cogs ?? null,
      product.fbaFee ?? null,
      int(product.leadTimeDays),
      product.active === false ? 0 : 1,
      nowIso(),
    );
  }

  /* ---------------------------------------------------------------- *
   * Criteria profiles, rules, assignments, objectives
   * ---------------------------------------------------------------- */

  /** @param {string} accountId */
  listProfiles(accountId) {
    return this.store.all('SELECT * FROM criteria_profiles WHERE account_id = ? ORDER BY name', accountId).map(mapProfile);
  }

  /** @param {string} id */
  getProfile(id) {
    const row = this.store.get('SELECT * FROM criteria_profiles WHERE id = ?', id);
    return row === undefined ? undefined : mapProfile(row);
  }

  /** @param {Record<string, any>} profile */
  putProfile(profile) {
    const at = nowIso();
    this.store.run(
      `INSERT INTO criteria_profiles (id, account_id, name, description, conditions, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description, conditions = excluded.conditions,
         enabled = excluded.enabled, updated_at = excluded.updated_at`,
      profile.id,
      profile.accountId,
      profile.name,
      profile.description ?? '',
      toJson(profile.conditions ?? []),
      profile.enabled === false ? 0 : 1,
      profile.createdAt ?? at,
      at,
    );
    return this.getProfile(profile.id);
  }

  /** @param {string} id */
  deleteProfile(id) {
    this.store.run('DELETE FROM criteria_profiles WHERE id = ?', id);
  }

  /** @param {string} accountId */
  listRules(accountId) {
    return this.store.all('SELECT * FROM rules WHERE account_id = ? ORDER BY priority, name', accountId).map(mapRule);
  }

  /** @param {string} id */
  getRule(id) {
    const row = this.store.get('SELECT * FROM rules WHERE id = ?', id);
    return row === undefined ? undefined : mapRule(row);
  }

  /** @param {Record<string, any>} rule */
  putRule(rule) {
    const at = nowIso();
    this.store.run(
      `INSERT INTO rules (id, account_id, kind, name, description, params, profile_id, profiles, priority, enabled, dry_run, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, name = excluded.name, description = excluded.description, params = excluded.params,
         profile_id = excluded.profile_id, profiles = excluded.profiles, priority = excluded.priority,
         enabled = excluded.enabled, dry_run = excluded.dry_run, updated_at = excluded.updated_at`,
      rule.id,
      rule.accountId,
      rule.kind,
      rule.name,
      rule.description ?? '',
      toJson(rule.params ?? {}),
      rule.profileId ?? '',
      toJson(rule.profiles ?? []),
      int(rule.priority ?? 100),
      rule.enabled === false ? 0 : 1,
      rule.dryRun === true ? 1 : 0,
      rule.createdAt ?? at,
      at,
    );
    return this.getRule(rule.id);
  }

  /** @param {string} id */
  deleteRule(id) {
    this.store.run('DELETE FROM rules WHERE id = ?', id);
    this.store.run('DELETE FROM assignments WHERE rule_id = ?', id);
  }

  /** @param {string} accountId */
  listAssignments(accountId) {
    return this.store.all('SELECT * FROM assignments WHERE account_id = ?', accountId).map(mapAssignment);
  }

  /** @param {Record<string, any>} assignment */
  putAssignment(assignment) {
    this.store.run(
      `INSERT INTO assignments (id, account_id, rule_id, campaign_id, ad_group_id, source, objective_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_id, campaign_id, ad_group_id) DO UPDATE SET source = excluded.source, objective_id = excluded.objective_id`,
      assignment.id,
      assignment.accountId,
      assignment.ruleId,
      assignment.campaignId,
      assignment.adGroupId ?? '',
      assignment.source ?? 'manual',
      assignment.objectiveId ?? '',
      nowIso(),
    );
  }

  /** @param {string} id */
  deleteAssignment(id) {
    this.store.run('DELETE FROM assignments WHERE id = ?', id);
  }

  /** @param {string} accountId */
  listObjectives(accountId) {
    return this.store.all('SELECT * FROM objectives WHERE account_id = ? ORDER BY name', accountId).map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      name: String(row.name),
      description: String(row.description ?? ''),
      adType: String(row.ad_type ?? 'SP'),
      targetingType: String(row.targeting_type ?? 'MANUAL'),
      ruleIds: parseJson(row.rule_ids, []),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  /** @param {Record<string, any>} objective */
  putObjective(objective) {
    const at = nowIso();
    this.store.run(
      `INSERT INTO objectives (id, account_id, name, description, ad_type, targeting_type, rule_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description, ad_type = excluded.ad_type,
         targeting_type = excluded.targeting_type, rule_ids = excluded.rule_ids, updated_at = excluded.updated_at`,
      objective.id,
      objective.accountId,
      objective.name,
      objective.description ?? '',
      objective.adType ?? 'SP',
      objective.targetingType ?? 'MANUAL',
      toJson(objective.ruleIds ?? []),
      objective.createdAt ?? at,
      at,
    );
    return this.listObjectives(objective.accountId).find((entry) => entry.id === objective.id);
  }

  /** @param {string} id */
  deleteObjective(id) {
    this.store.run('DELETE FROM objectives WHERE id = ?', id);
  }

  /* ---------------------------------------------------------------- *
   * Runs, actions, audit
   * ---------------------------------------------------------------- */

  /** @param {Record<string, any>} run */
  putRun(run) {
    this.store.run(
      `INSERT INTO runs (id, account_id, trigger, scope, status, dry_run, started_at, finished_at, planned, applied, failed, skipped, error, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, finished_at = excluded.finished_at, planned = excluded.planned,
         applied = excluded.applied, failed = excluded.failed, skipped = excluded.skipped,
         error = excluded.error, summary = excluded.summary`,
      run.id,
      run.accountId,
      run.trigger ?? 'manual',
      run.scope ?? '',
      run.status ?? 'preview',
      run.dryRun === false ? 0 : 1,
      run.startedAt ?? nowIso(),
      run.finishedAt ?? null,
      int(run.planned),
      int(run.applied),
      int(run.failed),
      int(run.skipped),
      run.error ?? '',
      toJson(run.summary ?? {}),
    );
    return this.getRun(run.id);
  }

  /** @param {string} id */
  getRun(id) {
    const row = this.store.get('SELECT * FROM runs WHERE id = ?', id);
    return row === undefined ? undefined : mapRun(row);
  }

  /**
   * @param {{accountId?: string, status?: string, limit?: number}} [filter]
   * @returns {Array<Record<string, unknown>>}
   */
  listRuns(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.accountId !== undefined && filter.accountId !== '') {
      conditions.push('account_id = ?');
      params.push(filter.accountId);
    }
    if (filter.status !== undefined && filter.status !== '') {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.max(1, Math.min(500, Number(filter.limit ?? 50)));
    return this.store.all(`SELECT * FROM runs ${where} ORDER BY started_at DESC LIMIT ${limit}`, ...params).map(mapRun);
  }

  /** @param {Record<string, any>} action */
  putRunAction(action) {
    this.store.run(
      `INSERT INTO run_actions (id, run_id, account_id, rule_id, rule_name, kind, entity_type, entity_id, entity_name,
        campaign_id, ad_group_id, before_value, after_value, reason, calculation, metrics, status, error, amazon_request, executed_at, rolled_back_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, error = excluded.error, amazon_request = excluded.amazon_request,
         executed_at = excluded.executed_at, rolled_back_at = excluded.rolled_back_at`,
      action.id,
      action.runId,
      action.accountId,
      action.ruleId ?? '',
      action.ruleName ?? '',
      action.kind,
      action.entityType ?? '',
      action.entityId ?? '',
      action.entityName ?? '',
      action.campaignId ?? '',
      action.adGroupId ?? '',
      action.before === undefined || action.before === null ? null : toJson(action.before),
      action.after === undefined || action.after === null ? null : toJson(action.after),
      action.reason ?? '',
      toJson(action.calculation ?? []),
      toJson(action.metrics ?? {}),
      action.status ?? 'planned',
      action.error ?? '',
      action.amazonRequest ?? '',
      action.executedAt ?? null,
      action.rolledBackAt ?? null,
    );
  }

  /** @param {string} runId */
  listRunActions(runId) {
    return this.store.all('SELECT * FROM run_actions WHERE run_id = ? ORDER BY rowid', runId).map(mapRunAction);
  }

  /** @param {string} id */
  getRunAction(id) {
    const row = this.store.get('SELECT * FROM run_actions WHERE id = ?', id);
    return row === undefined ? undefined : mapRunAction(row);
  }

  /**
   * Actions that actually changed Amazon, newest first.
   * @param {{accountId?: string, entityId?: string, limit?: number}} [filter]
   * @returns {Array<Record<string, unknown>>}
   */
  listAppliedActions(filter = {}) {
    const conditions = ["status = 'applied'", 'rolled_back_at IS NULL'];
    const params = [];
    if (filter.accountId !== undefined && filter.accountId !== '') {
      conditions.push('account_id = ?');
      params.push(filter.accountId);
    }
    if (filter.entityId !== undefined && filter.entityId !== '') {
      conditions.push('entity_id = ?');
      params.push(filter.entityId);
    }
    const limit = Math.max(1, Math.min(1000, Number(filter.limit ?? 200)));
    return this.store.all(
      `SELECT * FROM run_actions WHERE ${conditions.join(' AND ')} ORDER BY executed_at DESC LIMIT ${limit}`,
      ...params,
    ).map(mapRunAction);
  }

  /** @param {Record<string, any>} entry */
  audit(entry) {
    this.store.run(
      'INSERT INTO audit_log (account_id, at, actor, action, target, detail, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      entry.accountId ?? '',
      entry.at ?? nowIso(),
      entry.actor ?? 'system',
      entry.action,
      entry.target ?? '',
      toJson(entry.detail ?? {}),
      entry.requestId ?? '',
    );
  }

  /**
   * @param {{accountId?: string, action?: string, limit?: number, offset?: number}} [filter]
   * @returns {{items: Array<Record<string, unknown>>, total: number}}
   */
  listAudit(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.accountId !== undefined && filter.accountId !== '') {
      conditions.push('account_id = ?');
      params.push(filter.accountId);
    }
    if (filter.action !== undefined && filter.action !== '') {
      conditions.push('action = ?');
      params.push(filter.action);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.max(1, Math.min(500, Number(filter.limit ?? 100)));
    const offset = Math.max(0, Number(filter.offset ?? 0));
    const total = Number(this.store.get(`SELECT COUNT(*) AS count FROM audit_log ${where}`, ...params)?.count ?? 0);
    const items = this.store.all(
      `SELECT * FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      ...params,
    ).map((row) => ({
      id: Number(row.id),
      accountId: String(row.account_id ?? ''),
      at: String(row.at),
      actor: String(row.actor ?? ''),
      action: String(row.action),
      target: String(row.target ?? ''),
      detail: parseJson(row.detail, {}),
      requestId: String(row.request_id ?? ''),
    }));
    return { items, total };
  }

  /* ---------------------------------------------------------------- *
   * Schedules
   * ---------------------------------------------------------------- */

  /** @param {string} accountId */
  listSchedules(accountId) {
    return this.store.all('SELECT * FROM schedules WHERE account_id = ?', accountId).map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      adGroupId: String(row.ad_group_id),
      campaignId: String(row.campaign_id ?? ''),
      timezone: String(row.timezone),
      hours: parseJson(row.hours, []),
      mode: String(row.mode ?? 'schedule'),
      ruleId: String(row.rule_id ?? ''),
      enabled: Number(row.enabled) === 1,
      updatedAt: String(row.updated_at),
    }));
  }

  /** @param {Record<string, any>} schedule */
  putSchedule(schedule) {
    this.store.run(
      `INSERT INTO schedules (id, account_id, ad_group_id, campaign_id, timezone, hours, mode, rule_id, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, ad_group_id) DO UPDATE SET
         timezone = excluded.timezone, hours = excluded.hours, mode = excluded.mode,
         rule_id = excluded.rule_id, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      schedule.id,
      schedule.accountId,
      schedule.adGroupId,
      schedule.campaignId ?? '',
      schedule.timezone ?? 'America/Los_Angeles',
      toJson(schedule.hours ?? []),
      schedule.mode ?? 'schedule',
      schedule.ruleId ?? '',
      schedule.enabled === false ? 0 : 1,
      nowIso(),
    );
    return this.listSchedules(schedule.accountId).find((entry) => entry.adGroupId === schedule.adGroupId);
  }

  /** @param {string} id */
  deleteSchedule(id) {
    this.store.run('DELETE FROM schedules WHERE id = ?', id);
  }

  /* ---------------------------------------------------------------- *
   * Sync state and jobs
   * ---------------------------------------------------------------- */

  /** @param {string} accountId @param {string} resource */
  syncState(accountId, resource) {
    return this.store.get('SELECT * FROM sync_state WHERE account_id = ? AND resource = ?', accountId, resource);
  }

  /** @param {string} accountId @param {string} resource @param {string} cursor @param {number} rowCount */
  putSyncState(accountId, resource, cursor, rowCount) {
    this.store.run(
      `INSERT INTO sync_state (account_id, resource, cursor, synced_at, row_count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, resource) DO UPDATE SET cursor = excluded.cursor, synced_at = excluded.synced_at, row_count = excluded.row_count`,
      accountId,
      resource,
      cursor,
      nowIso(),
      int(rowCount),
    );
  }

  /** @param {Record<string, any>} job */
  putJob(job) {
    this.store.run(
      `INSERT INTO jobs (id, account_id, kind, status, payload, result, created_at, started_at, finished_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, result = excluded.result,
         started_at = excluded.started_at, finished_at = excluded.finished_at, error = excluded.error`,
      job.id,
      job.accountId ?? '',
      job.kind,
      job.status ?? 'queued',
      toJson(job.payload ?? {}),
      toJson(job.result ?? {}),
      job.createdAt ?? nowIso(),
      job.startedAt ?? null,
      job.finishedAt ?? null,
      job.error ?? '',
    );
  }

  /** @param {string} id */
  getJob(id) {
    const row = this.store.get('SELECT * FROM jobs WHERE id = ?', id);
    if (row === undefined) return undefined;
    return {
      id: String(row.id),
      accountId: String(row.account_id ?? ''),
      kind: String(row.kind),
      status: String(row.status),
      payload: parseJson(row.payload, {}),
      result: parseJson(row.result, {}),
      createdAt: String(row.created_at),
      startedAt: row.started_at === null ? null : String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
      error: String(row.error ?? ''),
    };
  }

  /** @param {number} [limit] */
  listJobs(limit = 30) {
    return this.store.all('SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?', limit).map((row) => this.getJob(String(row.id)));
  }
}

/* ------------------------------------------------------------------ *
 * Row mappers
 * ------------------------------------------------------------------ */

function mapAccount(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: String(row.provider),
    region: String(row.region),
    marketplace: String(row.marketplace),
    currency: String(row.currency),
    timezone: String(row.timezone),
    clientId: String(row.client_id ?? ''),
    profileId: String(row.profile_id ?? ''),
    status: String(row.status),
    lastSyncAt: row.last_sync_at === null ? null : String(row.last_sync_at),
    lastError: String(row.last_error ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCampaign(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    adType: String(row.ad_type),
    targetingType: String(row.targeting_type),
    state: String(row.state),
    budget: row.budget === null ? null : Number(row.budget),
    budgetType: String(row.budget_type ?? 'DAILY'),
    bidding: String(row.bidding ?? ''),
    portfolioId: String(row.portfolio_id ?? ''),
    placements: {
      topOfSearch: Number(row.placement_top ?? 0),
      productPage: Number(row.placement_pp ?? 0),
      restOfSearch: Number(row.placement_ros ?? 0),
    },
    startDate: String(row.start_date ?? ''),
    asin: String(row.asin ?? ''),
    syncedAt: String(row.synced_at),
  };
}

function mapAdGroup(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id),
    name: String(row.name),
    state: String(row.state),
    defaultBid: row.default_bid === null ? null : Number(row.default_bid),
    targetingType: String(row.targeting_type),
    customGroup: String(row.custom_group ?? ''),
    asin: String(row.asin ?? ''),
    syncedAt: String(row.synced_at),
  };
}

function mapKeyword(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id),
    adGroupId: String(row.ad_group_id),
    text: String(row.text),
    matchType: String(row.match_type),
    state: String(row.state),
    bid: row.bid === null ? null : Number(row.bid),
    suggestedBid: row.suggested_bid === null ? null : Number(row.suggested_bid),
    servingStatus: String(row.serving_status ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

function mapTarget(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id),
    adGroupId: String(row.ad_group_id),
    expression: parseJson(row.expression, []),
    targetType: String(row.target_type),
    state: String(row.state),
    bid: row.bid === null ? null : Number(row.bid),
  };
}

function mapNegative(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id ?? ''),
    adGroupId: String(row.ad_group_id ?? ''),
    level: String(row.level ?? 'adGroup'),
    text: String(row.text),
    matchType: String(row.match_type),
    state: String(row.state),
    source: String(row.source ?? ''),
    ruleId: String(row.rule_id ?? ''),
    createdAt: String(row.created_at),
  };
}

function mapProfile(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    conditions: parseJson(row.conditions, []),
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRule(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    kind: String(row.kind),
    name: String(row.name),
    description: String(row.description ?? ''),
    params: parseJson(row.params, {}),
    profileId: String(row.profile_id ?? ''),
    profiles: parseJson(row.profiles, []),
    priority: Number(row.priority ?? 100),
    enabled: Number(row.enabled) === 1,
    dryRun: Number(row.dry_run) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAssignment(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    ruleId: String(row.rule_id),
    campaignId: String(row.campaign_id),
    adGroupId: String(row.ad_group_id ?? ''),
    source: String(row.source ?? 'manual'),
    objectiveId: String(row.objective_id ?? ''),
    createdAt: String(row.created_at),
  };
}

function mapRun(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    trigger: String(row.trigger),
    scope: String(row.scope ?? ''),
    status: String(row.status),
    dryRun: Number(row.dry_run) === 1,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
    planned: Number(row.planned ?? 0),
    applied: Number(row.applied ?? 0),
    failed: Number(row.failed ?? 0),
    skipped: Number(row.skipped ?? 0),
    error: String(row.error ?? ''),
    summary: parseJson(row.summary, {}),
  };
}

function mapRunAction(row) {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    accountId: String(row.account_id),
    ruleId: String(row.rule_id ?? ''),
    ruleName: String(row.rule_name ?? ''),
    kind: String(row.kind),
    entityType: String(row.entity_type ?? ''),
    entityId: String(row.entity_id ?? ''),
    entityName: String(row.entity_name ?? ''),
    campaignId: String(row.campaign_id ?? ''),
    adGroupId: String(row.ad_group_id ?? ''),
    before: row.before_value === null ? null : parseJson(row.before_value, null),
    after: row.after_value === null ? null : parseJson(row.after_value, null),
    reason: String(row.reason ?? ''),
    calculation: parseJson(row.calculation, []),
    metrics: parseJson(row.metrics, {}),
    status: String(row.status),
    error: String(row.error ?? ''),
    amazonRequest: String(row.amazon_request ?? ''),
    executedAt: row.executed_at === null ? null : String(row.executed_at),
    rolledBackAt: row.rolled_back_at === null ? null : String(row.rolled_back_at),
  };
}

function int(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function num(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
