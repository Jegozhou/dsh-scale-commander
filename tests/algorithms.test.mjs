import { test, assert, equal, close, summarize } from './harness.mjs';
import { optimumBid, stepToward, roundBid, evaluateRule, splitWords, optimumHours, isNegligibleRaise } from '../package/src/shared/algorithms.js';
import { evaluateProfile, validateCondition, validateProfile } from '../package/src/shared/criteria.js';
import { readMetric, sumRows, safeDiv, formatMetric } from '../package/src/shared/metrics.js';

const read = readMetric;

process.stdout.write('\nalgorithms\n');

test('optimum bid uses revenue per click when there are sales', () => {
  const result = optimumBid({ metrics: { clicks: 50, sales: 300, orders: 10 }, price: 20, targetAcos: 30 });
  close(result.bid, 1.8, 1e-9);
  equal(result.formula, 'rpc');
});

test('optimum bid falls back to price when there are no sales', () => {
  const result = optimumBid({ metrics: { clicks: 10, sales: 0 }, price: 20, targetAcos: 30 });
  close(result.bid, 0.6, 1e-9);
  equal(result.formula, 'price');
});

test('optimum bid refuses to guess without clicks', () => {
  equal(optimumBid({ metrics: { clicks: 0 }, price: 20, targetAcos: 30 }).bid, null);
});

test('stepToward caps the change at the configured percentage', () => {
  close(stepToward(2, 1.5, 2), 1.96, 1e-9);
  close(stepToward(1, 1.2, 50), 1.2, 1e-9);
});

test('roundBid clamps to Amazon bounds and four decimals', () => {
  equal(roundBid(0.0001), 0.02);
  equal(roundBid(1.2345678), 1.2346);
  equal(roundBid(9, { max: 2 }), 2);
});

test('negligible raise matches the documented rule', () => {
  assert(isNegligibleRaise({ spend: 1, price: 20, targetAcos: 30, current: 0.5, optimum: 1 }), 'should skip');
  assert(!isNegligibleRaise({ spend: 10, price: 20, targetAcos: 30, current: 0.5, optimum: 1 }), 'should not skip');
});

test('bidding evaluates a keyword against metrics', () => {
  const ctx = baseContext({
    targets: [{ id: 'k1', kind: 'keyword', name: 'spatula', campaignId: 'c1', adGroupId: 'g1', state: 'ENABLED', bid: 2 }],
    metrics: { k1: { clicks: 50, sales: 300, orders: 10, spend: 100 } },
    price: 20,
  });
  const actions = evaluateRule({ id: 'r1', kind: 'bidding', params: { targetAcos: 30, maxChangePercent: 10 } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].kind, 'bid');
  // Optimum is 1.80; a 10% step from 2.00 caps the move at 0.20, so 1.80 is reached in one run.
  close(actions[0].after, 1.8, 1e-9);
  assert(actions[0].calculation.length > 3, 'calculation steps recorded');
});

test('bidding steps a large gap by the percentage cap', () => {
  const ctx = baseContext({
    targets: [{ id: 'k1', kind: 'keyword', name: 'spatula', campaignId: 'c1', adGroupId: 'g1', state: 'ENABLED', bid: 2 }],
    metrics: { k1: { clicks: 50, sales: 120, orders: 4, spend: 100 } },
    price: 20,
  });
  const actions = evaluateRule({ id: 'r1', kind: 'bidding', params: { targetAcos: 20, maxChangePercent: 2 } }, ctx);
  equal(actions[0].kind, 'bid');
  close(actions[0].after, 1.96, 1e-9);
});

test('bidding skips a keyword already at the optimum', () => {
  const ctx = baseContext({
    targets: [{ id: 'k1', kind: 'keyword', name: 'spatula', campaignId: 'c1', adGroupId: 'g1', state: 'ENABLED', bid: 1.8 }],
    metrics: { k1: { clicks: 50, sales: 300, orders: 10, spend: 90 } },
    price: 20,
  });
  const actions = evaluateRule({ id: 'r1', kind: 'bidding', params: { targetAcos: 30, maxChangePercent: 10 } }, ctx);
  equal(actions[0].kind, 'skip');
});

test('negative negates a qualifying search term', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 20 }, { metric: 'orders', op: 'lte', value: 0 }] },
    searchTerms: [{ id: 's1', text: 'spatula toys', campaignId: 'c1', adGroupId: 'g1', metrics: { clicks: 25, spend: 30, orders: 0, impressions: 4000, sales: 0 } }],
  });
  const actions = evaluateRule({ id: 'r1', kind: 'negative', campaignId: 'c1', adGroupId: 'g1', params: { matchType: 'negativeExact' } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].kind, 'negativeKeyword');
  equal(actions[0].after.matchType, 'negativeExact');
});

test('negative respects the whitelist', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 1 }] },
    searchTerms: [{ id: 's1', text: 'spatula', campaignId: 'c1', adGroupId: 'g1', metrics: { clicks: 25, orders: 0, spend: 30, sales: 0 } }],
    whitelist: ['spatula'],
  });
  const actions = evaluateRule({ id: 'r1', kind: 'negative', campaignId: 'c1', adGroupId: 'g1', params: { matchType: 'negativeExact' } }, ctx);
  equal(actions[0].kind, 'skip');
});

test('negative word aggregates words across terms', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 20 }, { metric: 'orders', op: 'lte', value: 0 }] },
    searchTerms: [
      { id: 's1', text: 'resistance bands bike', campaignId: 'c1', adGroupId: 'g1', metrics: { clicks: 30, orders: 0, spend: 20, sales: 0 } },
      { id: 's2', text: 'bike resistance bands cheap', campaignId: 'c1', adGroupId: 'g1', metrics: { clicks: 20, orders: 0, spend: 10, sales: 0 } },
    ],
    existingNegatives: new Set(),
  });
  const actions = evaluateRule({ id: 'r1', kind: 'negativeWord', campaignId: 'c1', adGroupId: 'g1', params: { matchType: 'negativePhrase', minWordLength: 3 } }, ctx);
  const bike = actions.find((action) => action.after?.text === 'bike');
  assert(bike !== undefined, 'bike should be negated');
  equal(bike.after.matchType, 'negativePhrase');
});

test('splitWords lowercases and drops short words', () => {
  equal(splitWords('Silicone Spatula, 5 pc!', 3).join(','), 'silicone,spatula');
});

test('import creates a keyword at the configured CPC percentage', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'orders', op: 'gte', value: 3 }] },
    searchTerms: [{ id: 's1', text: 'silicone spatula', campaignId: 'c1', adGroupId: 'g1', metrics: { clicks: 40, orders: 5, sales: 120, spend: 20 } }],
  });
  const actions = evaluateRule({ id: 'r1', kind: 'import', campaignId: 'c1', adGroupId: 'g1', params: { matchType: 'exact', bidPercentOfCpc: 100 } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].kind, 'importKeyword');
  close(actions[0].after.bid, 0.5, 1e-6);
});

test('status pauses an ad group that meets the criteria', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'orders', op: 'lte', value: 0 }, { metric: 'spend', op: 'gte', value: 15 }] },
    adGroups: [{ id: 'g1', name: 'AG', campaignId: 'c1', state: 'ENABLED', defaultBid: 0.8, targetingType: 'MANUAL' }],
    metrics: { g1: { spend: 20, orders: 0, clicks: 30 } },
  });
  const actions = evaluateRule({ id: 'r1', kind: 'status', params: { target: 'adGroup', action: 'pause' } }, ctx);
  equal(actions[0].kind, 'adGroupStatus');
  equal(actions[0].after, 'PAUSED');
});

test('daily budget applies baseline, day multiplier and criteria', () => {
  const ctx = baseContext({
    campaigns: [{ id: 'c1', name: 'C', state: 'ENABLED', budget: 50, placements: {}, adType: 'SP' }],
    profiles: [{ profile: { name: 'x', conditions: [{ metric: 'spend', op: 'gte', value: 1 }] }, adjustmentPercent: 30 }],
    metrics: { c1: { spend: 10 } },
    now: new Date('2026-10-18T12:00:00Z'),
  });
  const actions = evaluateRule({ id: 'r1', kind: 'dailyBudget', params: { baseline: 20, minBudget: 1, maxBudget: null, dayOfWeekMultipliers: [1, 1, 1, 1, 1, 1, 1.5] } }, ctx);
  equal(actions.length, 1);
  close(actions[0].after, 39, 0.01);
});

test('placement moves toward the target modifier by one increment', () => {
  const ctx = baseContext({
    profile: { conditions: [{ metric: 'orders', op: 'gte', value: 1 }] },
    campaigns: [{ id: 'c1', name: 'C', state: 'ENABLED', budget: 10, placements: { topOfSearch: 100, productPage: 0, restOfSearch: 0 } }],
    metrics: { c1: { orders: 5, spend: 20, sales: 100 } },
  });
  const actions = evaluateRule({ id: 'r1', kind: 'placement', params: { placement: 'topOfSearch', targetModifier: 200, incrementPercent: 30, decrementPercent: 30 } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].after.modifier, 130);
  equal(actions[0].after.placement, 'topOfSearch');
});

test('revive raises a dead keyword with history', () => {
  const ctx = baseContext({
    targets: [{ id: 'k1', kind: 'keyword', name: 'bands', campaignId: 'c1', adGroupId: 'g1', state: 'ENABLED', bid: 0.5 }],
    metrics: { k1: { impressions: 0, clicks: 0 } },
    history: { k1: { impressions: 4000, clicks: 120, orders: 8, sales: 240 } },
    price: 30,
  });
  const actions = evaluateRule({ id: 'r1', kind: 'revive', params: { targetAcos: 30, maxChangePercent: 5 } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].kind, 'bid');
  assert(actions[0].after > 0.5, 'bid should rise');
});

test('blacklist forces listed terms as negatives and honours the whitelist', () => {
  const ctx = baseContext({});
  const actions = evaluateRule({
    id: 'r1', kind: 'blacklist', campaignId: 'c1', adGroupId: 'g1',
    params: { negativeExact: ['free', 'cheap'], negativePhrase: ['kids'], exactWhitelist: ['cheap'], phraseWhitelist: [] },
  }, ctx);
  const texts = actions.map((action) => action.after?.text).sort();
  equal(texts.join(','), 'free,kids');
});

test('dayparting builds a 24-hour plan', () => {
  const ctx = baseContext({ adGroups: [{ id: 'g1', name: 'AG', campaignId: 'c1', state: 'ENABLED', defaultBid: 0.8, targetingType: 'MANUAL' }] });
  const actions = evaluateRule({ id: 'r1', kind: 'dayparting', campaignId: 'c1', adGroupId: 'g1', params: { mode: 'schedule', startHour: 6, endHour: 21, bidModifiers: [] } }, ctx);
  equal(actions.length, 1);
  equal(actions[0].after.hours.length, 24);
  equal(actions[0].after.hours[5].enabled, false);
  equal(actions[0].after.hours[6].enabled, true);
  equal(actions[0].after.hours[20].enabled, true);
  equal(actions[0].after.hours[21].enabled, false);
});

test('optimum hours disable hours without orders', () => {
  const plan = optimumHours([
    { hour: 3, metrics: { clicks: 40, orders: 0, spend: 20, sales: 0 } },
    { hour: 10, metrics: { clicks: 40, orders: 5, spend: 20, sales: 200 } },
  ], { minOrders: 1, modifiers: [] });
  equal(plan.hours[3].enabled, false);
  equal(plan.hours[10].enabled, true);
  assert(plan.hours[10].modifier > 0, 'a better-than-average hour gets a positive modifier');
});

test('criteria conditions validate', () => {
  equal(validateCondition({ metric: 'acos', op: 'gte', value: 50 }).length, 0);
  assert(validateCondition({ metric: 'acos', op: 'between', min: 5, max: 1 }).length > 0, 'min>max rejected');
  assert(validateCondition({ metric: 'acos', op: 'nope', value: 1 }).length > 0, 'unknown operator rejected');
  equal(validateProfile({ name: 'x', conditions: [] }).length, 0);
});

test('criteria profiles use AND semantics', () => {
  const profile = { conditions: [{ metric: 'clicks', op: 'gte', value: 20 }, { metric: 'orders', op: 'lte', value: 0 }] };
  equal(evaluateProfile(profile, { clicks: 25, orders: 0 }, read).matched, true);
  equal(evaluateProfile(profile, { clicks: 25, orders: 1 }, read).matched, false);
  equal(evaluateProfile(profile, { clicks: 5, orders: 0 }, read).matched, false);
});

test('derived metrics compute from raw components', () => {
  close(read({ clicks: 50, impressions: 5000 }, 'ctr'), 1, 1e-9);
  close(read({ spend: 25, sales: 100 }, 'acos'), 25, 1e-9);
  close(read({ spend: 25, sales: 100 }, 'roas'), 4, 1e-9);
  equal(read({ spend: 10, sales: 0 }, 'roas'), 0);
  equal(read({ spend: 10, sales: 0 }, 'acos'), null);
  close(read({ sales: 100, spend: 20, cogs: 30, fbaFees: 10 }, 'profit'), 40, 1e-9);
});

test('sumRows aggregates additively and recomputes ratios', () => {
  const total = sumRows([
    { clicks: 10, impressions: 1000, spend: 10, sales: 50, orders: 2 },
    { clicks: 20, impressions: 1000, spend: 20, sales: 50, orders: 3 },
  ]);
  equal(total.clicks, 30);
  close(read(total, 'acos'), 30, 1e-9);
  close(read(total, 'cpc'), 1, 1e-9);
});

test('formatMetric renders units', () => {
  equal(formatMetric('acos', 25.5), '25.50%');
  equal(formatMetric('spend', 12.5, { currency: 'USD' }), '$12.50');
  equal(formatMetric('clicks', 1234), '1,234');
  equal(formatMetric('acos', null), '—');
});

test('safeDiv guards zero denominators', () => {
  equal(safeDiv(1, 0), null);
  equal(safeDiv(1, 2), 50);
});

function baseContext(options = {}) {
  const metrics = options.metrics ?? {};
  const history = options.history ?? {};
  const profile = options.profile ?? null;
  const whitelist = new Set(options.whitelist ?? []);
  return {
    now: options.now ?? new Date('2026-10-20T12:00:00Z'),
    timezone: 'America/Los_Angeles',
    labelOf: (key) => key,
    campaigns: options.campaigns ?? [],
    adGroups: options.adGroups ?? [],
    targets: options.targets ?? [],
    metricsOf: (id) => metrics[id] ?? {},
    historicalMetricsOf: (id) => history[id] ?? {},
    priceOf: () => options.price ?? null,
    profileOf: () => profile,
    profilesOf: () => options.profiles ?? [],
    searchTermsFor: () => options.searchTerms ?? [],
    existingKeywordSet: () => options.existingKeywords ?? new Set(),
    existingNegativeSet: () => options.existingNegatives ?? new Set(),
    isWhitelisted: (text) => whitelist.has(String(text).toLowerCase()),
    protectedWords: new Set(),
    hourlyScheduleOf: () => options.hourly ?? [],
    existingScheduleOf: () => null,
    recentlyChanged: new Set(),
  };
}

summarize('algorithms');
