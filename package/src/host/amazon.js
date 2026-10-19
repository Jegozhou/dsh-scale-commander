/**
 * Amazon Advertising API client.
 *
 * Implements the real call shapes for Login with Amazon (LWA) token exchange,
 * profile listing, Sponsored Products / Brands / Display entity reads and
 * writes, and the asynchronous reporting workflow. Every request goes through
 * `#request`, which owns retry, rate-limit handling, error normalisation and
 * the optional dry-run short circuit.
 *
 * The client is deliberately transport-thin: it validates nothing about the
 * business meaning of a payload (the rule engine does that) and it never writes
 * to the store. Callers persist what they need.
 * @module host/amazon
 */

import { API_REGIONS, MARKETPLACES } from '../shared/domain.js';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Error carrying the Amazon response so the UI can show what Amazon said.
 */
export class AmazonError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, details?: string, requestId?: string, retryable?: boolean}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'AmazonError';
    this.status = info.status ?? 0;
    this.code = info.code ?? 'amazon/error';
    this.details = info.details ?? '';
    this.requestId = info.requestId ?? '';
    this.retryable = info.retryable === true;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Real Amazon Ads client. One instance per account; the token cache is keyed by
 * client id so two accounts sharing an app do not thrash LWA.
 */
export class AmazonAdsClient {
  /**
   * @param {object} options
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {string} options.refreshToken
   * @param {string} [options.region]
   * @param {string} [options.profileId]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.dryRun]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.refreshToken = options.refreshToken;
    this.region = options.region ?? 'na';
    this.profileId = options.profileId ?? '';
    this.timeoutMs = options.timeoutMs ?? 45000;
    this.dryRun = options.dryRun === true;
    this.log = options.log ?? (() => {});
    this.baseUrl = API_REGIONS[this.region] ?? API_REGIONS.na;
    this.accessToken = '';
    this.expiresAt = 0;
    this.lastRequestId = '';
    this.calls = 0;
  }

  /**
   * Exchange the refresh token for an access token. Cached until 60 seconds
   * before expiry so a long job does not fail mid-flight.
   * @param {boolean} [force]
   * @returns {Promise<string>}
   */
  async token(force = false) {
    if (!force && this.accessToken.length > 0 && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = 'lwa/token-failed';
      try {
        const parsed = JSON.parse(text);
        code = parsed.error ?? code;
      } catch {
        /* the body was not JSON; the status is enough */
      }
      throw new AmazonError(`Login with Amazon refused the token (${response.status} ${code})`, {
        status: response.status,
        code: 'amazon/lwa',
        details: text.slice(0, 800),
      });
    }
    const parsed = JSON.parse(text);
    this.accessToken = String(parsed.access_token ?? '');
    this.expiresAt = Date.now() + Number(parsed.expires_in ?? 3600) * 1000;
    if (this.accessToken.length === 0) throw new AmazonError('Login with Amazon returned no access token', { code: 'amazon/lwa' });
    return this.accessToken;
  }

  /**
   * Send one API request with retry, throttle handling and dry-run support.
   * @param {object} request
   * @param {string} request.method
   * @param {string} request.path
   * @param {unknown} [request.body]
   * @param {Record<string, string>} [request.headers]
   * @param {Record<string, string|number>} [request.query]
   * @param {boolean} [request.raw]          Return the raw Response.
   * @param {boolean} [request.allowDryRun]  Return a synthetic success in dry-run.
   * @param {AbortSignal} [request.signal]
   * @returns {Promise<any>}
   */
  async request(request) {
    if (this.dryRun && request.allowDryRun === true && request.method !== 'GET') {
      return { dryRun: true, method: request.method, path: request.path, body: request.body ?? null, synthetic: true };
    }
    const url = new URL(request.path, this.baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, String(value));
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const token = await this.token(attempt > 1);
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': request.body === undefined ? 'application/json' : 'application/vnd.spCampaign.v3+json',
        accept: 'application/json',
        'user-agent': 'scale-commander/1.0 (DeepSeek Harness plugin)',
        ...(this.profileId.length > 0 ? { 'amazon-advertising-api-scope': this.profileId } : {}),
        ...(request.headers ?? {}),
      };
      try {
        this.calls += 1;
        const response = await fetch(url, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: request.signal ?? AbortSignal.timeout(this.timeoutMs),
        });
        this.lastRequestId = response.headers.get('x-amzn-requestid') ?? '';
        const text = await response.text();
        if (response.ok) return request.raw === true ? response : parseBody(text);
        const retryable = RETRYABLE_STATUS.has(response.status);
        const retryAfter = Number(response.headers.get('retry-after') ?? 0);
        if (retryable && attempt < MAX_ATTEMPTS) {
          const delay = retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** (attempt - 1) + Math.random() * 250;
          this.log(`amazon: ${request.method} ${request.path} answered ${response.status}; retrying in ${Math.round(delay)}ms`);
          await sleep(delay);
          continue;
        }
        throw new AmazonError(`Amazon Ads API ${request.method} ${request.path} failed (${response.status})`, {
          status: response.status,
          code: 'amazon/http',
          details: text.slice(0, 2000),
          requestId: this.lastRequestId,
          retryable,
        });
      } catch (error) {
        if (error instanceof AmazonError && !error.retryable) throw error;
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(400 * 2 ** (attempt - 1));
      }
    }
    if (lastError instanceof AmazonError) throw lastError;
    throw new AmazonError(`Amazon Ads API ${request.method} ${request.path} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`, {
      code: 'amazon/network',
      retryable: true,
    });
  }

  /**
   * List advertising profiles visible to the token.
   * @returns {Promise<Array<{profileId: string, countryCode: string, currencyCode: string, accountName: string, accountType: string, timezone: string}>>}
   */
  async profiles() {
    const body = await this.request({ method: 'GET', path: '/v2/profiles', headers: { 'content-type': 'application/json' } });
    return (Array.isArray(body) ? body : []).map((entry) => ({
      profileId: String(entry.profileId ?? ''),
      countryCode: String(entry.countryCode ?? ''),
      currencyCode: String(entry.currencyCode ?? ''),
      accountName: String(entry.accountName ?? ''),
      accountType: String(entry.accountType ?? ''),
      timezone: String(entry.timeZone ?? ''),
    }));
  }

  /**
   * Read campaigns for one ad product.
   * @param {'SP'|'SB'|'SD'} adType
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async listCampaigns(adType) {
    if (adType === 'SP') return this.#spList('/sp/campaigns/list', 'campaignIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/campaigns/list');
    return this.#sdList('/sd/campaigns/list');
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listAdGroups(adType) {
    if (adType === 'SP') return this.#spList('/sp/adGroups/list', 'adGroupIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/adGroups/list');
    return this.#sdList('/sd/adGroups/list');
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listKeywords(adType) {
    if (adType === 'SP') return this.#spList('/sp/keywords/list', 'keywordIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/keywords/list');
    return [];
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listTargets(adType) {
    if (adType === 'SP') return this.#spList('/sp/targets/list', 'targetIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/targets/list');
    return this.#sdList('/sd/targets/list');
  }

  /**
   * Product ads carry the ASIN a campaign actually sells, which is how the
   * engine finds the associated product price for bid maths.
   * @param {'SP'|'SB'|'SD'} adType
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async listProductAds(adType) {
    if (adType === 'SP') return this.#spList('/sp/productAds/list', 'productAdIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/productAds/list');
    return this.#sdList('/sd/productAds/list');
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listNegativeKeywords(adType) {
    if (adType === 'SP') return this.#spList('/sp/negativeKeywords/list', 'keywordIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/negativeKeywords/list');
    return this.#sdList('/sd/negativeKeywords/list');
  }

  /** @returns {Promise<Array<Record<string, unknown>>>} */
  async listCampaignNegativeKeywords(adType) {
    if (adType === 'SP') return this.#spList('/sp/campaignNegativeKeywords/list', 'keywordIdFilter');
    if (adType === 'SB') return this.#sbList('/sb/v4/campaignNegativeKeywords/list');
    return [];
  }

  /**
   * Paginate a Sponsored Products list endpoint.
   * @param {string} path
   * @param {string} filterKey
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async #spList(path, filterKey) {
    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    let token;
    for (let page = 0; page < 200; page += 1) {
      /** @type {Record<string, unknown>} */
      const body = { maxResults: 500, stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] } };
      if (token !== undefined) body.nextToken = token;
      const answer = await this.request({
        method: 'POST',
        path,
        body,
        headers: { 'content-type': 'application/vnd.spCampaign.v3+json' },
      });
      const list = Array.isArray(answer?.[filterKey]) ? answer[filterKey]
        : Array.isArray(answer?.campaigns) ? answer.campaigns
          : Array.isArray(answer?.adGroups) ? answer.adGroups
            : Array.isArray(answer?.keywords) ? answer.keywords
              : Array.isArray(answer?.targets) ? answer.targets
                : Array.isArray(answer?.negativeKeywords) ? answer.negativeKeywords
                  : Array.isArray(answer?.campaignNegativeKeywords) ? answer.campaignNegativeKeywords
                    : [];
      out.push(...list);
      token = answer?.nextToken;
      if (typeof token !== 'string' || token.length === 0) break;
    }
    return out;
  }

  /**
   * Paginate a Sponsored Brands v4 list endpoint.
   * @param {string} path
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async #sbList(path) {
    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    let token;
    for (let page = 0; page < 200; page += 1) {
      /** @type {Record<string, unknown>} */
      const body = { maxResults: 100 };
      if (token !== undefined) body.nextToken = token;
      const answer = await this.request({ method: 'POST', path, body });
      const list = Array.isArray(answer?.campaigns) ? answer.campaigns
        : Array.isArray(answer?.adGroups) ? answer.adGroups
          : Array.isArray(answer?.keywords) ? answer.keywords
            : Array.isArray(answer?.targets) ? answer.targets
              : Array.isArray(answer?.negativeKeywords) ? answer.negativeKeywords
                : Array.isArray(answer?.campaignNegativeKeywords) ? answer.campaignNegativeKeywords
                  : Array.isArray(answer) ? answer : [];
      out.push(...list);
      token = answer?.nextToken;
      if (typeof token !== 'string' || token.length === 0) break;
    }
    return out;
  }

  /**
   * Paginate a Sponsored Display list endpoint.
   * @param {string} path
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async #sdList(path) {
    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    let startIndex = 0;
    for (let page = 0; page < 200; page += 1) {
      const answer = await this.request({
        method: 'POST',
        path,
        body: { startIndex, count: 100, stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] } },
      });
      const list = Array.isArray(answer?.campaigns) ? answer.campaigns
        : Array.isArray(answer?.adGroups) ? answer.adGroups
          : Array.isArray(answer?.targets) ? answer.targets
            : Array.isArray(answer?.negativeKeywords) ? answer.negativeKeywords
              : Array.isArray(answer) ? answer : [];
      out.push(...list);
      if (list.length < 100) break;
      startIndex += list.length;
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Writes
   * ---------------------------------------------------------------- */

  /**
   * Update campaign state, budget and placement modifiers.
   * @param {'SP'|'SB'|'SD'} adType
   * @param {Array<Record<string, unknown>>} campaigns
   * @returns {Promise<unknown>}
   */
  async updateCampaigns(adType, campaigns) {
    if (adType === 'SP') {
      return this.request({
        method: 'PUT',
        path: '/sp/campaigns',
        body: { campaigns },
        headers: { 'content-type': 'application/vnd.spCampaign.v3+json' },
        allowDryRun: true,
      });
    }
    if (adType === 'SB') return this.request({ method: 'PUT', path: '/sb/v4/campaigns', body: { campaigns }, allowDryRun: true });
    return this.request({ method: 'PUT', path: '/sd/campaigns', body: { campaigns }, allowDryRun: true });
  }

  /**
   * Update campaign budgets through the dedicated budget endpoint, which is the
   * only one Amazon accepts for a pure budget change on Sponsored Products.
   * @param {Array<Record<string, unknown>>} budgets
   * @returns {Promise<unknown>}
   */
  async updateBudgets(budgets) {
    return this.request({
      method: 'PUT',
      path: '/sp/campaigns/budget',
      body: { campaigns: budgets },
      headers: { 'content-type': 'application/vnd.spCampaign.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * @param {'SP'|'SB'|'SD'} adType
   * @param {Array<Record<string, unknown>>} adGroups
   * @returns {Promise<unknown>}
   */
  async updateAdGroups(adType, adGroups) {
    if (adType === 'SP') {
      return this.request({
        method: 'PUT',
        path: '/sp/adGroups',
        body: { adGroups },
        headers: { 'content-type': 'application/vnd.spAdGroup.v3+json' },
        allowDryRun: true,
      });
    }
    if (adType === 'SB') return this.request({ method: 'PUT', path: '/sb/v4/adGroups', body: { adGroups }, allowDryRun: true });
    return this.request({ method: 'PUT', path: '/sd/adGroups', body: { adGroups }, allowDryRun: true });
  }

  /**
   * @param {'SP'|'SB'} adType
   * @param {Array<Record<string, unknown>>} keywords
   * @returns {Promise<unknown>}
   */
  async updateKeywords(adType, keywords) {
    if (adType === 'SB') return this.request({ method: 'PUT', path: '/sb/v4/keywords', body: { keywords }, allowDryRun: true });
    return this.request({
      method: 'PUT',
      path: '/sp/keywords',
      body: { keywords },
      headers: { 'content-type': 'application/vnd.spKeyword.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * @param {'SP'|'SB'|'SD'} adType
   * @param {Array<Record<string, unknown>>} targets
   * @returns {Promise<unknown>}
   */
  async updateTargets(adType, targets) {
    if (adType === 'SB') return this.request({ method: 'PUT', path: '/sb/v4/targets', body: { targets }, allowDryRun: true });
    if (adType === 'SD') return this.request({ method: 'PUT', path: '/sd/targets', body: { targets }, allowDryRun: true });
    return this.request({
      method: 'PUT',
      path: '/sp/targets',
      body: { targets },
      headers: { 'content-type': 'application/vnd.spTargetingClause.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * Create negative keywords at ad-group level.
   * @param {'SP'|'SB'|'SD'} adType
   * @param {Array<Record<string, unknown>>} keywords
   * @returns {Promise<unknown>}
   */
  async createNegativeKeywords(adType, keywords) {
    if (adType === 'SB') return this.request({ method: 'POST', path: '/sb/v4/negativeKeywords', body: { negativeKeywords: keywords }, allowDryRun: true });
    if (adType === 'SD') return this.request({ method: 'POST', path: '/sd/negativeKeywords', body: { negativeKeywords: keywords }, allowDryRun: true });
    return this.request({
      method: 'POST',
      path: '/sp/negativeKeywords',
      body: { negativeKeywords: keywords },
      headers: { 'content-type': 'application/vnd.spNegativeKeyword.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * Create negative keywords at campaign level.
   * @param {Array<Record<string, unknown>>} keywords
   * @returns {Promise<unknown>}
   */
  async createCampaignNegativeKeywords(keywords) {
    return this.request({
      method: 'POST',
      path: '/sp/campaignNegativeKeywords',
      body: { campaignNegativeKeywords: keywords },
      headers: { 'content-type': 'application/vnd.spCampaignNegativeKeyword.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * Create keywords in an ad group.
   * @param {'SP'|'SB'} adType
   * @param {Array<Record<string, unknown>>} keywords
   * @returns {Promise<unknown>}
   */
  async createKeywords(adType, keywords) {
    if (adType === 'SB') return this.request({ method: 'POST', path: '/sb/v4/keywords', body: { keywords }, allowDryRun: true });
    return this.request({
      method: 'POST',
      path: '/sp/keywords',
      body: { keywords },
      headers: { 'content-type': 'application/vnd.spKeyword.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * Create product targets.
   * @param {'SP'|'SD'} adType
   * @param {Array<Record<string, unknown>>} targets
   * @returns {Promise<unknown>}
   */
  async createTargets(adType, targets) {
    if (adType === 'SD') return this.request({ method: 'POST', path: '/sd/targets', body: { targets }, allowDryRun: true });
    return this.request({
      method: 'POST',
      path: '/sp/targets',
      body: { targets },
      headers: { 'content-type': 'application/vnd.spTargetingClause.v3+json' },
      allowDryRun: true,
    });
  }

  /**
   * Delete entities by id. Amazon accepts a `DELETE` with an id body on the
   * list endpoints; this is what the mass builder uses to undo a create.
   * @param {string} resource  campaigns | adGroups | keywords | targets | negativeKeywords
   * @param {'SP'|'SB'|'SD'} adType
   * @param {Array<string|number>} ids
   * @returns {Promise<unknown>}
   */
  async deleteEntities(resource, adType, ids) {
    const key = resource === 'negativeKeywords' ? 'negativeKeywordIdFilter' : `${resource.replace(/s$/u, '')}IdFilter`;
    const path = adType === 'SP' ? `/sp/${resource}` : adType === 'SB' ? `/sb/v4/${resource}` : `/sd/${resource}`;
    return this.request({ method: 'DELETE', path, body: { [key]: { include: ids.map(String) } }, allowDryRun: true });
  }

  /**
   * Create a full campaign skeleton (campaign, ad group, keywords, product ad)
   * in one call set. Returns the Amazon-assigned ids when the API answers with
   * them; a dry run returns the request bodies it would have sent.
   * @param {object} plan
   * @returns {Promise<{campaignId?: string, adGroupId?: string, responses: unknown[]}>}
   */
  async createCampaignSkeleton(plan) {
    const responses = [];
    const campaignBody = {
      name: plan.name,
      campaignType: plan.campaignType ?? 'sponsoredProducts',
      targetingType: plan.targetingType ?? 'MANUAL',
      state: plan.state ?? 'PAUSED',
      dailyBudget: plan.dailyBudget,
      startDate: plan.startDate,
      ...(plan.portfolioId === undefined || plan.portfolioId === '' ? {} : { portfolioId: plan.portfolioId }),
      ...(plan.bidding === undefined ? {} : { dynamicBidding: plan.bidding }),
      ...(plan.placementTop === undefined ? {} : { placement: {
        placementTop: plan.placementTop,
        placementProductPage: plan.placementProductPage ?? 0,
        placementRestOfSearch: plan.placementRestOfSearch ?? 0,
      } }),
    };
    const campaignAnswer = await this.request({
      method: 'POST',
      path: '/sp/campaigns',
      body: { campaigns: [campaignBody] },
      headers: { 'content-type': 'application/vnd.spCampaign.v3+json' },
      allowDryRun: true,
    });
    responses.push(campaignAnswer);
    const campaignId = firstId(campaignAnswer, 'campaignId');
    const adGroupBody = {
      name: plan.adGroupName ?? `${plan.name} — AG`,
      campaignId,
      defaultBid: plan.defaultBid,
      state: plan.state ?? 'PAUSED',
    };
    const adGroupAnswer = await this.request({
      method: 'POST',
      path: '/sp/adGroups',
      body: { adGroups: [adGroupBody] },
      headers: { 'content-type': 'application/vnd.spAdGroup.v3+json' },
      allowDryRun: true,
    });
    responses.push(adGroupAnswer);
    const adGroupId = firstId(adGroupAnswer, 'adGroupId');
    if (Array.isArray(plan.keywords) && plan.keywords.length > 0) {
      const answer = await this.createKeywords('SP', plan.keywords.map((keyword) => ({
        campaignId,
        adGroupId,
        keywordText: keyword.text,
        matchType: keyword.matchType ?? 'exact',
        state: 'ENABLED',
        bid: keyword.bid,
      })));
      responses.push(answer);
    }
    if (Array.isArray(plan.productTargets) && plan.productTargets.length > 0) {
      const answer = await this.createTargets('SP', plan.productTargets.map((target) => ({
        campaignId,
        adGroupId,
        expression: target.expression,
        expressionType: 'MANUAL',
        state: 'ENABLED',
        bid: target.bid,
      })));
      responses.push(answer);
    }
    return { campaignId, adGroupId, responses };
  }

  /* ---------------------------------------------------------------- *
   * Reporting
   * ---------------------------------------------------------------- */

  /**
   * Request one report. Amazon answers 202 with a reportId; the caller polls.
   * @param {object} spec
   * @param {'sp'|'sb'|'sd'} spec.adProduct
   * @param {string} spec.reportTypeId
   * @param {string} spec.startDate
   * @param {string} spec.endDate
   * @param {Array<Record<string, unknown>>} [spec.columns]
   * @param {'GZIP_JSON'|'JSON'} [spec.format]
   * @param {string[]} [spec.groupBy]
   * @param {boolean} [spec.hourly]
   * @param {string[]} [spec.campaignIds]
   * @returns {Promise<{reportId: string}>}
   */
  async createReport(spec) {
    const body = {
      name: `scale-commander ${spec.reportTypeId} ${spec.startDate}..${spec.endDate}`,
      startDate: spec.startDate,
      endDate: spec.endDate,
      configuration: {
        adProduct: spec.adProduct.toUpperCase(),
        groupBy: spec.groupBy ?? ['campaign'],
        columns: (spec.columns ?? defaultColumns(spec)).map((column) => (typeof column === 'string' ? column : column.name)),
        reportTypeId: spec.reportTypeId,
        timeUnit: spec.hourly === true ? 'HOURLY' : 'DAILY',
        format: spec.format ?? 'GZIP_JSON',
        ...(Array.isArray(spec.campaignIds) && spec.campaignIds.length > 0 ? { filters: [{ field: 'campaignId', values: spec.campaignIds }] } : {}),
      },
    };
    const answer = await this.request({ method: 'POST', path: '/reporting/reports', body });
    if (typeof answer?.reportId !== 'string' || answer.reportId.length === 0) {
      throw new AmazonError('Amazon did not return a reportId', { code: 'amazon/report', details: JSON.stringify(answer).slice(0, 500) });
    }
    return { reportId: answer.reportId };
  }

  /**
   * Poll a report until it is ready, then return its download URL.
   * @param {string} reportId
   * @param {{intervalMs?: number, timeoutMs?: number, signal?: AbortSignal}} [options]
   * @returns {Promise<{url: string, status: string}>}
   */
  async waitForReport(reportId, options = {}) {
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 30 * 60_000;
    const started = Date.now();
    for (;;) {
      if (options.signal?.aborted === true) throw new AmazonError('report polling was cancelled', { code: 'amazon/cancelled' });
      const answer = await this.request({ method: 'GET', path: `/reporting/reports/${encodeURIComponent(reportId)}` });
      const status = String(answer?.status ?? '');
      if (status === 'COMPLETED' || status === 'SUCCESS') {
        const url = answer?.url ?? answer?.location ?? '';
        if (typeof url !== 'string' || url.length === 0) throw new AmazonError('the report completed without a download URL', { code: 'amazon/report' });
        return { url, status };
      }
      if (status === 'FAILED' || status === 'FATAL') {
        throw new AmazonError(`Amazon report ${reportId} failed: ${String(answer?.failureReason ?? status)}`, { code: 'amazon/report' });
      }
      if (Date.now() - started > timeoutMs) throw new AmazonError(`Amazon report ${reportId} did not complete within ${Math.round(timeoutMs / 1000)}s`, { code: 'amazon/report-timeout' });
      await sleep(intervalMs);
    }
  }

  /**
   * Download and parse a report body. GZIP payloads are expanded with the
   * platform's DecompressionStream, so no dependency is needed.
   * @param {string} url
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async downloadReport(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new AmazonError(`report download failed (${response.status})`, { status: response.status, code: 'amazon/report-download' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = isGzip ? await gunzipText(bytes) : new TextDecoder().decode(bytes);
    const trimmed = text.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    return trimmed.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  }
}

/**
 * Decompress a gzip payload with the Web Streams API available in Node 22+.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function gunzipText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * @param {string} text
 * @returns {any}
 */
function parseBody(text) {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * @param {unknown} answer
 * @param {string} key
 * @returns {string|undefined}
 */
function firstId(answer, key) {
  const list = answer?.campaigns ?? answer?.adGroups ?? answer?.keywords ?? answer?.targets ?? [];
  const entry = Array.isArray(list) ? list[0] : undefined;
  const id = entry?.[key] ?? entry?.id;
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * The reporting columns the plugin needs, per report type. These are the real
 * Amazon column names.
 * @param {object} spec
 * @returns {string[]}
 */
function defaultColumns(spec) {
  const base = ['campaignId', 'campaignName', 'campaignStatus', 'impressions', 'clicks', 'cost', 'sales', 'purchases', 'unitsSold'];
  if (spec.groupBy?.includes('adGroup')) base.push('adGroupId', 'adGroupName');
  if (spec.groupBy?.includes('keyword')) base.push('keywordId', 'keyword', 'matchType', 'bid');
  if (spec.groupBy?.includes('targeting')) base.push('targetingId', 'targetingExpression', 'targetingType', 'bid');
  if (spec.groupBy?.includes('searchTerm')) base.push('searchTerm', 'keywordId', 'keyword', 'matchType', 'adGroupId', 'adGroupName');
  return base;
}

/**
 * Build a client for one account record.
 * @param {{clientId: string, clientSecret: string, refreshToken: string, region?: string, profileId?: string}} credentials
 * @param {{timeoutMs?: number, dryRun?: boolean, log?: (message: string) => void}} [options]
 * @returns {AmazonAdsClient}
 */
export function createAmazonClient(credentials, options = {}) {
  return new AmazonAdsClient({ ...credentials, ...options });
}

/**
 * Resolve the marketplace metadata for a profile country.
 * @param {string} marketplaceId
 * @returns {{label: string, currency: string, timezone: string, region: string}}
 */
export function marketplaceInfo(marketplaceId) {
  return MARKETPLACES[marketplaceId] ?? MARKETPLACES.ATVPDKIKX0DER;
}
