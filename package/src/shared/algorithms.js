/**
 * The eleven automation algorithms.
 *
 * Every evaluator is a pure function: it receives already-aggregated metrics
 * plus the current Amazon state and returns proposed actions. Nothing here
 * performs I/O, so the exact same code produces the preview a person reviews
 * and the plan the Host executes — a preview cannot drift from execution.
 *
 * Each proposed action carries a `calculation` array: the step-by-step maths
 * behind it, which is what the audit trail and the UI's "review calculations"
 * panel display.
 * @module shared/algorithms
 */

import { readMetric, safeDiv } from './metrics.js';
import { evaluateProfile, describeProfile } from './criteria.js';

/** Bid arithmetic keeps four decimals, matching Amazon's own bid precision. */
export const BID_PRECISION = 4;
/** Amazon's floor for a keyword bid in every marketplace we support. */
export const MIN_BID = 0.02;

/**
 * @typedef {object} Action
 * @property {string} kind        ACTION_KINDS key.
 * @property {string} entityType  campaign | adGroup | keyword | target | searchTerm
 * @property {string} entityId
 * @property {string} entityName
 * @property {string} campaignId
 * @property {string} adGroupId
 * @property {unknown} before
 * @property {unknown} after
 * @property {string} reason
 * @property {Array<{step: string, expression?: string, value?: unknown}>} calculation
 * @property {Record<string, number>} metrics
 */

/**
 * Round a bid to Amazon precision and clamp it to the marketplace bounds.
 * @param {number} value
 * @param {{min?: number, max?: number|null}} [bounds]
 * @returns {number}
 */
export function roundBid(value, bounds = {}) {
  const min = Math.max(MIN_BID, Number(bounds.min ?? MIN_BID));
  const max = bounds.max === null || bounds.max === undefined ? Number.POSITIVE_INFINITY : Number(bounds.max);
  const clamped = Math.min(Math.max(Number(value), min), Math.max(min, max));
  const factor = 10 ** BID_PRECISION;
  return Math.round(clamped * factor) / factor;
}

/**
 * Apply a percentage step limit to a move from `current` toward `target`.
 * @param {number} current
 * @param {number} target
 * @param {number} maxChangePercent
 * @returns {number}
 */
export function stepToward(current, target, maxChangePercent) {
  const limit = Math.max(0, Math.min(100, Number(maxChangePercent) || 0)) / 100;
  if (limit === 0) return current;
  const delta = target - current;
  const cap = Math.abs(current) * limit;
  if (Math.abs(delta) <= cap) return target;
  return current + Math.sign(delta) * cap;
}

/**
 * Optimum bid formulas documented by Scale Insights.
 *  - With sales: RPC = (sales / clicks) × target ACOS.
 *  - Without sales and a known price: (price × target ACOS) / clicks.
 * @param {{metrics: Record<string, number>, price?: number|null, targetAcos: number}} input
 * @returns {{bid: number|null, formula: string, steps: Array<{step: string, expression?: string, value?: unknown}>}}
 */
export function optimumBid({ metrics, price, targetAcos }) {
  const clicks = Number(metrics.clicks ?? 0);
  const sales = Number(metrics.sales ?? 0);
  const steps = [{ step: 'Target ACOS', value: `${targetAcos}%` }];
  if (clicks <= 0) return { bid: null, formula: 'no-clicks', steps: [...steps, { step: 'No clicks in the analysis window', value: 0 }] };
  if (sales > 0) {
    const rpc = sales / clicks;
    const bid = rpc * (targetAcos / 100);
    steps.push(
      { step: 'Revenue per click', expression: 'sales ÷ clicks', value: rpc.toFixed(4) },
      { step: 'Optimum bid', expression: 'RPC × target ACOS', value: bid.toFixed(4) },
    );
    return { bid, formula: 'rpc', steps };
  }
  if (Number.isFinite(price) && Number(price) > 0) {
    const bid = (Number(price) * (targetAcos / 100)) / clicks;
    steps.push(
      { step: 'Selling price', value: Number(price).toFixed(2) },
      { step: 'Optimum bid', expression: 'price × target ACOS ÷ clicks', value: bid.toFixed(4) },
    );
    return { bid, formula: 'price', steps };
  }
  steps.push({ step: 'No sales and no known price — bid held', value: null });
  return { bid: null, formula: 'insufficient', steps };
}

/**
 * Whether a move should be skipped because it is economically pointless.
 * Documented rule: do not raise a bid when the keyword has spent less than the
 * value of one sale at target ACOS and the current bid is already below optimum.
 * @param {{spend: number, price: number|null, targetAcos: number, current: number, optimum: number}} input
 * @returns {boolean}
 */
export function isNegligibleRaise({ spend, price, targetAcos, current, optimum }) {
  if (!Number.isFinite(price) || price === null || Number(price) <= 0) return false;
  if (optimum <= current) return false;
  return Number(spend) < Number(price) * (targetAcos / 100);
}

/**
 * Build one action, defaulting the bookkeeping fields.
 * @param {Partial<Action> & {kind: string, entityId: string}} input
 * @returns {Action}
 */
function action(input) {
  return {
    entityType: 'keyword',
    entityName: '',
    campaignId: '',
    adGroupId: '',
    before: null,
    after: null,
    reason: '',
    calculation: [],
    metrics: {},
    ...input,
  };
}

/**
 * A rule's effective analysis window.
 * @param {object} rule
 * @param {{daysToAnalyze: number, daysToIgnore: number}} defaults
 * @returns {{daysToAnalyze: number, daysToIgnore: number}}
 */
export function analysisWindow(rule, defaults) {
  const params = rule.params ?? {};
  const daysToAnalyze = Number.isFinite(params.daysToAnalyze) && params.daysToAnalyze > 0 ? Number(params.daysToAnalyze) : defaults.daysToAnalyze;
  const daysToIgnore = Number.isFinite(params.daysToIgnore) && params.daysToIgnore >= 0 ? Number(params.daysToIgnore) : defaults.daysToIgnore;
  return { daysToAnalyze: Math.min(365, Math.round(daysToAnalyze)), daysToIgnore: Math.max(0, Math.round(daysToIgnore)) };
}

/* ------------------------------------------------------------------ *
 * 1. Bidding
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateBidding(rule, ctx) {
  const params = rule.params ?? {};
  const targetAcos = clampNumber(params.targetAcos, 1, 500, 30);
  const maxChange = clampNumber(params.maxChangePercent, 0, 100, 10);
  const bidCap = params.bidCap === null || params.bidCap === undefined ? null : Number(params.bidCap);
  const minBid = Number(params.minBid ?? MIN_BID);
  const maxBid = params.maxBid === null || params.maxBid === undefined ? null : Number(params.maxBid);
  const useSuggested = params.useSuggestedBid === true;
  const daysToObserve = Math.max(0, Math.round(Number(params.daysToObserve ?? 0)));
  const actions = [];
  for (const target of ctx.targets) {
    if (target.state !== 'ENABLED') continue;
    if (ctx.recentlyChanged?.has(`bid:${target.id}`) === true && daysToObserve > 0) {
      actions.push(action({
        kind: 'skip', entityType: target.kind, entityId: target.id, entityName: target.name,
        campaignId: target.campaignId, adGroupId: target.adGroupId,
        reason: `Observed within ${daysToObserve} day(s)`, calculation: [{ step: 'Days to observe', value: daysToObserve }],
      }));
      continue;
    }
    const metrics = ctx.metricsOf(target.id) ?? {};
    const price = ctx.priceOf(target.adGroupId);
    const optimum = optimumBid({ metrics, price, targetAcos });
    const calculation = [...optimum.steps];
    if (optimum.bid === null) {
      actions.push(action({
        kind: 'skip', entityType: target.kind, entityId: target.id, entityName: target.name,
        campaignId: target.campaignId, adGroupId: target.adGroupId, metrics,
        reason: 'Insufficient data to compute an optimum bid', calculation,
      }));
      continue;
    }
    if (isNegligibleRaise({ spend: metrics.spend ?? 0, price, targetAcos, current: target.bid, optimum: optimum.bid })) {
      actions.push(action({
        kind: 'skip', entityType: target.kind, entityId: target.id, entityName: target.name,
        campaignId: target.campaignId, adGroupId: target.adGroupId, metrics,
        reason: 'Spend is below the value of one sale at target ACOS — bid held',
        calculation: [
          ...calculation,
          { step: 'Spend', value: (metrics.spend ?? 0).toFixed(2) },
          { step: 'One sale at target ACOS', value: (Number(price) * (targetAcos / 100)).toFixed(2) },
        ],
      }));
      continue;
    }
    let proposed = optimum.bid;
    if (useSuggested && Number.isFinite(target.suggestedBid) && Number(target.suggestedBid) > 0) {
      proposed = Math.min(proposed, Number(target.suggestedBid));
      calculation.push({ step: 'Capped at Amazon suggested bid', value: Number(target.suggestedBid).toFixed(4) });
    }
    const stepped = stepToward(target.bid, proposed, maxChange);
    calculation.push(
      { step: 'Current bid', value: Number(target.bid).toFixed(4) },
      { step: 'Optimum bid', value: proposed.toFixed(4) },
      { step: `Max change per run`, value: `${maxChange}%` },
      { step: 'Next bid', expression: 'current + capped step', value: stepped.toFixed(4) },
    );
    const bounded = roundBid(stepped, { min: Math.max(MIN_BID, minBid), max: bidCap ?? maxBid });
    if (bidCap !== null && Number.isFinite(bidCap)) calculation.push({ step: 'Bid cap', value: bidCap.toFixed(2) });
    calculation.push({ step: 'Final bid after bounds', value: bounded.toFixed(4) });
    if (Math.abs(bounded - target.bid) < 1e-6) {
      actions.push(action({
        kind: 'skip', entityType: target.kind, entityId: target.id, entityName: target.name,
        campaignId: target.campaignId, adGroupId: target.adGroupId, metrics,
        reason: 'Already at the computed bid', calculation,
      }));
      continue;
    }
    actions.push(action({
      kind: target.kind === 'target' ? 'targetBid' : 'bid',
      entityType: target.kind, entityId: target.id, entityName: target.name,
      campaignId: target.campaignId, adGroupId: target.adGroupId, metrics,
      before: target.bid, after: bounded,
      reason: `Bid ${bounded > target.bid ? 'up' : 'down'} toward ${targetAcos}% ACOS`,
      calculation,
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 2. Dayparting
 * ------------------------------------------------------------------ */

/**
 * Dayparting does not mutate bids through Amazon's API in one call: the Host
 * scheduler owns the clock. This evaluator therefore returns one plan per ad
 * group describing the schedule and hourly modifiers, plus the bid actions the
 * scheduler will need when each hour begins.
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateDayparting(rule, ctx) {
  const params = rule.params ?? {};
  const days = Array.isArray(params.days) && params.days.length > 0 ? params.days.map(Number) : [1, 2, 3, 4, 5, 6, 7];
  const modifiers = Array.isArray(params.bidModifiers) ? params.bidModifiers : [];
  const actions = [];
  for (const adGroup of ctx.adGroups) {
    if (adGroup.campaignState === 'ARCHIVED') continue;
    const schedule = ctx.hourlyScheduleOf?.(adGroup.id) ?? [];
    let plan;
    if (params.mode === 'optimum') {
      plan = optimumHours(schedule, {
        minOrders: Number(params.minHourlyOrders ?? 1),
        modifiers,
      });
    } else {
      const startHour = clampInt(params.startHour, 0, 23, 0);
      const endHour = clampInt(params.endHour, 1, 24, 24);
      const hours = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        enabled: days.length === 7 && startHour === 0 && endHour === 24 ? true : (hour >= startHour && hour < endHour),
        modifier: Number(modifiers[hour] ?? 0),
      }));
      plan = { hours, reason: `Enabled ${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:00` };
    }
    actions.push(action({
      kind: 'dayparting',
      entityType: 'adGroup', entityId: adGroup.id, entityName: adGroup.name,
      campaignId: adGroup.campaignId, adGroupId: adGroup.id,
      before: ctx.existingScheduleOf?.(adGroup.id) ?? null,
      after: { hours: plan.hours, days, mode: params.mode ?? 'schedule', timezone: ctx.timezone },
      reason: plan.reason,
      calculation: plan.hours.map((hour) => ({
        step: `${String(hour.hour).padStart(2, '0')}:00`,
        expression: hour.enabled ? 'enabled' : 'paused',
        value: `${hour.modifier > 0 ? '+' : ''}${hour.modifier}%`,
      })),
      metrics: ctx.metricsOf(adGroup.id) ?? {},
    }));
  }
  return actions;
}

/**
 * Derive an hour-of-day plan from observed hourly performance: hours with at
 * least `minOrders` keep running, the rest pause, and each hour's bid modifier
 * is proportional to its ACOS advantage against the account average.
 * @param {Array<{hour: number, metrics: Record<string, number>}>} schedule
 * @param {{minOrders: number, modifiers: number[]}} options
 * @returns {{hours: Array<{hour: number, enabled: boolean, modifier: number}>, reason: string}}
 */
export function optimumHours(schedule, options) {
  const byHour = new Map(schedule.map((row) => [Number(row.hour), row.metrics ?? {}]));
  const totals = { sales: 0, spend: 0, orders: 0 };
  for (const metrics of byHour.values()) {
    totals.sales += Number(metrics.sales ?? 0);
    totals.spend += Number(metrics.spend ?? 0);
    totals.orders += Number(metrics.orders ?? 0);
  }
  const averageAcos = safeDiv(totals.spend, totals.sales);
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const metrics = byHour.get(hour) ?? {};
    const orders = Number(metrics.orders ?? 0);
    const acos = readMetric(metrics, 'acos');
    const hasData = (metrics.clicks ?? 0) > 0;
    const enabled = !hasData || orders >= options.minOrders;
    let modifier = Number(options.modifiers[hour] ?? 0);
    if (hasData && acos !== null && averageAcos !== null && averageAcos > 0) {
      const advantage = (averageAcos - acos) / averageAcos;
      modifier = Math.max(-50, Math.min(50, Math.round(advantage * 25)));
    }
    hours.push({ hour, enabled, modifier });
  }
  return { hours, reason: 'Optimum hours derived from hourly performance' };
}

/* ------------------------------------------------------------------ *
 * 3. Import
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateImport(rule, ctx) {
  const params = rule.params ?? {};
  const matchType = ['exact', 'phrase', 'broad'].includes(params.matchType) ? params.matchType : 'exact';
  const percent = clampNumber(params.bidPercentOfCpc, 10, 500, 100);
  const limit = clampInt(params.maxKeywordsPerRun, 1, 1000, 50);
  const profile = ctx.profileOf(rule);
  const actions = [];
  const existing = ctx.existingKeywordSet(rule.adGroupId ?? '');
  const source = ctx.searchTermsFor(rule, ctx);
  const candidates = [];
  for (const term of source) {
    const evaluation = evaluateProfile(profile, term.metrics, readMetric);
    if (!evaluation.matched) continue;
    if (existing.has(`${term.text.toLowerCase()}|${matchType}`)) continue;
    if (ctx.isWhitelisted?.(term.text) === true) continue;
    const avgCpc = readMetric(term.metrics, 'cpc');
    const bid = roundBid(Math.max(MIN_BID, ((avgCpc ?? 0) * percent) / 100), { min: MIN_BID, max: null });
    candidates.push({
      term,
      bid,
      calculation: [
        { step: 'Criteria', value: describeProfile(profile, ctx.labelOf) },
        ...evaluation.results.map((result) => ({
          step: ctx.labelOf(result.condition.metric),
          expression: `${result.condition.op} ${result.condition.op === 'between' ? `${result.condition.min}–${result.condition.max}` : result.condition.value}`,
          value: result.actual === null ? 'no data' : Number(result.actual).toFixed(2),
        })),
        { step: 'Average search-term CPC', value: avgCpc === null ? 'n/a' : Number(avgCpc).toFixed(4) },
        { step: 'Initial bid', expression: `CPC × ${percent}%`, value: bid.toFixed(4) },
      ],
    });
  }
  candidates.sort((a, b) => Number(b.term.metrics.orders ?? 0) - Number(a.term.metrics.orders ?? 0));
  for (const candidate of candidates.slice(0, limit)) {
    actions.push(action({
      kind: params.targeting === true ? 'importTarget' : 'importKeyword',
      entityType: 'searchTerm', entityId: candidate.term.id, entityName: candidate.term.text,
      campaignId: rule.campaignId ?? candidate.term.campaignId, adGroupId: rule.adGroupId ?? candidate.term.adGroupId,
      before: null, after: { text: candidate.term.text, matchType, bid: candidate.bid },
      reason: `Harvest "${candidate.term.text}" as ${matchType}`,
      calculation: candidate.calculation,
      metrics: candidate.term.metrics,
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 4. Negative
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateNegative(rule, ctx) {
  const params = rule.params ?? {};
  const matchType = params.matchType === 'negativePhrase' ? 'negativePhrase' : 'negativeExact';
  const profile = ctx.profileOf(rule);
  const actions = [];
  const existing = ctx.existingNegativeSet(rule.adGroupId ?? '');
  const source = ctx.searchTermsFor(rule, ctx);
  for (const term of source) {
    const key = `${term.text.toLowerCase()}|${matchType}`;
    if (existing.has(key)) continue;
    if (params.skipWhitelist !== false && ctx.isWhitelisted?.(term.text, matchType) === true) {
      actions.push(action({
        kind: 'skip', entityType: 'searchTerm', entityId: term.id, entityName: term.text,
        campaignId: term.campaignId, adGroupId: term.adGroupId, metrics: term.metrics,
        reason: 'Whitelisted — protected from negation',
        calculation: [{ step: 'Whitelist', value: matchType }],
      }));
      continue;
    }
    const evaluation = evaluateProfile(profile, term.metrics, readMetric);
    if (!evaluation.matched) continue;
    actions.push(action({
      kind: 'negativeKeyword',
      entityType: 'searchTerm', entityId: term.id, entityName: term.text,
      campaignId: rule.campaignId ?? term.campaignId, adGroupId: rule.adGroupId ?? term.adGroupId,
      before: null, after: { text: term.text, matchType },
      reason: `Negate "${term.text}" as ${matchType === 'negativeExact' ? 'negative exact' : 'negative phrase'}`,
      calculation: [
        ...evaluation.results.map((result) => ({
          step: ctx.labelOf(result.condition.metric),
          expression: `${result.condition.op} ${result.condition.op === 'between' ? `${result.condition.min}–${result.condition.max}` : result.condition.value}`,
          value: result.actual === null ? 'no data' : Number(result.actual).toFixed(2),
        })),
      ],
      metrics: term.metrics,
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 5. Negative word
 * ------------------------------------------------------------------ */

/**
 * Split a search term into the words the negative-word algorithm aggregates.
 * Title words are protected by the caller, not here.
 * @param {string} text
 * @param {number} minLength
 * @returns {string[]}
 */
export function splitWords(text, minLength = 3) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f]+/u)
    .filter((word) => word.length >= minLength);
}

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateNegativeWord(rule, ctx) {
  const params = rule.params ?? {};
  const minLength = clampInt(params.minWordLength, 2, 20, 3);
  const profile = ctx.profileOf(rule);
  const source = ctx.searchTermsFor(rule, ctx);
  /** @type {Map<string, {metrics: Record<string, number>, terms: string[]}>} */
  const words = new Map();
  for (const term of source) {
    for (const word of splitWords(term.text, minLength)) {
      if (ctx.protectedWords?.has(word) === true) continue;
      const entry = words.get(word) ?? { metrics: {}, terms: [] };
      for (const key of ['clicks', 'impressions', 'spend', 'sales', 'orders', 'units']) {
        entry.metrics[key] = Number(entry.metrics[key] ?? 0) + Number(term.metrics[key] ?? 0);
      }
      entry.terms.push(term.text);
      words.set(word, entry);
    }
  }
  const existing = ctx.existingNegativeSet(rule.adGroupId ?? '');
  const actions = [];
  for (const [word, entry] of words) {
    if (existing.has(`${word}|negativePhrase`)) continue;
    if (ctx.isWhitelisted?.(word, 'negativePhrase') === true) continue;
    const evaluation = evaluateProfile(profile, entry.metrics, readMetric);
    if (!evaluation.matched) continue;
    actions.push(action({
      kind: 'negativeKeyword',
      entityType: 'adGroup', entityId: rule.adGroupId ?? '', entityName: word,
      campaignId: rule.campaignId ?? '', adGroupId: rule.adGroupId ?? '',
      before: null, after: { text: word, matchType: 'negativePhrase' },
      reason: `Negate the word "${word}" across ${entry.terms.length} search term(s)`,
      calculation: [
        ...evaluation.results.map((result) => ({
          step: ctx.labelOf(result.condition.metric),
          expression: `${result.condition.op} ${result.condition.value}`,
          value: result.actual === null ? 'no data' : Number(result.actual).toFixed(2),
        })),
        { step: 'Contributing search terms', value: entry.terms.slice(0, 8).join(', ') },
      ],
      metrics: entry.metrics,
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 6. Blacklist / whitelist
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateBlacklist(rule, ctx) {
  const params = rule.params ?? {};
  const negativeExact = normalizeList(params.negativeExact);
  const negativePhrase = normalizeList(params.negativePhrase);
  const exactWhitelist = new Set(normalizeList(params.exactWhitelist));
  const phraseWhitelist = new Set(normalizeList(params.phraseWhitelist));
  const existing = ctx.existingNegativeSet(rule.adGroupId ?? '');
  const actions = [];
  for (const [list, matchType] of [[negativeExact, 'negativeExact'], [negativePhrase, 'negativePhrase']]) {
    for (const text of list) {
      if (matchType === 'negativeExact' && exactWhitelist.has(text)) continue;
      if (matchType === 'negativePhrase' && phraseWhitelist.has(text)) continue;
      if (existing.has(`${text}|${matchType}`)) continue;
      actions.push(action({
        kind: 'negativeKeyword',
        entityType: 'adGroup', entityId: rule.adGroupId ?? '', entityName: text,
        campaignId: rule.campaignId ?? '', adGroupId: rule.adGroupId ?? '',
        before: null, after: { text, matchType },
        reason: `Blacklisted term forced negative (${matchType === 'negativeExact' ? 'exact' : 'phrase'})`,
        calculation: [
          { step: 'Source list', value: matchType === 'negativeExact' ? 'Negative exact' : 'Negative phrase' },
          { step: 'Whitelist check', value: 'not whitelisted' },
        ],
        metrics: {},
      }));
    }
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 7. Revive
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateRevive(rule, ctx) {
  const params = rule.params ?? {};
  const targetAcos = clampNumber(params.targetAcos, 1, 500, 30);
  const maxChange = clampNumber(params.maxChangePercent, 0, 100, 5);
  const activeImpressions = Math.max(0, Number(params.activeImpressions ?? 1));
  const profile = ctx.profileOf(rule);
  const actions = [];
  for (const target of ctx.targets) {
    if (target.state === 'PAUSED' || target.state === 'ARCHIVED') continue;
    const recent = ctx.metricsOf(target.id) ?? {};
    if (Number(recent.impressions ?? 0) >= activeImpressions) continue;
    const historical = ctx.historicalMetricsOf(target.id) ?? {};
    const evaluation = evaluateProfile(profile, historical, readMetric);
    const hasHistory = Number(historical.clicks ?? 0) > 0;
    if (profile !== null && profile !== undefined && profile.conditions.length > 0 && !evaluation.matched) continue;
    if (!hasHistory && (profile === null || profile === undefined)) continue;
    const price = ctx.priceOf(target.adGroupId);
    const optimum = optimumBid({ metrics: historical, price, targetAcos });
    if (optimum.bid === null) continue;
    const stepped = stepToward(target.bid, Math.max(optimum.bid, target.bid), maxChange);
    const next = roundBid(stepped, { min: MIN_BID, max: params.bidCap ?? null });
    if (Math.abs(next - target.bid) < 1e-6) {
      actions.push(action({
        kind: 'skip', entityType: target.kind, entityId: target.id, entityName: target.name,
        campaignId: target.campaignId, adGroupId: target.adGroupId, metrics: recent,
        reason: 'Bid step rounds to the current bid — raise the step or the bid to revive',
        calculation: [{ step: 'Current bid', value: target.bid.toFixed(4) }, { step: 'Step', value: `${maxChange}%` }, { step: 'Rounded next bid', value: next.toFixed(4) }],
      }));
      continue;
    }
    actions.push(action({
      kind: target.kind === 'target' ? 'targetBid' : 'bid',
      entityType: target.kind, entityId: target.id, entityName: target.name,
      campaignId: target.campaignId, adGroupId: target.adGroupId, metrics: historical,
      before: target.bid, after: next,
      reason: `Revive a dead keyword with ${Number(historical.orders ?? 0)} historical order(s)`,
      calculation: [
        { step: 'Impressions in the recent window', value: Number(recent.impressions ?? 0) },
        { step: 'Active threshold', value: `${activeImpressions} impression(s)` },
        ...optimum.steps,
        { step: 'Gradual step', value: `${maxChange}%` },
        { step: 'Next bid', value: next.toFixed(4) },
      ],
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 8. Default bid
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateDefaultBid(rule, ctx) {
  const params = rule.params ?? {};
  const targetAcos = clampNumber(params.targetAcos, 1, 500, 30);
  const maxChange = clampNumber(params.maxChangePercent, 0, 100, 10);
  const actions = [];
  for (const adGroup of ctx.adGroups) {
    if (adGroup.targetingType !== 'AUTO' || adGroup.defaultBid === null) continue;
    const metrics = ctx.metricsOf(adGroup.id) ?? {};
    const price = ctx.priceOf(adGroup.id);
    const optimum = optimumBid({ metrics, price, targetAcos });
    if (optimum.bid === null) continue;
    const stepped = stepToward(adGroup.defaultBid, optimum.bid, maxChange);
    const next = roundBid(stepped, { min: MIN_BID, max: params.bidCap ?? null });
    if (Math.abs(next - adGroup.defaultBid) < 1e-6) continue;
    actions.push(action({
      kind: 'defaultBid', entityType: 'adGroup', entityId: adGroup.id, entityName: adGroup.name,
      campaignId: adGroup.campaignId, adGroupId: adGroup.id, metrics,
      before: adGroup.defaultBid, after: next,
      reason: `Default bid toward ${targetAcos}% ACOS`,
      calculation: [...optimum.steps, { step: 'Gradual step', value: `${maxChange}%` }, { step: 'Next default bid', value: next.toFixed(4) }],
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 9. Status
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateStatus(rule, ctx) {
  const params = rule.params ?? {};
  const target = params.target === 'campaign' ? 'campaign' : 'adGroup';
  const wanted = params.action === 'enable' ? 'ENABLED' : 'PAUSED';
  const profile = ctx.profileOf(rule);
  const actions = [];
  const entities = target === 'campaign' ? ctx.campaigns : ctx.adGroups;
  for (const entity of entities) {
    if (entity.state === wanted) continue;
    if (entity.state === 'ARCHIVED') continue;
    const metrics = ctx.metricsOf(entity.id) ?? {};
    const evaluation = evaluateProfile(profile, metrics, readMetric);
    if (!evaluation.matched) continue;
    actions.push(action({
      kind: target === 'campaign' ? 'campaignStatus' : 'adGroupStatus',
      entityType: target, entityId: entity.id, entityName: entity.name,
      campaignId: target === 'campaign' ? entity.id : entity.campaignId,
      adGroupId: target === 'adGroup' ? entity.id : '',
      before: entity.state, after: wanted, metrics,
      reason: `${wanted === 'PAUSED' ? 'Pause' : 'Enable'} — criteria met`,
      calculation: evaluation.results.map((result) => ({
        step: ctx.labelOf(result.condition.metric),
        expression: `${result.condition.op} ${result.condition.op === 'between' ? `${result.condition.min}–${result.condition.max}` : result.condition.value}`,
        value: result.actual === null ? 'no data' : Number(result.actual).toFixed(2),
      })),
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 10. Daily budget
 * ------------------------------------------------------------------ */

/**
 * Budget maths follow the documented order: baseline (or current budget),
 * day-of-week multiplier, then each matching criterion applied in sequence,
 * then min/max clamping.
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluateDailyBudget(rule, ctx) {
  const params = rule.params ?? {};
  const multipliers = Array.isArray(params.dayOfWeekMultipliers) ? params.dayOfWeekMultipliers : [1, 1, 1, 1, 1, 1, 1];
  const minBudget = Number(params.minBudget ?? 1);
  const maxBudget = params.maxBudget === null || params.maxBudget === undefined ? null : Number(params.maxBudget);
  const dow = ctx.now.getDay() === 0 ? 7 : ctx.now.getDay();
  const multiplier = Number(multipliers[dow - 1] ?? 1);
  const profiles = ctx.profilesOf(rule);
  const actions = [];
  for (const campaign of ctx.campaigns) {
    if (campaign.state === 'ARCHIVED' || campaign.budget === null) continue;
    const base = params.baseline === null || params.baseline === undefined || Number(params.baseline) <= 0 ? campaign.budget : Number(params.baseline);
    const calculation = [
      { step: 'Baseline budget', value: Number(base).toFixed(2) },
      { step: `Day-of-week multiplier (day ${dow})`, value: `${multiplier}×` },
    ];
    let value = base * multiplier;
    calculation.push({ step: 'After day-of-week', value: value.toFixed(2) });
    const metrics = ctx.metricsOf(campaign.id) ?? {};
    for (const entry of profiles) {
      const evaluation = evaluateProfile(entry.profile, metrics, readMetric);
      if (!evaluation.matched) continue;
      const pct = Number(entry.adjustmentPercent ?? 0);
      const before = value;
      value = value * (1 + pct / 100);
      calculation.push({
        step: `Criteria "${entry.profile?.name ?? 'unnamed'}"`,
        expression: `${pct > 0 ? '+' : ''}${pct}%`,
        value: `${before.toFixed(2)} → ${value.toFixed(2)}`,
      });
    }
    value = Math.min(Math.max(value, minBudget), maxBudget === null ? Number.POSITIVE_INFINITY : maxBudget);
    calculation.push({ step: 'Final budget after bounds', value: value.toFixed(2) });
    const next = Math.round(value * 100) / 100;
    if (Math.abs(next - campaign.budget) < 0.01) continue;
    actions.push(action({
      kind: 'campaignBudget', entityType: 'campaign', entityId: campaign.id, entityName: campaign.name,
      campaignId: campaign.id, adGroupId: '', metrics,
      before: campaign.budget, after: next,
      reason: `Daily budget ${next > campaign.budget ? 'raised' : 'lowered'} for day ${dow}`,
      calculation,
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * 11. Placement
 * ------------------------------------------------------------------ */

/**
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
function evaluatePlacement(rule, ctx) {
  const params = rule.params ?? {};
  const placement = ['topOfSearch', 'productPage', 'restOfSearch'].includes(params.placement) ? params.placement : 'topOfSearch';
  const targetModifier = clampNumber(params.targetModifier, 0, 900, 50);
  const increment = clampNumber(params.incrementPercent, 0, 900, 10);
  const decrement = clampNumber(params.decrementPercent, 0, 900, 10);
  const profile = ctx.profileOf(rule);
  const actions = [];
  for (const campaign of ctx.campaigns) {
    if (campaign.state === 'ARCHIVED') continue;
    const current = Number(campaign.placements?.[placement] ?? 0);
    const metrics = ctx.metricsOf(campaign.id) ?? {};
    const evaluation = evaluateProfile(profile, metrics, readMetric);
    if (!evaluation.matched) continue;
    let next = current;
    let direction = 'hold';
    if (current < targetModifier) {
      next = Math.min(targetModifier, current + increment);
      direction = 'increase';
    } else if (current > targetModifier) {
      next = Math.max(targetModifier, current - decrement);
      direction = 'decrease';
    }
    if (next === current) continue;
    actions.push(action({
      kind: 'placement', entityType: 'campaign', entityId: campaign.id, entityName: campaign.name,
      campaignId: campaign.id, adGroupId: '', metrics,
      before: { placement, modifier: current },
      after: { placement, modifier: next },
      reason: `Placement ${direction} toward ${targetModifier}%`,
      calculation: [
        ...evaluation.results.map((result) => ({
          step: ctx.labelOf(result.condition.metric),
          expression: `${result.condition.op} ${result.condition.op === 'between' ? `${result.condition.min}–${result.condition.max}` : result.condition.value}`,
          value: result.actual === null ? 'no data' : Number(result.actual).toFixed(2),
        })),
        { step: 'Current modifier', value: `${current}%` },
        { step: 'Target modifier', value: `${targetModifier}%` },
        { step: direction === 'increase' ? 'Increment' : 'Decrement', value: `${direction === 'increase' ? increment : decrement}%` },
        { step: 'Next modifier', value: `${next}%` },
      ],
    }));
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

const EVALUATORS = {
  bidding: evaluateBidding,
  dayparting: evaluateDayparting,
  import: evaluateImport,
  negative: evaluateNegative,
  negativeWord: evaluateNegativeWord,
  blacklist: evaluateBlacklist,
  revive: evaluateRevive,
  defaultBid: evaluateDefaultBid,
  status: evaluateStatus,
  dailyBudget: evaluateDailyBudget,
  placement: evaluatePlacement,
};

/**
 * Evaluate one rule and return its proposed actions.
 * @param {object} rule
 * @param {object} ctx
 * @returns {Action[]}
 */
export function evaluateRule(rule, ctx) {
  const evaluator = EVALUATORS[rule.kind];
  if (evaluator === undefined) return [];
  try {
    return evaluator(rule, ctx);
  } catch (error) {
    return [action({
      kind: 'error', entityType: 'rule', entityId: rule.id ?? '', entityName: rule.name ?? '',
      reason: `Rule evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      calculation: [],
    })];
  }
}

/**
 * A rule never acts twice on the same entity within one plan; the first action
 * for an entity wins and later duplicates become skips with a reason.
 * @param {Action[]} actions
 * @returns {Action[]}
 */
export function dedupeActions(actions) {
  const seen = new Set();
  return actions.map((entry) => {
    if (entry.kind === 'skip' || entry.kind === 'error') return entry;
    const key = `${entry.kind}:${entry.entityType}:${entry.entityId}:${JSON.stringify(entry.after)}`;
    if (seen.has(key)) return { ...entry, kind: 'skip', reason: 'Duplicate action in the same plan' };
    seen.add(key);
    return entry;
  });
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry.length > 0))];
}
