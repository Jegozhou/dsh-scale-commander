/**
 * The browser's only door to the Host.
 *
 * Every call goes to `/scale-commander/api/...` with the page's own cookie, so
 * the plugin adds no authentication of its own. Failures are normalised into an
 * `ApiFailure` carrying the Host's stable code, which the UI renders verbatim.
 * @module client/lib/api
 */

/** Base path of the plugin API; must match the Host's `API_PREFIX`. */
export const API_BASE = '/scale-commander/api';

/** One failed request, with the Host's code and message. */
export class ApiFailure extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   * @param {unknown} [details]
   */
  constructor(code, message, status, details) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
export function withQuery(path, query) {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? path : `${path}?${text}`;
}

/**
 * @param {string} path
 * @param {{method?: string, body?: unknown, signal?: AbortSignal}} [options]
 * @returns {Promise<any>}
 */
export async function call(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ApiFailure('bad-response', `the Host answered with non-JSON (${response.status})`, response.status);
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiFailure(String(error.code ?? 'http'), String(error.message ?? `request failed (${response.status})`), response.status, error.details);
  }
  return payload;
}

/**
 * The typed endpoint table. Keeping every path here means a route rename is a
 * one-line change and the UI never concatenates URLs by hand.
 * @param {string} accountId
 * @returns {Record<string, Function>}
 */
export function accountApi(accountId) {
  const base = `/accounts/${encodeURIComponent(accountId)}`;
  return {
    campaigns: (query) => call(withQuery(`${base}/campaigns`, query)),
    adGroups: (query) => call(withQuery(`${base}/ad-groups`, query)),
    keywords: (query) => call(withQuery(`${base}/keywords`, query)),
    negatives: (query) => call(withQuery(`${base}/negatives`, query)),
    addNegative: (body) => call(`${base}/negatives`, { method: 'POST', body }),
    removeNegative: (id) => call(`${base}/negatives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    profiles: () => call(`${base}/profiles`),
    saveProfile: (body) => call(`${base}/profiles`, { method: 'POST', body }),
    deleteProfile: (id) => call(`${base}/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    rules: () => call(`${base}/rules`),
    saveRule: (body) => call(`${base}/rules`, { method: 'POST', body }),
    deleteRule: (id) => call(`${base}/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    assign: (ruleId, body) => call(`${base}/rules/${encodeURIComponent(ruleId)}/assign`, { method: 'POST', body }),
    unassign: (ruleId, body) => call(`${base}/rules/${encodeURIComponent(ruleId)}/unassign`, { method: 'POST', body }),
    assignments: () => call(`${base}/assignments`),
    objectives: () => call(`${base}/objectives`),
    saveObjective: (body) => call(`${base}/objectives`, { method: 'POST', body }),
    assignObjective: (id, body) => call(`${base}/objectives/${encodeURIComponent(id)}/assign`, { method: 'POST', body }),
    deleteObjective: (id) => call(`${base}/objectives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    preview: (body) => call(`${base}/preview`, { method: 'POST', body }),
    apply: (body) => call(`${base}/apply`, { method: 'POST', body }),
    runs: (query) => call(withQuery(`${base}/runs`, query)),
    run: (id) => call(`${base}/runs/${encodeURIComponent(id)}`),
    rollback: (id, body) => call(`${base}/runs/${encodeURIComponent(id)}/rollback`, { method: 'POST', body }),
    overview: (query) => call(withQuery(`${base}/overview`, query)),
    breakdown: (query) => call(withQuery(`${base}/breakdown`, query)),
    words: (query) => call(withQuery(`${base}/words`, query)),
    deadKeywords: (query) => call(withQuery(`${base}/dead-keywords`, query)),
    placements: (query) => call(withQuery(`${base}/placements`, query)),
    attribution: (query) => call(withQuery(`${base}/attribution`, query)),
    restock: (query) => call(withQuery(`${base}/restock`, query)),
    searchTerms: (query) => call(withQuery(`${base}/search-terms`, query)),
    heatmap: (query) => call(withQuery(`${base}/heatmap`, query)),
    products: () => call(`${base}/products`),
    saveProduct: (body) => call(`${base}/products`, { method: 'POST', body }),
    massPreview: (body) => call(`${base}/mass/preview`, { method: 'POST', body }),
    massCreate: (body) => call(`${base}/mass/create`, { method: 'POST', body }),
    massUndo: (body) => call(`${base}/mass/undo`, { method: 'POST', body }),
    schedules: () => call(`${base}/schedules`),
    saveSchedule: (body) => call(`${base}/schedules`, { method: 'POST', body }),
    deleteSchedule: (id) => call(`${base}/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sync: (body) => call(`${base}/sync`, { method: 'POST', body }),
  };
}

/** Endpoints that are not account-scoped. */
export const globalApi = {
  health: () => call('/health'),
  meta: () => call('/meta'),
  accounts: () => call('/accounts'),
  createAccount: (body) => call('/accounts', { method: 'POST', body }),
  updateAccount: (id, body) => call(`/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteAccount: (id) => call(`/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  connectAccount: (id, body) => call(`/accounts/${encodeURIComponent(id)}/connect`, { method: 'POST', body }),
  saveCredentials: (id, body) => call(`/accounts/${encodeURIComponent(id)}/credentials`, { method: 'POST', body }),
  credentialStatus: (id) => call(`/accounts/${encodeURIComponent(id)}/credentials`),
  seedSandbox: (id, body) => call(`/accounts/${encodeURIComponent(id)}/sandbox`, { method: 'POST', body }),
  audit: (query) => call(withQuery('/audit', query)),
  settings: () => call('/settings'),
  saveSettings: (body) => call('/settings', { method: 'POST', body }),
  tick: (body) => call('/scheduler/tick', { method: 'POST', body }),
};
