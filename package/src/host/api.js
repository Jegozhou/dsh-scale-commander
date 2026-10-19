/**
 * HTTP API for the browser half.
 *
 * The Harness page authenticates with its own signed cookie; every request
 * here first asks Connection to admit it, so the plugin never invents a second
 * auth scheme. Routes are exact and prefix-free apart from one `prefix` entry
 * that owns the whole `/scale-commander/api` subtree.
 *
 * Requests and responses are JSON. Failures use a stable `{error: {code,
 * message, details}}` envelope so the UI can render a precise message.
 * @module host/api
 */

import { RULE_KINDS, STRATEGIC_OBJECTIVES, defaultParams, MARKETPLACES } from '../shared/domain.js';
import { metricCatalog } from '../shared/metrics.js';
import { starterProfiles } from '../shared/criteria.js';
import { normalizeParams } from './engine.js';
import { ApiError } from './api-error.js';

/** Base path of the plugin API. */
export const API_PREFIX = '/scale-commander/api';
/** Maximum accepted request body, in bytes. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The router: method + path template to handler.
 */
export class ApiServer {
  /**
   * @param {object} deps
   * @param {import('./service.js').ScaleService} deps.service
   * @param {(req: any) => number|undefined} deps.admit   Connection's request fence.
   * @param {(message: string) => void} [deps.log]
   */
  constructor(deps) {
    this.service = deps.service;
    this.admit = deps.admit;
    this.log = deps.log ?? (() => {});
    /** @type {Array<{method: string, pattern: RegExp, keys: string[], handler: Function}>} */
    this.routes = [];
    this.#register();
  }

  #route(method, template, handler) {
    const keys = [];
    const pattern = new RegExp(`^${template.replace(/:([A-Za-z0-9_]+)/gu, (_match, key) => {
      keys.push(key);
      return '([^/]+)';
    })}$`, 'u');
    this.routes.push({ method, pattern, keys, handler });
  }

  #register() {
    const s = this.service;

    this.#route('GET', '/health', () => s.health());

    /* Accounts */
    this.#route('GET', '/accounts', () => s.listAccounts());
    this.#route('POST', '/accounts', (body) => s.createAccount(body));
    this.#route('PATCH', '/accounts/:id', (body, params) => s.updateAccount(params.id, body));
    this.#route('DELETE', '/accounts/:id', (_body, params) => s.deleteAccount(params.id));
    this.#route('POST', '/accounts/:id/connect', (body, params) => s.connectAccount(params.id, body));
    this.#route('POST', '/accounts/:id/credentials', (body, params) => s.saveCredentials(params.id, body));
    this.#route('GET', '/accounts/:id/credentials', (_body, params) => s.credentialStatus(params.id));
    this.#route('POST', '/accounts/:id/sync', (body, params) => s.sync(params.id, body));
    this.#route('POST', '/accounts/:id/sandbox', (body, params) => s.seedSandbox(params.id, body));

    /* Catalogue and reference data */
    this.#route('GET', '/meta', () => ({
      ruleKinds: RULE_KINDS,
      objectives: STRATEGIC_OBJECTIVES,
      metrics: metricCatalog(),
      marketplaces: MARKETPLACES,
      starterProfiles: starterProfiles(),
      defaultParams: Object.fromEntries(Object.keys(RULE_KINDS).map((kind) => [kind, defaultParams(kind)])),
      version: s.version,
    }));

    /* Campaigns */
    this.#route('GET', '/accounts/:id/campaigns', (body, params) => s.listCampaigns(params.id, body));
    this.#route('GET', '/accounts/:id/ad-groups', (body, params) => s.listAdGroups(params.id, body));
    this.#route('GET', '/accounts/:id/keywords', (body, params) => s.listKeywords(params.id, body));
    this.#route('GET', '/accounts/:id/negatives', (body, params) => s.listNegatives(params.id, body));
    this.#route('POST', '/accounts/:id/negatives', (body, params) => s.addNegative(params.id, body));
    this.#route('DELETE', '/accounts/:id/negatives/:negativeId', (_body, params) => s.removeNegative(params.id, params.negativeId));

    /* Criteria profiles */
    this.#route('GET', '/accounts/:id/profiles', (body, params) => s.listProfiles(params.id));
    this.#route('POST', '/accounts/:id/profiles', (body, params) => s.saveProfile(params.id, body));
    this.#route('PATCH', '/accounts/:id/profiles/:profileId', (body, params) => s.saveProfile(params.id, { ...body, id: params.profileId }));
    this.#route('DELETE', '/accounts/:id/profiles/:profileId', (_body, params) => s.deleteProfile(params.id, params.profileId));

    /* Rules and assignments */
    this.#route('GET', '/accounts/:id/rules', (body, params) => s.listRules(params.id));
    this.#route('POST', '/accounts/:id/rules', (body, params) => s.saveRule(params.id, body));
    this.#route('PATCH', '/accounts/:id/rules/:ruleId', (body, params) => s.saveRule(params.id, { ...body, id: params.ruleId }));
    this.#route('DELETE', '/accounts/:id/rules/:ruleId', (_body, params) => s.deleteRule(params.id, params.ruleId));
    this.#route('POST', '/accounts/:id/rules/:ruleId/assign', (body, params) => s.assign(params.id, params.ruleId, body));
    this.#route('POST', '/accounts/:id/rules/:ruleId/unassign', (body, params) => s.unassign(params.id, params.ruleId, body));
    this.#route('GET', '/accounts/:id/assignments', (body, params) => s.listAssignments(params.id));

    /* Objectives */
    this.#route('GET', '/accounts/:id/objectives', (body, params) => s.listObjectives(params.id));
    this.#route('POST', '/accounts/:id/objectives', (body, params) => s.saveObjective(params.id, body));
    this.#route('POST', '/accounts/:id/objectives/:objectiveId/assign', (body, params) => s.assignObjective(params.id, params.objectiveId, body));
    this.#route('DELETE', '/accounts/:id/objectives/:objectiveId', (_body, params) => s.deleteObjective(params.id, params.objectiveId));

    /* Preview / apply / rollback */
    this.#route('POST', '/accounts/:id/preview', (body, params) => s.preview(params.id, body));
    this.#route('POST', '/accounts/:id/apply', (body, params) => s.applyPlan(params.id, body));
    this.#route('GET', '/accounts/:id/runs', (body, params) => s.listRuns(params.id, body));
    this.#route('GET', '/accounts/:id/runs/:runId', (body, params) => s.getRun(params.id, params.runId));
    this.#route('POST', '/accounts/:id/runs/:runId/rollback', (body, params) => s.rollback(params.id, params.runId, body));

    /* Analytics */
    this.#route('GET', '/accounts/:id/overview', (body, params) => s.overview(params.id, body));
    this.#route('GET', '/accounts/:id/breakdown', (body, params) => s.breakdown(params.id, body));
    this.#route('GET', '/accounts/:id/words', (body, params) => s.words(params.id, body));
    this.#route('GET', '/accounts/:id/dead-keywords', (body, params) => s.deadKeywords(params.id, body));
    this.#route('GET', '/accounts/:id/placements', (body, params) => s.placements(params.id, body));
    this.#route('GET', '/accounts/:id/attribution', (body, params) => s.attribution(params.id, body));
    this.#route('GET', '/accounts/:id/restock', (body, params) => s.restock(params.id, body));
    this.#route('GET', '/accounts/:id/search-terms', (body, params) => s.searchTerms(params.id, body));
    this.#route('GET', '/accounts/:id/heatmap', (body, params) => s.heatmap(params.id, body));
    this.#route('GET', '/accounts/:id/products', (body, params) => s.listProducts(params.id));
    this.#route('POST', '/accounts/:id/products', (body, params) => s.saveProduct(params.id, body));

    /* Mass campaigns */
    this.#route('POST', '/accounts/:id/mass/preview', (body, params) => s.massPreview(params.id, body));
    this.#route('POST', '/accounts/:id/mass/create', (body, params) => s.massCreate(params.id, body));
    this.#route('POST', '/accounts/:id/mass/undo', (body, params) => s.massUndo(params.id, body));

    /* Schedules, audit, settings */
    this.#route('GET', '/accounts/:id/schedules', (body, params) => s.listSchedules(params.id));
    this.#route('POST', '/accounts/:id/schedules', (body, params) => s.saveSchedule(params.id, body));
    this.#route('DELETE', '/accounts/:id/schedules/:scheduleId', (_body, params) => s.deleteSchedule(params.id, params.scheduleId));
    this.#route('GET', '/audit', (body) => s.listAudit(body));
    this.#route('GET', '/settings', () => s.getSettings());
    this.#route('POST', '/settings', (body) => s.saveSettings(body));
    this.#route('POST', '/scheduler/tick', (body) => s.tickScheduler(body));
  }

  /**
   * Handle one HTTP request. Owns the whole response lifecycle.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<void>}
   */
  async handle(req, res) {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const rejection = this.admit(req);
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: { code: 'unauthorized', message: 'this page is not authenticated for the Harness API' } });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://scale-commander.invalid');
      const path = url.pathname.slice(API_PREFIX.length) || '/';
      const method = String(req.method ?? 'GET').toUpperCase();
      const match = this.routes.find((route) => route.method === method && route.pattern.test(path));
      if (match === undefined) {
        throw new ApiError(404, 'not-found', `no route for ${method} ${path}`);
      }
      const values = match.pattern.exec(path)?.slice(1) ?? [];
      const params = Object.fromEntries(match.keys.map((key, index) => [key, decodeURIComponent(values[index] ?? '')]));
      const query = Object.fromEntries(url.searchParams.entries());
      const body = method === 'GET' || method === 'DELETE' ? query : { ...query, ...(await readJson(req)) };
      const result = await match.handler(body, params, req);
      sendJson(res, 200, result ?? { ok: true });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'internal';
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) this.log(`api: ${req.method} ${req.url} failed — ${message}`);
      sendJson(res, status, {
        error: {
          code,
          message,
          ...(error instanceof ApiError && error.details !== undefined ? { details: error.details } : {}),
        },
      });
    } finally {
      res.setHeader('x-request-id', requestId);
    }
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(payload);
}

/**
 * Read and parse a JSON request body with a hard size cap.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'body-too-large', `request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'bad-body', 'the request body must be a JSON object');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'bad-json', 'the request body is not valid JSON');
  }
}

export { normalizeParams };
