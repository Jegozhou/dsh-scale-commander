/**
 * Criteria profiles: a small, explicit, JSON-serialisable condition language.
 *
 * A criteria profile is a reusable filter. The engine evaluates it against one
 * aggregated row; the UI renders and edits the same structure. Operators are
 * deliberately numeric-first because every PPC rule is a threshold.
 * @module shared/criteria
 */

/** Comparison operators, with their UI wording. */
export const OPERATORS = {
  gte: { label: 'at least', symbol: '≥', test: (value, bound) => value >= bound },
  lte: { label: 'at most', symbol: '≤', test: (value, bound) => value <= bound },
  gt: { label: 'greater than', symbol: '>', test: (value, bound) => value > bound },
  lt: { label: 'less than', symbol: '<', test: (value, bound) => value < bound },
  eq: { label: 'equals', symbol: '=', test: (value, bound) => Math.abs(value - bound) < 1e-9 },
  between: { label: 'between', symbol: '↔', test: (value, min, max) => value >= min && value <= max },
};

/** Matches nothing but is always valid, used by rows with no data. */
export const NO_DATA = Symbol('no-data');

/**
 * @typedef {object} Condition
 * @property {string} metric   Metric key from METRIC_KEYS.
 * @property {string} op       Operator key from OPERATORS.
 * @property {number} [value]  Bound for unary operators.
 * @property {number} [min]    Lower bound for `between`.
 * @property {number} [max]    Upper bound for `between`.
 */

/**
 * @typedef {object} CriteriaProfile
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {Condition[]} conditions
 * @property {boolean} [enabled]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {number} [revision]
 */

/**
 * Validate one condition without throwing; returns a list of problems so the
 * UI can show them inline and the API can refuse a bad write with a reason.
 * @param {Condition} condition
 * @returns {string[]}
 */
export function validateCondition(condition) {
  const problems = [];
  if (condition == null || typeof condition !== 'object') return ['condition must be an object'];
  if (typeof condition.metric !== 'string' || condition.metric.length === 0) problems.push('metric is required');
  if (!Object.hasOwn(OPERATORS, condition.op)) problems.push(`unknown operator "${String(condition.op)}"`);
  if (condition.op === 'between') {
    if (!Number.isFinite(condition.min)) problems.push('between requires a numeric min');
    if (!Number.isFinite(condition.max)) problems.push('between requires a numeric max');
    if (Number.isFinite(condition.min) && Number.isFinite(condition.max) && condition.min > condition.max) problems.push('min must not exceed max');
  } else if (condition.op !== undefined && Object.hasOwn(OPERATORS, condition.op)) {
    if (!Number.isFinite(condition.value)) problems.push(`${condition.op} requires a numeric value`);
  }
  return problems;
}

/**
 * Validate a whole profile.
 * @param {CriteriaProfile} profile
 * @returns {string[]}
 */
export function validateProfile(profile) {
  const problems = [];
  if (profile == null || typeof profile !== 'object') return ['profile must be an object'];
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) problems.push('name is required');
  if (!Array.isArray(profile.conditions)) problems.push('conditions must be an array');
  else profile.conditions.forEach((condition, index) => {
    for (const problem of validateCondition(condition)) problems.push(`condition ${index + 1}: ${problem}`);
  });
  return problems;
}

/**
 * Evaluate one condition against a row. Missing data fails closed: a metric
 * with no observations never satisfies a threshold, which is what stops a
 * rule from acting on a keyword that has not run yet.
 * @param {Condition} condition
 * @param {Record<string, number>} row
 * @param {(row: Record<string, number>, key: string) => number|null} read
 * @returns {boolean}
 */
export function testCondition(condition, row, read) {
  if (!Object.hasOwn(OPERATORS, condition.op)) return false;
  const actual = read(row, condition.metric);
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return false;
  const operator = OPERATORS[condition.op];
  return condition.op === 'between'
    ? operator.test(actual, condition.min, condition.max)
    : operator.test(actual, condition.value);
}

/**
 * Evaluate a profile with AND semantics, which is how every documented Scale
 * Insights criterion behaves: each added condition narrows the set.
 * @param {CriteriaProfile|null|undefined} profile
 * @param {Record<string, number>} row
 * @param {(row: Record<string, number>, key: string) => number|null} read
 * @returns {{matched: boolean, results: Array<{condition: Condition, actual: number|null, passed: boolean}>}}
 */
export function evaluateProfile(profile, row, read) {
  const conditions = profile?.conditions ?? [];
  const results = conditions.map((condition) => {
    const actual = read(row, condition.metric);
    return { condition, actual, passed: testCondition(condition, row, read) };
  });
  return { matched: results.every((entry) => entry.passed), results };
}

/**
 * Human-readable one-line summary, used in lists, tool output and audit rows.
 * @param {CriteriaProfile|null|undefined} profile
 * @param {(key: string) => string} labelOf
 * @returns {string}
 */
export function describeProfile(profile, labelOf = (key) => key) {
  if (profile == null) return 'no criteria';
  const parts = (profile.conditions ?? []).map((condition) => {
    const operator = OPERATORS[condition.op] ?? OPERATORS.gte;
    const bound = condition.op === 'between' ? `${condition.min}–${condition.max}` : String(condition.value);
    return `${labelOf(condition.metric)} ${operator.symbol} ${bound}`;
  });
  return parts.length === 0 ? 'matches everything' : parts.join(' AND ');
}

/**
 * A few starter profiles mirroring the conditions sellers use most.
 * They are plain data so the Host can seed them and the UI can clone them.
 * @returns {Array<{name: string, description: string, conditions: Condition[]}>}
 */
export function starterProfiles() {
  return [
    {
      name: 'No orders | Spend ≥ $10',
      description: 'Spending money without a single order — the classic negation trigger.',
      conditions: [
        { metric: 'orders', op: 'lte', value: 0 },
        { metric: 'spend', op: 'gte', value: 10 },
      ],
    },
    {
      name: 'Wasted clicks | 20 clicks, 0 orders',
      description: 'Enough traffic to conclude the term does not convert.',
      conditions: [
        { metric: 'clicks', op: 'gte', value: 20 },
        { metric: 'orders', op: 'lte', value: 0 },
      ],
    },
    {
      name: 'High ACOS | ≥ 80% with sales',
      description: 'Converting, but too expensive: bid down rather than negate.',
      conditions: [
        { metric: 'orders', op: 'gte', value: 1 },
        { metric: 'acos', op: 'gte', value: 80 },
      ],
    },
    {
      name: 'Winner | 5 orders, ≥ 15% CVR, ACOS ≤ 35%',
      description: 'Harvest and bid up: proven conversion at a healthy cost.',
      conditions: [
        { metric: 'orders', op: 'gte', value: 5 },
        { metric: 'cvr', op: 'gte', value: 15 },
        { metric: 'acos', op: 'lte', value: 35 },
      ],
    },
    {
      name: 'Low CTR | ≥ 1000 impressions, < 0.2% CTR',
      description: 'The ad is not earning the click; relevant for negation of irrelevant targets.',
      conditions: [
        { metric: 'impressions', op: 'gte', value: 1000 },
        { metric: 'ctr', op: 'lte', value: 0.2 },
        { metric: 'orders', op: 'lte', value: 0 },
      ],
    },
    {
      name: 'Budget risk | Spend ≥ $50, ACOS ≥ 60%',
      description: 'Protects the campaign budget before it burns out.',
      conditions: [
        { metric: 'spend', op: 'gte', value: 50 },
        { metric: 'acos', op: 'gte', value: 60 },
      ],
    },
  ];
}
