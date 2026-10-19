/**
 * Domain vocabulary shared by Host and browser: rule kinds, action kinds,
 * marketplaces, match types, and the preset strategic objectives.
 * @module shared/domain
 */

/** Amazon Ads ad product families. */
export const AD_TYPES = {
  SP: { label: 'Sponsored Products', short: 'SP' },
  SB: { label: 'Sponsored Brands', short: 'SB' },
  SD: { label: 'Sponsored Display', short: 'SD' },
};

/** Targeting modes. */
export const TARGETING_TYPES = {
  AUTO: { label: 'Auto' },
  MANUAL: { label: 'Manual' },
};

/** Keyword and negative match types. */
export const MATCH_TYPES = {
  exact: { label: 'Exact', negative: 'negativeExact' },
  phrase: { label: 'Phrase', negative: 'negativePhrase' },
  broad: { label: 'Broad', negative: null },
  negativeExact: { label: 'Negative exact', negative: 'negativeExact' },
  negativePhrase: { label: 'Negative phrase', negative: 'negativePhrase' },
};

/** Placement levers exposed by the Ads API. */
export const PLACEMENTS = {
  topOfSearch: { label: 'Top of search', api: 'PLACEMENT_TOP', short: 'TOS' },
  productPage: { label: 'Product pages', api: 'PLACEMENT_PRODUCT_PAGE', short: 'PP' },
  restOfSearch: { label: 'Rest of search', api: 'PLACEMENT_REST_OF_SEARCH', short: 'ROS' },
};

/**
 * Rule kind catalogue. `scope` is the level a rule is assigned to, `stackable`
 * mirrors the documented mutual-exclusion table, and `usesCriteria` says
 * whether the kind reads a Criteria Profile.
 */
export const RULE_KINDS = {
  bidding: {
    label: 'Bidding',
    description: 'Moves keyword and product-target bids toward a target ACOS, one capped step at a time.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'bid',
  },
  dayparting: {
    label: 'Dayparting',
    description: 'Turns ad groups on or off by hour and applies hourly percentage bid modifiers.',
    scope: 'adGroup',
    stackable: false,
    usesCriteria: false,
    icon: 'clock',
  },
  import: {
    label: 'Import',
    description: 'Harvests converting search terms into new keywords or product targets.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'harvest',
  },
  negative: {
    label: 'Negative',
    description: 'Negates search terms that meet the criteria, as negative exact or phrase.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'block',
  },
  negativeWord: {
    label: 'Negative word',
    description: 'Splits search terms into single words and negates the non-performing ones as phrase.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'word',
  },
  blacklist: {
    label: 'Blacklist / whitelist',
    description: 'Forces a maintained list of irrelevant terms to negatives and protects whitelisted terms.',
    scope: 'adGroup',
    stackable: false,
    usesCriteria: false,
    icon: 'shield',
  },
  revive: {
    label: 'Revive',
    description: 'Raises bids on dead keywords that used to perform, until traffic returns.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'revive',
  },
  defaultBid: {
    label: 'Default bid',
    description: 'Optimises an ad group default bid toward a target ACOS for legacy auto campaigns.',
    scope: 'adGroup',
    stackable: false,
    usesCriteria: true,
    icon: 'slider',
  },
  status: {
    label: 'Status',
    description: 'Pauses or enables campaigns and ad groups when their performance meets the criteria.',
    scope: 'adGroup',
    stackable: true,
    usesCriteria: true,
    icon: 'power',
  },
  dailyBudget: {
    label: 'Daily budget',
    description: 'Adjusts campaign budgets by day of week and by performance criteria.',
    scope: 'campaign',
    stackable: false,
    usesCriteria: true,
    icon: 'wallet',
  },
  placement: {
    label: 'Placement',
    description: 'Adjusts top-of-search, product-page, and rest-of-search modifiers toward a target.',
    scope: 'campaign',
    stackable: true,
    usesCriteria: true,
    icon: 'layers',
  },
};

/** Action kinds the engine can emit, with the entity each one mutates. */
export const ACTION_KINDS = {
  bid: { label: 'Bid change', entity: 'keyword', api: 'keyword.bid' },
  targetBid: { label: 'Target bid change', entity: 'target', api: 'target.bid' },
  defaultBid: { label: 'Default bid change', entity: 'adGroup', api: 'adGroup.defaultBid' },
  campaignStatus: { label: 'Campaign status', entity: 'campaign', api: 'campaign.state' },
  adGroupStatus: { label: 'Ad group status', entity: 'adGroup', api: 'adGroup.state' },
  keywordStatus: { label: 'Keyword status', entity: 'keyword', api: 'keyword.state' },
  negativeKeyword: { label: 'Negative keyword', entity: 'adGroup', api: 'adGroup.negative' },
  negativeTarget: { label: 'Negative target', entity: 'adGroup', api: 'adGroup.negativeTarget' },
  importKeyword: { label: 'New keyword', entity: 'adGroup', api: 'adGroup.keyword.create' },
  importTarget: { label: 'New product target', entity: 'adGroup', api: 'adGroup.target.create' },
  campaignBudget: { label: 'Campaign budget', entity: 'campaign', api: 'campaign.budget' },
  placement: { label: 'Placement modifier', entity: 'campaign', api: 'campaign.placement' },
  dayparting: { label: 'Ad schedule', entity: 'adGroup', api: 'adGroup.schedule' },
};

/** Marketplaces the Ads API exposes, with their currency and reporting time zone. */
export const MARKETPLACES = {
  ATVPDKIKX0DER: { label: 'United States', country: 'US', currency: 'USD', timezone: 'America/Los_Angeles', region: 'na' },
  A2EUQ1WTGCTBG2: { label: 'Canada', country: 'CA', currency: 'CAD', timezone: 'America/Los_Angeles', region: 'na' },
  A1AM78C64UM0Y8: { label: 'Mexico', country: 'MX', currency: 'MXN', timezone: 'America/Mexico_City', region: 'na' },
  A1F83G8C2ARO7P: { label: 'United Kingdom', country: 'GB', currency: 'GBP', timezone: 'Europe/London', region: 'eu' },
  A13V1IB3VIYZZH: { label: 'Germany', country: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', region: 'eu' },
  A1PA6795UKMFR9: { label: 'France', country: 'FR', currency: 'EUR', timezone: 'Europe/Paris', region: 'eu' },
  APJ6JRA9NG5V4: { label: 'Italy', country: 'IT', currency: 'EUR', timezone: 'Europe/Rome', region: 'eu' },
  A1RKKUPIHCS9HS: { label: 'Spain', country: 'ES', currency: 'EUR', timezone: 'Europe/Madrid', region: 'eu' },
  A1805IZSGTT6HS: { label: 'Netherlands', country: 'NL', currency: 'EUR', timezone: 'Europe/Amsterdam', region: 'eu' },
  A2NODRKZP88ZB9: { label: 'Sweden', country: 'SE', currency: 'SEK', timezone: 'Europe/Stockholm', region: 'eu' },
  A1C3SOZRARQ6R3: { label: 'Poland', country: 'PL', currency: 'PLN', timezone: 'Europe/Warsaw', region: 'eu' },
  A28R8C7NBKEWEA: { label: 'Belgium', country: 'BE', currency: 'EUR', timezone: 'Europe/Brussels', region: 'eu' },
  A1VC38T7YXB528: { label: 'Japan', country: 'JP', currency: 'JPY', timezone: 'Asia/Tokyo', region: 'fe' },
  A39IBJ37TRP1C6: { label: 'Australia', country: 'AU', currency: 'AUD', timezone: 'Australia/Sydney', region: 'fe' },
  A21TJRUUN4KGV: { label: 'India', country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', region: 'fe' },
  A19VAU5U5O7RUS: { label: 'Singapore', country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', region: 'fe' },
  A1AM78C64UM0Y9: { label: 'Brazil', country: 'BR', currency: 'BRL', timezone: 'America/Sao_Paulo', region: 'na' },
};

/** Region host names for the Ads API. */
export const API_REGIONS = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
};

/** Ads API version segments used by the client. */
export const API_VERSIONS = {
  sp: 'v3',
  sb: 'v3',
  sd: 'v3',
  reporting: 'v3',
  profiles: 'v2',
};

/**
 * Strategic objectives: named bundles of algorithms mirroring the documented
 * Scale Insights presets. Each `rules` entry is a partial rule the objective
 * expands into a full rule on assignment.
 * @type {Array<{id: string, name: string, adType: string, targetingType: string, description: string, rules: Array<Record<string, unknown>>}>}
 */
export const STRATEGIC_OBJECTIVES = [
  {
    id: 'bulk-auto',
    name: 'Bulk Auto',
    adType: 'SP',
    targetingType: 'AUTO',
    description: 'Discovery at scale across traffic tiers: aggressive negation, dayparting, and status protection.',
    rules: [
      { kind: 'dayparting', name: 'Bulk Auto hours', params: { mode: 'schedule', startHour: 6, endHour: 21, bidModifiers: [] } },
      { kind: 'negative', name: 'Bulk Auto low CTR', params: { source: 'asin', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'ctr', op: 'lte', value: 0.2 }, { metric: 'impressions', op: 'gte', value: 1000 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'negative', name: 'Bulk Auto wasted clicks', params: { source: 'asin', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 20 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'negative', name: 'Bulk Auto high ACOS', params: { source: 'asin', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'acos', op: 'gte', value: 50 }, { metric: 'orders', op: 'gte', value: 1 }] } },
      { kind: 'negativeWord', name: 'Bulk Auto negative words', params: { source: 'asin', matchType: 'negativePhrase' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 25 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'blacklist', name: 'Bulk Auto blacklist', params: { negativeExact: [], negativePhrase: [], exactWhitelist: [], phraseWhitelist: [] } },
      { kind: 'status', name: 'Pause poor ad groups', params: { target: 'adGroup', action: 'pause' }, profile: { conditions: [{ metric: 'acos', op: 'gte', value: 50 }, { metric: 'spend', op: 'gte', value: 20 }] } },
      { kind: 'status', name: 'Pause spend without orders', params: { target: 'adGroup', action: 'pause' }, profile: { conditions: [{ metric: 'orders', op: 'lte', value: 0 }, { metric: 'spend', op: 'gte', value: 15 }] } },
      { kind: 'status', name: 'Enable recovered ad groups', params: { target: 'adGroup', action: 'enable' }, profile: { conditions: [{ metric: 'acos', op: 'lte', value: 30 }, { metric: 'orders', op: 'gte', value: 1 }] } },
    ],
  },
  {
    id: 'sales-exact',
    name: 'Sales Exact',
    adType: 'SP',
    targetingType: 'MANUAL',
    description: 'Harvest winners and defend them: moderate bids, conservative negation.',
    rules: [
      { kind: 'dayparting', name: 'Sales hours', params: { mode: 'schedule', startHour: 6, endHour: 21, bidModifiers: [] } },
      { kind: 'bidding', name: 'Sales bid to 20-40% ACOS', params: { targetAcos: 30, maxChangePercent: 10, bidCap: null } },
      { kind: 'import', name: 'Harvest 5 orders', params: { source: 'asin', matchType: 'exact', bidPercentOfCpc: 100 }, profile: { conditions: [{ metric: 'orders', op: 'gte', value: 5 }, { metric: 'cvr', op: 'gte', value: 15 }] } },
      { kind: 'import', name: 'Harvest high ACOS exact', params: { source: 'campaign', matchType: 'exact', bidPercentOfCpc: 80 }, profile: { conditions: [{ metric: 'orders', op: 'gte', value: 3 }, { metric: 'acos', op: 'gte', value: 80 }] } },
      { kind: 'negative', name: 'Negate high ACOS in phrase', params: { source: 'campaign', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'orders', op: 'gte', value: 3 }, { metric: 'acos', op: 'gte', value: 80 }] } },
      { kind: 'negative', name: 'Negate low CTR', params: { source: 'campaign', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'ctr', op: 'lte', value: 0.2 }, { metric: 'impressions', op: 'gte', value: 1000 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'revive', name: 'Revive dead winners', params: { targetAcos: 30, maxChangePercent: 5 } },
    ],
  },
  {
    id: 'ranking-exact',
    name: 'Ranking Exact',
    adType: 'SP',
    targetingType: 'MANUAL',
    description: 'Ranking pressure: pushes top-of-search share while protecting margin.',
    rules: [
      { kind: 'placement', name: 'TOS push', params: { placement: 'topOfSearch', targetModifier: 60, incrementPercent: 15, decrementPercent: 15 } },
      { kind: 'bidding', name: 'Ranking bids', params: { targetAcos: 25, maxChangePercent: 12, bidCap: null } },
      { kind: 'negative', name: 'Cut waste', params: { source: 'campaign', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 20 }, { metric: 'orders', op: 'lte', value: 0 }] } },
    ],
  },
  {
    id: 'discovery-auto',
    name: 'Discovery Auto',
    adType: 'SP',
    targetingType: 'AUTO',
    description: 'Cheap discovery with fast negation and no bidding aggression.',
    rules: [
      { kind: 'bidding', name: 'Discovery bids', params: { targetAcos: 40, maxChangePercent: 5, bidCap: null } },
      { kind: 'negative', name: 'Discovery negation', params: { source: 'adGroup', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 15 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'negativeWord', name: 'Discovery word negation', params: { source: 'adGroup', matchType: 'negativePhrase' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 30 }, { metric: 'orders', op: 'lte', value: 0 }] } },
    ],
  },
  {
    id: 'product-targeting',
    name: 'Product Targeting',
    adType: 'SP',
    targetingType: 'MANUAL',
    description: 'ASIN and category targeting with conservative bids and ACOS defence.',
    rules: [
      { kind: 'bidding', name: 'PT bids', params: { targetAcos: 30, maxChangePercent: 10, bidCap: null } },
      { kind: 'negative', name: 'PT negation', params: { source: 'campaign', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 25 }, { metric: 'orders', op: 'lte', value: 0 }] } },
      { kind: 'placement', name: 'PP defence', params: { placement: 'productPage', targetModifier: 30, incrementPercent: 10, decrementPercent: 20 } },
    ],
  },
  {
    id: 'video-exact',
    name: 'Video Exact',
    adType: 'SB',
    targetingType: 'MANUAL',
    description: 'Sponsored Brands video keyword harvesting with tighter bid caps.',
    rules: [
      { kind: 'bidding', name: 'Video bids', params: { targetAcos: 35, maxChangePercent: 8, bidCap: null } },
      { kind: 'import', name: 'Video harvest', params: { source: 'sb', matchType: 'exact', bidPercentOfCpc: 90 }, profile: { conditions: [{ metric: 'orders', op: 'gte', value: 3 }, { metric: 'cvr', op: 'gte', value: 12 }] } },
      { kind: 'negative', name: 'Video negation', params: { source: 'campaign', matchType: 'negativeExact' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 30 }, { metric: 'orders', op: 'lte', value: 0 }] } },
    ],
  },
  {
    id: 'single-keyword-tos',
    name: 'Single Keyword (Exact) with TOS',
    adType: 'SP',
    targetingType: 'MANUAL',
    description: 'One keyword per ad group, top-of-search focused, with a fixed bid ceiling.',
    rules: [
      { kind: 'bidding', name: 'SK bids', params: { targetAcos: 28, maxChangePercent: 10, bidCap: 2.1 } },
      { kind: 'placement', name: 'SK TOS', params: { placement: 'topOfSearch', targetModifier: 100, incrementPercent: 20, decrementPercent: 20 } },
      { kind: 'status', name: 'SK pause', params: { target: 'adGroup', action: 'pause' }, profile: { conditions: [{ metric: 'clicks', op: 'gte', value: 25 }, { metric: 'orders', op: 'lte', value: 0 }] } },
    ],
  },
];

/**
 * Default parameters for a rule kind, used by the UI's "new rule" form and by
 * the API when a caller omits fields.
 * @param {string} kind
 * @returns {Record<string, unknown>}
 */
export function defaultParams(kind) {
  switch (kind) {
    case 'bidding':
      return { targetAcos: 30, maxChangePercent: 10, bidCap: null, minBid: 0.02, maxBid: null, useSuggestedBid: false, ignorePlacementModifiers: false, daysToObserve: 0 };
    case 'dayparting':
      return { mode: 'schedule', startHour: 0, endHour: 24, bidModifiers: [], days: [1, 2, 3, 4, 5, 6, 7], useOptimumHours: false, minHourlyOrders: 1 };
    case 'import':
      return { source: 'asin', matchType: 'exact', bidPercentOfCpc: 100, maxKeywordsPerRun: 50, negativeSourceAfterImport: false };
    case 'negative':
      return { source: 'asin', matchType: 'negativeExact', skipWhitelist: true };
    case 'negativeWord':
      return { source: 'asin', matchType: 'negativePhrase', skipWhitelist: true, minWordLength: 3 };
    case 'blacklist':
      return { negativeExact: [], negativePhrase: [], exactWhitelist: [], phraseWhitelist: [] };
    case 'revive':
      return { targetAcos: 30, maxChangePercent: 5, activeImpressions: 1, lookbackDays: 30 };
    case 'defaultBid':
      return { targetAcos: 30, maxChangePercent: 10, bidCap: null };
    case 'status':
      return { target: 'adGroup', action: 'pause' };
    case 'dailyBudget':
      return { baseline: null, minBudget: 5, maxBudget: null, dayOfWeekMultipliers: [1, 1, 1, 1, 1, 1, 1], applyCriteria: true };
    case 'placement':
      return { placement: 'topOfSearch', targetModifier: 50, incrementPercent: 10, decrementPercent: 10, observeAnyPlacement: false };
    default:
      return {};
  }
}
