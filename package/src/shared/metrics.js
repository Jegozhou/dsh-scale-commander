/**
 * Metric registry and derived-metric maths shared by the Host rule engine and
 * the browser UI. Pure functions only: no Node, no DOM, no I/O.
 *
 * A "row" is one aggregated performance record. Every raw metric is a number;
 * derived metrics are computed on demand from the raw ones so that the same
 * object can be rendered by the UI and evaluated by the engine.
 * @module shared/metrics
 */

/** Units used for display and comparison. */
export const UNIT = {
  currency: 'currency',
  percent: 'percent',
  count: 'count',
  ratio: 'ratio',
  text: 'text',
};

/**
 * Raw metric definitions. `agg` says how the metric rolls up across rows:
 * `sum` adds, `ratio` recomputes from its components, `min`/`max` take bounds.
 * @type {Record<string, {label: string, unit: string, agg: string, precision?: number, description?: string, components?: string[]}>}
 */
export const RAW_METRICS = {
  impressions: { label: 'Impressions', unit: UNIT.count, agg: 'sum', description: 'Ad impressions served.' },
  clicks: { label: 'Clicks', unit: UNIT.count, agg: 'sum', description: 'Clicks on the ad.' },
  spend: { label: 'Spend', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'Advertising cost.' },
  sales: { label: 'Ad sales', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'Attributed ad-attributed sales.' },
  orders: { label: 'Orders', unit: UNIT.count, agg: 'sum', description: 'Attributed orders.' },
  units: { label: 'Units', unit: UNIT.count, agg: 'sum', description: 'Units sold through ads.' },
  organicSales: { label: 'Organic sales', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'Sales not attributed to ads.' },
  organicOrders: { label: 'Organic orders', unit: UNIT.count, agg: 'sum', description: 'Orders not attributed to ads.' },
  newToBrandSales: { label: 'NTB sales', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'New-to-brand attributed sales.' },
  newToBrandOrders: { label: 'NTB orders', unit: UNIT.count, agg: 'sum', description: 'New-to-brand attributed orders.' },
  returns: { label: 'Returns', unit: UNIT.count, agg: 'sum', description: 'Returned units.' },
  refundedSales: { label: 'Refunded sales', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'Sales refunded after return.' },
  impressionsTopOfSearch: { label: 'Impressions (TOS)', unit: UNIT.count, agg: 'sum', description: 'Impressions at top of search.' },
  impressionsProductPage: { label: 'Impressions (PP)', unit: UNIT.count, agg: 'sum', description: 'Impressions on product pages.' },
  impressionsRestOfSearch: { label: 'Impressions (ROS)', unit: UNIT.count, agg: 'sum', description: 'Impressions elsewhere in search.' },
  clicksTopOfSearch: { label: 'Clicks (TOS)', unit: UNIT.count, agg: 'sum', description: 'Clicks at top of search.' },
  clicksProductPage: { label: 'Clicks (PP)', unit: UNIT.count, agg: 'sum', description: 'Clicks on product pages.' },
  clicksRestOfSearch: { label: 'Clicks (ROS)', unit: UNIT.count, agg: 'sum', description: 'Clicks elsewhere in search.' },
  salesTopOfSearch: { label: 'Sales (TOS)', unit: UNIT.currency, agg: 'sum', precision: 2 },
  salesProductPage: { label: 'Sales (PP)', unit: UNIT.currency, agg: 'sum', precision: 2 },
  salesRestOfSearch: { label: 'Sales (ROS)', unit: UNIT.currency, agg: 'sum', precision: 2 },
  ordersTopOfSearch: { label: 'Orders (TOS)', unit: UNIT.count, agg: 'sum' },
  ordersProductPage: { label: 'Orders (PP)', unit: UNIT.count, agg: 'sum' },
  ordersRestOfSearch: { label: 'Orders (ROS)', unit: UNIT.count, agg: 'sum' },
  sessions: { label: 'Sessions', unit: UNIT.count, agg: 'sum', description: 'Detail-page sessions from Business Reports.' },
  pageViews: { label: 'Page views', unit: UNIT.count, agg: 'sum' },
  buyBoxPercentage: { label: 'Buy box %', unit: UNIT.percent, agg: 'ratio', components: ['buyBoxWins', 'pageViews'] },
  buyBoxWins: { label: 'Buy box wins', unit: UNIT.count, agg: 'sum' },
  cogs: { label: 'COGS', unit: UNIT.currency, agg: 'sum', precision: 2, description: 'Cost of goods for attributed units.' },
  fbaFees: { label: 'FBA fees', unit: UNIT.currency, agg: 'sum', precision: 2 },
  grossProfit: { label: 'Gross profit', unit: UNIT.currency, agg: 'sum', precision: 2 },
  dayCount: { label: 'Days observed', unit: UNIT.count, agg: 'sum' },
};

/**
 * Derived metrics: computed from raw metrics with a formula. `ratio` metrics
 * aggregate by recomputing from the summed inputs, never by averaging.
 * @type {Record<string, {label: string, unit: string, precision?: number, description?: string, derive: (m: Record<string, number>) => number|null}>}
 */
export const DERIVED_METRICS = {
  ctr: { label: 'CTR', unit: UNIT.percent, precision: 2, description: 'Clicks / impressions.', derive: (m) => safeDiv(m.clicks, m.impressions) },
  cvr: { label: 'CVR', unit: UNIT.percent, precision: 2, description: 'Orders / clicks.', derive: (m) => safeDiv(m.orders, m.clicks) },
  conversion: { label: 'Conversion', unit: UNIT.percent, precision: 2, description: 'Orders / clicks (alias of CVR).', derive: (m) => safeDiv(m.orders, m.clicks) },
  acos: { label: 'ACOS', unit: UNIT.percent, precision: 2, description: 'Spend / sales.', derive: (m) => safeDiv(m.spend, m.sales) },
  roas: { label: 'ROAS', unit: UNIT.ratio, precision: 2, description: 'Sales / spend.', derive: (m) => safeRatio(m.sales, m.spend) },
  cpc: { label: 'CPC', unit: UNIT.currency, precision: 2, description: 'Spend / clicks.', derive: (m) => safeRatio(m.spend, m.clicks) },
  cpa: { label: 'CPA', unit: UNIT.currency, precision: 2, description: 'Spend / orders.', derive: (m) => safeRatio(m.spend, m.orders) },
  cpm: { label: 'CPM', unit: UNIT.currency, precision: 2, description: 'Spend per thousand impressions.', derive: (m) => (Number(m.impressions) > 0 ? (Number(m.spend) / Number(m.impressions)) * 1000 : null) },
  aov: { label: 'AOV', unit: UNIT.currency, precision: 2, description: 'Sales / orders.', derive: (m) => safeRatio(m.sales, m.orders) },
  unitsPerOrder: { label: 'Units / order', unit: UNIT.ratio, precision: 2, derive: (m) => safeRatio(m.units, m.orders) },
  organicShare: { label: 'Organic share', unit: UNIT.percent, precision: 2, description: 'Organic sales / total sales.', derive: (m) => safeDiv(m.organicSales, (m.sales ?? 0) + (m.organicSales ?? 0)) },
  tacos: { label: 'TACOS', unit: UNIT.percent, precision: 2, description: 'Spend / total sales (ads + organic).', derive: (m) => safeDiv(m.spend, (m.sales ?? 0) + (m.organicSales ?? 0)) },
  returnRate: { label: 'Return rate', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.returns, m.units) },
  refundRate: { label: 'Refund rate', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.refundedSales, m.sales) },
  profit: { label: 'Profit', unit: UNIT.currency, precision: 2, description: 'Sales - spend - COGS - FBA fees.', derive: (m) => (m.sales ?? 0) - (m.spend ?? 0) - (m.cogs ?? 0) - (m.fbaFees ?? 0) },
  margin: { label: 'Margin', unit: UNIT.percent, precision: 2, description: 'Profit / sales.', derive: (m) => { const s = m.sales ?? 0; return s > 0 ? ((s - (m.spend ?? 0) - (m.cogs ?? 0) - (m.fbaFees ?? 0)) / s) * 100 : null; } },
  breakEvenAcos: { label: 'Break-even ACOS', unit: UNIT.percent, precision: 2, derive: (m) => { const s = m.sales ?? 0; const cost = (m.cogs ?? 0) + (m.fbaFees ?? 0); return s > 0 ? ((s - cost) / s) * 100 : null; } },
  topOfSearchShare: { label: 'TOS impression share', unit: UNIT.percent, precision: 2, description: 'TOS impressions / all impressions.', derive: (m) => safeDiv(m.impressionsTopOfSearch, m.impressions) },
  productPageShare: { label: 'PP impression share', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.impressionsProductPage, m.impressions) },
  restOfSearchShare: { label: 'ROS impression share', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.impressionsRestOfSearch, m.impressions) },
  topOfSearchCtr: { label: 'TOS CTR', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.clicksTopOfSearch, m.impressionsTopOfSearch) },
  productPageCtr: { label: 'PP CTR', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.clicksProductPage, m.impressionsProductPage) },
  restOfSearchCtr: { label: 'ROS CTR', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(m.clicksRestOfSearch, m.impressionsRestOfSearch) },
  topOfSearchAcos: { label: 'TOS ACOS', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(spendOf(m, 'TopOfSearch'), m.salesTopOfSearch) },
  productPageAcos: { label: 'PP ACOS', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(spendOf(m, 'ProductPage'), m.salesProductPage) },
  restOfSearchAcos: { label: 'ROS ACOS', unit: UNIT.percent, precision: 2, derive: (m) => safeDiv(spendOf(m, 'RestOfSearch'), m.salesRestOfSearch) },
  topOfSearchCpc: { label: 'TOS CPC', unit: UNIT.currency, precision: 2, derive: (m) => safeRatio(spendOf(m, 'TopOfSearch'), m.clicksTopOfSearch) },
  productPageCpc: { label: 'PP CPC', unit: UNIT.currency, precision: 2, derive: (m) => safeRatio(spendOf(m, 'ProductPage'), m.clicksProductPage) },
  restOfSearchCpc: { label: 'ROS CPC', unit: UNIT.currency, precision: 2, derive: (m) => safeRatio(spendOf(m, 'RestOfSearch'), m.clicksRestOfSearch) },
  impressionsPerDay: { label: 'Impressions / day', unit: UNIT.count, precision: 0, derive: (m) => safeRatio(m.impressions, m.dayCount) },
  clicksPerDay: { label: 'Clicks / day', unit: UNIT.count, precision: 1, derive: (m) => safeRatio(m.clicks, m.dayCount) },
  spendPerDay: { label: 'Spend / day', unit: UNIT.currency, precision: 2, derive: (m) => safeRatio(m.spend, m.dayCount) },
  salesPerDay: { label: 'Sales / day', unit: UNIT.currency, precision: 2, derive: (m) => safeRatio(m.sales, m.dayCount) },
};

/** All metric keys known to the system, in a stable display order. */
export const METRIC_KEYS = [...Object.keys(RAW_METRICS), ...Object.keys(DERIVED_METRICS)];

/**
 * Display labels for every metric, without the formula functions. The browser
 * bundle imports this instead of the full registry so it never ships the
 * derived-metric closures it does not need.
 * @type {Record<string, string>}
 */
export const METRIC_LABELS = Object.fromEntries(METRIC_KEYS.map((key) => [key, (RAW_METRICS[key] ?? DERIVED_METRICS[key]).label]));

/**
 * One catalogue entry per metric, for pickers and documentation.
 * @returns {Array<{key: string, label: string, unit: string, description: string, derived: boolean}>}
 */
export function metricCatalog() {
  return METRIC_KEYS.map((key) => {
    const raw = RAW_METRICS[key];
    const derived = DERIVED_METRICS[key];
    const definition = raw ?? derived;
    return {
      key,
      label: definition.label,
      unit: definition.unit,
      description: definition.description ?? '',
      derived: raw === undefined,
    };
  });
}

/** Metrics that only make sense with placement columns present. */
export const PLACEMENT_METRICS = [
  'impressionsTopOfSearch', 'impressionsProductPage', 'impressionsRestOfSearch',
  'clicksTopOfSearch', 'clicksProductPage', 'clicksRestOfSearch',
  'salesTopOfSearch', 'salesProductPage', 'salesRestOfSearch',
  'ordersTopOfSearch', 'ordersProductPage', 'ordersRestOfSearch',
  'topOfSearchShare', 'productPageShare', 'restOfSearchShare',
  'topOfSearchCtr', 'productPageCtr', 'restOfSearchCtr',
  'topOfSearchAcos', 'productPageAcos', 'restOfSearchAcos',
];

/**
 * Placement spend is not reported per placement by Amazon, so it is allocated
 * proportionally to placement clicks. The rule engine uses the same allocation
 * the UI shows, so a preview never disagrees with the audit trail.
 * @param {Record<string, number>} m
 * @param {'TopOfSearch'|'ProductPage'|'RestOfSearch'} placement
 * @returns {number}
 */
export function spendOf(m, placement) {
  const totalClicks = (m.clicksTopOfSearch ?? 0) + (m.clicksProductPage ?? 0) + (m.clicksRestOfSearch ?? 0);
  if (totalClicks <= 0) return 0;
  const clicks = m[`clicks${placement}`] ?? 0;
  return ((m.spend ?? 0) * clicks) / totalClicks;
}

/**
 * A percentage metric: the numerator as a share of the denominator, 0-100.
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number|null} percentage, or null when the denominator is zero
 */
export function safeDiv(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return (n / d) * 100;
}

/**
 * A ratio metric whose unit is not a percentage: money per click, sales per
 * dollar, units per order. Dividing these by 100 is the classic analytics bug.
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number|null} the plain ratio, or null when the denominator is zero
 */
export function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

/**
 * Read one metric from an aggregate row, preferring an explicitly stored value
 * (the engine stores derived metrics on rollups to avoid recomputation drift).
 * @param {Record<string, number>} row
 * @param {string} key
 * @returns {number|null}
 */
export function readMetric(row, key) {
  if (row == null) return null;
  const stored = row[key];
  if (stored !== undefined && stored !== null && Number.isFinite(Number(stored))) return Number(stored);
  const derived = DERIVED_METRICS[key];
  if (derived !== undefined) {
    const value = derived.derive(row);
    return value === null || Number.isFinite(value) ? value : null;
  }
  const raw = RAW_METRICS[key];
  if (raw === undefined) return null;
  if (raw.components !== undefined) {
    const [a, b] = raw.components;
    return safeDiv(row[a], row[b]);
  }
  return 0;
}

/**
 * Aggregate rows by summing additive metrics and recomputing ratios.
 * @param {Array<Record<string, number>>} rows
 * @returns {Record<string, number>}
 */
export function sumRows(rows) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const row of rows) {
    if (row == null) continue;
    for (const [key, def] of Object.entries(RAW_METRICS)) {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) continue;
      if (def.agg === 'min') out[key] = out[key] === undefined ? value : Math.min(out[key], value);
      else if (def.agg === 'max') out[key] = out[key] === undefined ? value : Math.max(out[key], value);
      else out[key] = (out[key] ?? 0) + value;
    }
  }
  for (const [key, def] of Object.entries(RAW_METRICS)) {
    if (def.agg === 'ratio') {
      const [a, b] = def.components;
      const ratio = safeDiv(out[a], out[b]);
      if (ratio !== null) out[key] = ratio;
    }
  }
  return out;
}

/**
 * Format a metric for display in the active locale.
 * @param {string} key
 * @param {number|null|undefined} value
 * @param {{currency?: string, locale?: string, compact?: boolean}} [options]
 * @returns {string}
 */
export function formatMetric(key, value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  const def = RAW_METRICS[key] ?? DERIVED_METRICS[key];
  const unit = def?.unit ?? UNIT.count;
  const precision = def?.precision ?? (unit === UNIT.count ? 0 : 2);
  const locale = options.locale ?? 'en-US';
  if (unit === UNIT.currency) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: options.currency ?? 'USD',
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      notation: options.compact === true ? 'compact' : 'standard',
    }).format(number);
  }
  if (unit === UNIT.percent) return `${number.toFixed(precision)}%`;
  if (unit === UNIT.ratio) return number.toFixed(precision);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    notation: options.compact === true ? 'compact' : 'standard',
  }).format(number);
}
