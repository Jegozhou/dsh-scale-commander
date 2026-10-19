/**
 * ScaleService: the façade every surface calls.
 *
 * The HTTP API, the agent tools and the scheduler all go through this object,
 * so a capability added here is automatically available to all three and the
 * audit trail is uniform. Validation lives here; persistence lives in the
 * repository; Amazon lives behind the provider resolver.
 * @module host/service
 */

import { randomUUID } from 'node:crypto';
import { ApiError } from './api-error.js';
import { RULE_KINDS, STRATEGIC_OBJECTIVES, MARKETPLACES, defaultParams } from '../shared/domain.js';
import { validateProfile, starterProfiles, describeProfile } from '../shared/criteria.js';
import { normalizeParams } from './engine.js';
import { nowIso, windowDates } from './store.js';
import { localParts } from './scheduler.js';
import { mask } from './vault.js';

/**
 * @param {object} deps
 * @param {import('./repository.js').Repository} deps.repository
 * @param {import('./engine.js').EngineService} deps.engine
 * @param {import('./sync.js').SyncService} deps.syncService
 * @param {import('./analytics.js').AnalyticsService} deps.analytics
 * @param {import('./mass.js').MassService} deps.mass
 * @param {import('./scheduler.js').Scheduler} deps.scheduler
 * @param {import('./vault.js').CredentialVault} deps.vault
 * @param {(accountId: string) => Promise<{provider: any, account: any}>} deps.providerFor
 * @param {() => Record<string, any>} deps.settings
 * @param {(next: Record<string, any>) => Promise<void>} deps.persistSettings
 * @param {(message: string) => void} [deps.log]
 */
export class ScaleService {
  constructor(deps) {
    this.repository = deps.repository;
    this.engine = deps.engine;
    this.syncService = deps.syncService;
    this.analytics = deps.analytics;
    this.mass = deps.mass;
    this.scheduler = deps.scheduler;
    this.vault = deps.vault;
    this.providerFor = deps.providerFor;
    this.settings = deps.settings;
    this.persistSettings = deps.persistSettings;
    this.log = deps.log ?? (() => {});
    this.version = '1.0.0';
  }

  /** @returns {Record<string, any>} */
  health() {
    const accounts = this.repository.listAccounts();
    return {
      ok: true,
      version: this.version,
      accounts: accounts.length,
      connected: accounts.filter((account) => account.status === 'connected').length,
      scheduler: this.scheduler.status(),
      settings: { ...this.settings(), tokenEncryptionKey: undefined },
      time: nowIso(),
    };
  }

  /* ---------------------------------------------------------------- *
   * Accounts
   * ---------------------------------------------------------------- */

  /** @returns {Array<Record<string, any>>} */
  listAccounts() {
    const accounts = this.repository.listAccounts();
    return accounts.map((account) => {
      const campaigns = this.repository.listCampaigns(account.id);
      const rules = this.repository.listRules(account.id);
      return {
        ...account,
        clientId: mask(account.clientId),
        counts: {
          campaigns: campaigns.length,
          adGroups: this.repository.listAdGroups(account.id).length,
          rules: rules.length,
          enabledRules: rules.filter((rule) => rule.enabled).length,
        },
        marketplaceLabel: MARKETPLACES[account.marketplace]?.label ?? account.marketplace,
      };
    });
  }

  /**
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async createAccount(body) {
    const name = requireString(body.name, 'name', 120);
    const provider = body.provider === 'sandbox' ? 'sandbox' : 'amazon';
    const marketplace = String(body.marketplace ?? 'ATVPDKIKX0DER');
    const info = MARKETPLACES[marketplace];
    if (info === undefined) throw new ApiError(400, 'bad-marketplace', `unknown marketplace "${marketplace}"`);
    const account = {
      id: randomUUID(),
      name,
      provider,
      region: String(body.region ?? info.region),
      marketplace,
      currency: String(body.currency ?? info.currency),
      timezone: String(body.timezone ?? info.timezone),
      clientId: String(body.clientId ?? ''),
      profileId: String(body.profileId ?? ''),
      status: provider === 'sandbox' ? 'connected' : 'disconnected',
    };
    const created = this.repository.putAccount(account);
    this.repository.audit({ accountId: created.id, actor: body.actor ?? 'user', action: 'account.created', target: created.name, detail: { provider, marketplace } });
    if (provider === 'sandbox') {
      await this.seedSandbox(created.id, { days: Number(body.days ?? 120) });
    }
    return this.repository.getAccount(created.id);
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  updateAccount(accountId, body) {
    const account = this.requireAccount(accountId);
    const next = {
      ...account,
      name: body.name === undefined ? account.name : requireString(body.name, 'name', 120),
      timezone: body.timezone === undefined ? account.timezone : String(body.timezone),
      profileId: body.profileId === undefined ? account.profileId : String(body.profileId),
      clientId: body.clientId === undefined ? account.clientId : String(body.clientId),
      dryRun: body.dryRun === undefined ? account.dryRun : body.dryRun === true,
    };
    if (body.marketplace !== undefined) {
      const info = MARKETPLACES[String(body.marketplace)];
      if (info === undefined) throw new ApiError(400, 'bad-marketplace', `unknown marketplace "${String(body.marketplace)}"`);
      next.marketplace = String(body.marketplace);
      next.currency = info.currency;
      next.region = info.region;
    }
    const updated = this.repository.putAccount(next);
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'account.updated', target: updated.name, detail: { fields: Object.keys(body).filter((key) => key !== 'actor') } });
    return updated;
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteAccount(accountId, body = {}) {
    const account = this.requireAccount(accountId);
    this.repository.deleteAccount(accountId);
    await this.vault.delete(accountId).catch(() => undefined);
    this.repository.audit({ accountId: '', actor: body.actor ?? 'user', action: 'account.deleted', target: account.name, detail: { accountId } });
    return { deleted: true };
  }

  /**
   * @param {string} accountId
   * @param {{clientId?: string, clientSecret?: string, refreshToken?: string, profileId?: string, actor?: string}} body
   * @returns {Promise<Record<string, any>>}
   */
  async saveCredentials(accountId, body) {
    const account = this.requireAccount(accountId);
    if (account.provider === 'sandbox') throw new ApiError(400, 'sandbox-account', 'a sandbox account does not use Amazon credentials');
    const clientId = String(body.clientId ?? account.clientId ?? '').trim();
    const clientSecret = String(body.clientSecret ?? '').trim();
    const refreshToken = String(body.refreshToken ?? '').trim();
    if (clientId.length === 0) throw new ApiError(400, 'missing-client-id', 'clientId is required');
    if (clientSecret.length === 0) throw new ApiError(400, 'missing-client-secret', 'clientSecret is required');
    if (refreshToken.length === 0) throw new ApiError(400, 'missing-refresh-token', 'refreshToken is required');
    const stored = await this.vault.set(accountId, {
      clientId,
      clientSecret,
      refreshToken,
      profileId: String(body.profileId ?? account.profileId ?? ''),
    });
    this.repository.putAccount({ ...account, clientId, profileId: String(body.profileId ?? account.profileId ?? ''), status: 'ready', lastError: '' });
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'account.credentials-saved', target: account.name, detail: { storedIn: stored.storedIn } });
    return { ok: true, storedIn: stored.storedIn };
  }

  /**
   * @param {string} accountId
   * @returns {Promise<Record<string, any>>}
   */
  async credentialStatus(accountId) {
    this.requireAccount(accountId);
    return this.vault.status(accountId);
  }

  /**
   * Verify credentials against Amazon and store the profile id.
   * @param {string} accountId
   * @param {{actor?: string, profileId?: string}} [body]
   * @returns {Promise<Record<string, any>>}
   */
  async connectAccount(accountId, body = {}) {
    const account = this.requireAccount(accountId);
    if (account.provider === 'sandbox') {
      this.repository.putAccount({ ...account, status: 'connected', lastError: '' });
      return { ok: true, profiles: [{ profileId: `sandbox-${accountId}`, countryCode: 'US' }] };
    }
    const credentials = await this.vault.get(accountId);
    if (credentials === undefined) throw new ApiError(400, 'no-credentials', 'save Amazon credentials before connecting');
    const { provider } = await this.providerFor(accountId, { credentials });
    const profiles = await provider.profiles();
    if (profiles.length === 0) throw new ApiError(400, 'no-profiles', 'the refresh token grants no advertising profile');
    const wanted = String(body.profileId ?? account.profileId ?? profiles[0].profileId);
    const selected = profiles.find((profile) => profile.profileId === wanted) ?? profiles[0];
    this.repository.putAccount({
      ...account,
      profileId: selected.profileId,
      status: 'connected',
      lastError: '',
      currency: selected.currencyCode || account.currency,
      timezone: selected.timezone || account.timezone,
    });
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'account.connected', target: account.name, detail: { profileId: selected.profileId } });
    return { ok: true, profiles, selected };
  }

  /**
   * Populate a sandbox account with generated data.
   * @param {string} accountId
   * @param {{days?: number, actor?: string}} [body]
   * @returns {Promise<Record<string, any>>}
   */
  async seedSandbox(accountId, body = {}) {
    const account = this.requireAccount(accountId);
    if (account.provider !== 'sandbox') throw new ApiError(400, 'not-sandbox', 'this account is not a sandbox account');
    this.repository.clearStructure(accountId);
    this.repository.clearMetrics(accountId);
    this.repository.store.run('DELETE FROM negatives WHERE account_id = ?', accountId);
    this.repository.store.run('DELETE FROM schedules WHERE account_id = ?', accountId);
    const summary = await this.syncService.sync(accountId, { days: Number(body.days ?? 120), structure: true, metrics: true, searchTerms: true, hourly: true });
    await this.ensureStarterProfiles(accountId);
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'sandbox.seeded', target: account.name, detail: { campaigns: summary.structure.campaigns, metrics: summary.metrics.rows } });
    return summary;
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async sync(accountId, body = {}) {
    this.requireAccount(accountId);
    const summary = await this.syncService.sync(accountId, {
      days: Number(body.days ?? 90),
      hourly: body.hourly !== false,
      searchTerms: body.searchTerms !== false,
      structure: body.structure !== false,
      metrics: body.metrics !== false,
    });
    return summary;
  }

  /* ---------------------------------------------------------------- *
   * Catalogue reads
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  listCampaigns(accountId, query = {}) {
    this.requireAccount(accountId);
    const campaigns = this.repository.listCampaigns(accountId, {
      adType: query.adType,
      state: query.state,
      search: query.search,
    });
    const range = rangeOf(query);
    const metrics = new Map(this.repository.aggregateMetrics(accountId, 'campaign', range.start, range.end).map((row) => [String(row.entityId), row]));
    const adGroups = this.repository.listAdGroups(accountId);
    const rules = this.repository.listRules(accountId);
    const assignments = this.repository.listAssignments(accountId);
    return {
      items: campaigns.map((campaign) => ({
        ...campaign,
        metrics: metrics.get(campaign.id) ?? {},
        adGroupCount: adGroups.filter((adGroup) => adGroup.campaignId === campaign.id).length,
        rules: assignments.filter((assignment) => assignment.campaignId === campaign.id).map((assignment) => ({
          assignmentId: assignment.id,
          ruleId: assignment.ruleId,
          ruleName: rules.find((rule) => rule.id === assignment.ruleId)?.name ?? '',
          kind: rules.find((rule) => rule.id === assignment.ruleId)?.kind ?? '',
          adGroupId: assignment.adGroupId,
        })),
      })),
      total: campaigns.length,
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  listAdGroups(accountId, query = {}) {
    this.requireAccount(accountId);
    const adGroups = this.repository.listAdGroups(accountId, { campaignId: query.campaignId, search: query.search });
    const range = rangeOf(query);
    const metrics = new Map(this.repository.aggregateMetrics(accountId, 'adGroup', range.start, range.end).map((row) => [String(row.entityId), row]));
    const assignments = this.repository.listAssignments(accountId);
    const rules = this.repository.listRules(accountId);
    return {
      items: adGroups.map((adGroup) => ({
        ...adGroup,
        metrics: metrics.get(adGroup.id) ?? {},
        schedule: this.repository.listSchedules(accountId).find((schedule) => schedule.adGroupId === adGroup.id) ?? null,
        rules: assignments.filter((assignment) => assignment.adGroupId === adGroup.id).map((assignment) => ({
          assignmentId: assignment.id,
          ruleId: assignment.ruleId,
          ruleName: rules.find((rule) => rule.id === assignment.ruleId)?.name ?? '',
          kind: rules.find((rule) => rule.id === assignment.ruleId)?.kind ?? '',
        })),
      })),
      total: adGroups.length,
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  listKeywords(accountId, query = {}) {
    this.requireAccount(accountId);
    const limit = Math.max(1, Math.min(5000, Number(query.limit ?? 1000)));
    const search = String(query.search ?? '').trim().toLowerCase();
    const keywords = this.repository.listKeywords(accountId)
      .filter((keyword) => (query.adGroupId === undefined || query.adGroupId === '' || keyword.adGroupId === query.adGroupId))
      .filter((keyword) => (query.campaignId === undefined || query.campaignId === '' || keyword.campaignId === query.campaignId))
      .filter((keyword) => search.length === 0 || keyword.text.toLowerCase().includes(search));
    const range = rangeOf(query);
    const metrics = new Map(this.repository.aggregateMetrics(accountId, 'keyword', range.start, range.end).map((row) => [String(row.entityId), row]));
    return {
      items: keywords.slice(0, limit).map((keyword) => ({ ...keyword, metrics: metrics.get(keyword.id) ?? {} })),
      total: keywords.length,
      truncated: keywords.length > limit,
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  listNegatives(accountId, query = {}) {
    this.requireAccount(accountId);
    const search = String(query.search ?? '').trim().toLowerCase();
    const items = this.repository.listNegatives(accountId)
      .filter((negative) => (query.adGroupId === undefined || query.adGroupId === '' || negative.adGroupId === query.adGroupId))
      .filter((negative) => search.length === 0 || negative.text.toLowerCase().includes(search));
    return { items, total: items.length };
  }

  /**
   * Add one negative by hand, through Amazon and the store.
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async addNegative(accountId, body) {
    const account = this.requireAccount(accountId);
    const adGroupId = requireString(body.adGroupId, 'adGroupId', 200);
    const text = requireString(body.text, 'text', 200).toLowerCase();
    const matchType = body.matchType === 'negativePhrase' ? 'negativePhrase' : 'negativeExact';
    const adGroup = this.repository.getAdGroup(adGroupId);
    if (adGroup === undefined) throw new ApiError(404, 'unknown-ad-group', `unknown ad group "${adGroupId}"`);
    const { provider } = await this.providerFor(accountId);
    await provider.createNegativeKeywords('SP', [{
      campaignId: adGroup.campaignId,
      adGroupId,
      keywordText: text,
      matchType,
      state: 'ENABLED',
    }]);
    this.repository.putNegative({
      id: randomUUID(),
      accountId,
      campaignId: adGroup.campaignId,
      adGroupId,
      level: 'adGroup',
      text,
      matchType,
      state: 'ENABLED',
      source: 'manual',
    });
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'negative.created', target: text, detail: { adGroupId, matchType } });
    return { ok: true, text, matchType };
  }

  /**
   * @param {string} accountId
   * @param {string} negativeId
   * @returns {Promise<Record<string, any>>}
   */
  async removeNegative(accountId, negativeId) {
    this.requireAccount(accountId);
    const negative = this.repository.getNegative(negativeId);
    if (negative === undefined) throw new ApiError(404, 'unknown-negative', `unknown negative "${negativeId}"`);
    const { provider } = await this.providerFor(accountId);
    try {
      await provider.deleteEntities('negativeKeywords', 'SP', [negative.id]);
    } catch (error) {
      this.log(`removeNegative: Amazon delete failed for ${negative.id} — ${error instanceof Error ? error.message : String(error)}`);
    }
    this.repository.deleteNegative(negative.id);
    this.repository.audit({ accountId, actor: 'user', action: 'negative.deleted', target: negative.text, detail: { negativeId } });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- *
   * Criteria profiles
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @returns {Record<string, any>}
   */
  listProfiles(accountId) {
    this.requireAccount(accountId);
    const rules = this.repository.listRules(accountId);
    const items = this.repository.listProfiles(accountId).map((profile) => {
      const users = rules.filter((rule) => rule.profileId === profile.id || rule.profiles.some((entry) => entry.profileId === profile.id));
      return {
        ...profile,
        description: profile.description || describeProfile(profile, (key) => key),
        usedBy: users.map((rule) => ({ id: rule.id, name: rule.name, kind: rule.kind })),
      };
    });
    return { items, total: items.length };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  saveProfile(accountId, body) {
    this.requireAccount(accountId);
    const existing = typeof body.id === 'string' && body.id.length > 0 ? this.repository.getProfile(body.id) : undefined;
    const profile = {
      id: existing?.id ?? randomUUID(),
      accountId,
      name: requireString(body.name ?? existing?.name, 'name', 120),
      description: String(body.description ?? existing?.description ?? ''),
      conditions: Array.isArray(body.conditions) ? body.conditions : (existing?.conditions ?? []),
      enabled: body.enabled === undefined ? (existing?.enabled ?? true) : body.enabled !== false,
      createdAt: existing?.createdAt,
    };
    const problems = validateProfile(profile);
    if (problems.length > 0) throw new ApiError(400, 'invalid-profile', 'the criteria profile is invalid', problems);
    const saved = this.repository.putProfile(profile);
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: existing === undefined ? 'profile.created' : 'profile.updated', target: saved.name, detail: { id: saved.id } });
    return saved;
  }

  /**
   * @param {string} accountId
   * @param {string} profileId
   * @returns {Record<string, any>}
   */
  deleteProfile(accountId, profileId) {
    this.requireAccount(accountId);
    const profile = this.repository.getProfile(profileId);
    if (profile === undefined) throw new ApiError(404, 'unknown-profile', `unknown criteria profile "${profileId}"`);
    const users = this.repository.listRules(accountId).filter((rule) => rule.profileId === profileId);
    if (users.length > 0) throw new ApiError(409, 'profile-in-use', `the profile is used by ${users.length} rule(s)`, users.map((rule) => rule.name));
    this.repository.deleteProfile(profileId);
    this.repository.audit({ accountId, actor: 'user', action: 'profile.deleted', target: profile.name, detail: { id: profileId } });
    return { deleted: true };
  }

  /**
   * Seed the starter profiles once per account.
   * @param {string} accountId
   * @returns {Promise<void>}
   */
  async ensureStarterProfiles(accountId) {
    if (this.repository.listProfiles(accountId).length > 0) return;
    for (const starter of starterProfiles()) {
      this.repository.putProfile({
        id: randomUUID(),
        accountId,
        name: starter.name,
        description: starter.description,
        conditions: starter.conditions,
        enabled: true,
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Rules and assignments
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @returns {Record<string, any>}
   */
  listRules(accountId) {
    this.requireAccount(accountId);
    const assignments = this.repository.listAssignments(accountId);
    const profiles = new Map(this.repository.listProfiles(accountId).map((profile) => [profile.id, profile]));
    const items = this.repository.listRules(accountId).map((rule) => ({
      ...rule,
      profile: rule.profileId.length > 0 ? profiles.get(rule.profileId) ?? null : null,
      extraProfiles: rule.profiles.map((entry) => ({ ...entry, profile: profiles.get(entry.profileId) ?? null })),
      assignments: assignments.filter((assignment) => assignment.ruleId === rule.id).length,
      summary: summarizeRule(rule),
    }));
    return { items, total: items.length };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  saveRule(accountId, body) {
    this.requireAccount(accountId);
    const existing = typeof body.id === 'string' && body.id.length > 0 ? this.repository.getRule(body.id) : undefined;
    const kind = String(body.kind ?? existing?.kind ?? '');
    if (!Object.hasOwn(RULE_KINDS, kind)) throw new ApiError(400, 'unknown-kind', `unknown rule kind "${kind}"`, Object.keys(RULE_KINDS));
    const profileId = String(body.profileId ?? existing?.profileId ?? '');
    if (profileId.length > 0 && this.repository.getProfile(profileId) === undefined) {
      throw new ApiError(400, 'unknown-profile', `unknown criteria profile "${profileId}"`);
    }
    const rule = {
      id: existing?.id ?? randomUUID(),
      accountId,
      kind,
      name: requireString(body.name ?? existing?.name ?? RULE_KINDS[kind].label, 'name', 160),
      description: String(body.description ?? existing?.description ?? ''),
      params: normalizeParams(kind, body.params ?? existing?.params ?? {}),
      profileId,
      profiles: Array.isArray(body.profiles) ? body.profiles : (existing?.profiles ?? []),
      priority: Number(body.priority ?? existing?.priority ?? 100),
      enabled: body.enabled === undefined ? (existing?.enabled ?? true) : body.enabled !== false,
      dryRun: body.dryRun === undefined ? (existing?.dryRun ?? false) : body.dryRun === true,
      createdAt: existing?.createdAt,
    };
    const problems = validateRule(rule);
    if (problems.length > 0) throw new ApiError(400, 'invalid-rule', 'the rule is invalid', problems);
    const saved = this.repository.putRule(rule);
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: existing === undefined ? 'rule.created' : 'rule.updated', target: saved.name, detail: { id: saved.id, kind } });
    return saved;
  }

  /**
   * @param {string} accountId
   * @param {string} ruleId
   * @returns {Record<string, any>}
   */
  deleteRule(accountId, ruleId) {
    this.requireAccount(accountId);
    const rule = this.repository.getRule(ruleId);
    if (rule === undefined) throw new ApiError(404, 'unknown-rule', `unknown rule "${ruleId}"`);
    this.repository.deleteRule(ruleId);
    this.repository.audit({ accountId, actor: 'user', action: 'rule.deleted', target: rule.name, detail: { id: ruleId } });
    return { deleted: true };
  }

  /**
   * @param {string} accountId
   * @param {string} ruleId
   * @param {{campaignIds?: string[], adGroupIds?: string[], campaignId?: string, adGroupId?: string, actor?: string}} body
   * @returns {Record<string, any>}
   */
  assign(accountId, ruleId, body) {
    this.requireAccount(accountId);
    const rule = this.repository.getRule(ruleId);
    if (rule === undefined) throw new ApiError(404, 'unknown-rule', `unknown rule "${ruleId}"`);
    const targets = resolveTargets(this.repository, accountId, body);
    if (targets.length === 0) throw new ApiError(400, 'no-targets', 'select at least one campaign or ad group');
    for (const target of targets) {
      this.repository.putAssignment({
        id: randomUUID(),
        accountId,
        ruleId,
        campaignId: target.campaignId,
        adGroupId: target.adGroupId ?? '',
        source: body.source ?? 'manual',
        objectiveId: body.objectiveId ?? '',
      });
    }
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'rule.assigned', target: rule.name, detail: { targets: targets.length } });
    return { assigned: targets.length };
  }

  /**
   * @param {string} accountId
   * @param {string} ruleId
   * @param {{campaignIds?: string[], adGroupIds?: string[], campaignId?: string, adGroupId?: string, actor?: string}} body
   * @returns {Record<string, any>}
   */
  unassign(accountId, ruleId, body) {
    this.requireAccount(accountId);
    const targets = resolveTargets(this.repository, accountId, body);
    const assignments = this.repository.listAssignments(accountId).filter((assignment) => assignment.ruleId === ruleId);
    let removed = 0;
    for (const assignment of assignments) {
      const match = targets.some((target) => target.campaignId === assignment.campaignId && (target.adGroupId ?? '') === assignment.adGroupId);
      if (!match) continue;
      this.repository.deleteAssignment(assignment.id);
      removed += 1;
    }
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'rule.unassigned', target: ruleId, detail: { removed } });
    return { removed };
  }

  /**
   * @param {string} accountId
   * @returns {Record<string, any>}
   */
  listAssignments(accountId) {
    this.requireAccount(accountId);
    const rules = new Map(this.repository.listRules(accountId).map((rule) => [rule.id, rule]));
    const campaigns = new Map(this.repository.listCampaigns(accountId).map((campaign) => [campaign.id, campaign]));
    const adGroups = new Map(this.repository.listAdGroups(accountId).map((adGroup) => [adGroup.id, adGroup]));
    return {
      items: this.repository.listAssignments(accountId).map((assignment) => ({
        ...assignment,
        ruleName: rules.get(assignment.ruleId)?.name ?? '',
        kind: rules.get(assignment.ruleId)?.kind ?? '',
        campaignName: campaigns.get(assignment.campaignId)?.name ?? assignment.campaignId,
        adGroupName: assignment.adGroupId.length === 0 ? '' : (adGroups.get(assignment.adGroupId)?.name ?? assignment.adGroupId),
      })),
    };
  }

  /* ---------------------------------------------------------------- *
   * Strategic objectives
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @returns {Record<string, any>}
   */
  listObjectives(accountId) {
    this.requireAccount(accountId);
    const rules = new Map(this.repository.listRules(accountId).map((rule) => [rule.id, rule]));
    const assignments = this.repository.listAssignments(accountId);
    return {
      presets: STRATEGIC_OBJECTIVES,
      items: this.repository.listObjectives(accountId).map((objective) => ({
        ...objective,
        rules: objective.ruleIds.map((id) => ({ id, name: rules.get(id)?.name ?? '(deleted)', kind: rules.get(id)?.kind ?? '' })),
        assignments: assignments.filter((assignment) => assignment.objectiveId === objective.id).length,
      })),
    };
  }

  /**
   * Create an objective from a preset or from explicit rule ids. A preset
   * expands into real rules and profiles so it behaves exactly like hand-made
   * automation.
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  saveObjective(accountId, body) {
    this.requireAccount(accountId);
    const existing = typeof body.id === 'string' && body.id.length > 0 ? this.repository.listObjectives(accountId).find((entry) => entry.id === body.id) : undefined;
    let ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.map(String) : (existing?.ruleIds ?? []);
    const presetId = String(body.presetId ?? '');
    if (presetId.length > 0 && existing === undefined) {
      const preset = STRATEGIC_OBJECTIVES.find((entry) => entry.id === presetId);
      if (preset === undefined) throw new ApiError(400, 'unknown-preset', `unknown objective preset "${presetId}"`);
      const profileByName = new Map(this.repository.listProfiles(accountId).map((profile) => [profile.name, profile]));
      ruleIds = [];
      for (const spec of preset.rules) {
        let profileId = '';
        if (spec.profile !== undefined) {
          const name = `${preset.name} · ${spec.name}`;
          let profile = profileByName.get(name);
          if (profile === undefined) {
            profile = this.repository.putProfile({
              id: randomUUID(),
              accountId,
              name,
              description: describeProfile(spec.profile, (key) => key),
              conditions: spec.profile.conditions,
              enabled: true,
            });
            profileByName.set(name, profile);
          }
          profileId = profile.id;
        }
        const rule = this.repository.putRule({
          id: randomUUID(),
          accountId,
          kind: spec.kind,
          name: `${preset.name} · ${spec.name}`,
          description: preset.description,
          params: normalizeParams(spec.kind, spec.params ?? {}),
          profileId,
          profiles: [],
          priority: 100,
          enabled: true,
          dryRun: false,
        });
        ruleIds.push(rule.id);
      }
    }
    const objective = {
      id: existing?.id ?? randomUUID(),
      accountId,
      name: requireString(body.name ?? existing?.name ?? 'Objective', 'name', 160),
      description: String(body.description ?? existing?.description ?? ''),
      adType: String(body.adType ?? existing?.adType ?? 'SP'),
      targetingType: String(body.targetingType ?? existing?.targetingType ?? 'MANUAL'),
      ruleIds,
      createdAt: existing?.createdAt,
    };
    const saved = this.repository.putObjective(objective);
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: existing === undefined ? 'objective.created' : 'objective.updated', target: saved.name, detail: { rules: ruleIds.length, presetId } });
    return saved;
  }

  /**
   * Assign every rule of an objective to the selected campaigns.
   * @param {string} accountId
   * @param {string} objectiveId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  assignObjective(accountId, objectiveId, body) {
    this.requireAccount(accountId);
    const objective = this.repository.listObjectives(accountId).find((entry) => entry.id === objectiveId);
    if (objective === undefined) throw new ApiError(404, 'unknown-objective', `unknown objective "${objectiveId}"`);
    const targets = resolveTargets(this.repository, accountId, body);
    if (targets.length === 0) throw new ApiError(400, 'no-targets', 'select at least one campaign or ad group');
    let assigned = 0;
    for (const ruleId of objective.ruleIds) {
      for (const target of targets) {
        this.repository.putAssignment({
          id: randomUUID(),
          accountId,
          ruleId,
          campaignId: target.campaignId,
          adGroupId: target.adGroupId ?? '',
          source: 'objective',
          objectiveId,
        });
        assigned += 1;
      }
    }
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'objective.assigned', target: objective.name, detail: { assigned } });
    return { assigned };
  }

  /**
   * @param {string} accountId
   * @param {string} objectiveId
   * @returns {Record<string, any>}
   */
  deleteObjective(accountId, objectiveId) {
    this.requireAccount(accountId);
    this.repository.deleteObjective(objectiveId);
    this.repository.audit({ accountId, actor: 'user', action: 'objective.deleted', target: objectiveId, detail: {} });
    return { deleted: true };
  }

  /* ---------------------------------------------------------------- *
   * Preview, apply, rollback
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  preview(accountId, body = {}) {
    const account = this.requireAccount(accountId);
    const plan = this.engine.plan(accountId, {
      ruleIds: Array.isArray(body.ruleIds) ? body.ruleIds : undefined,
      campaignId: body.campaignId,
      adGroupId: body.adGroupId,
      settings: body.settings,
      accountDryRun: account.provider === 'sandbox' && account.dryRun !== false,
    });
    return {
      ...plan,
      account: { id: account.id, name: account.name, provider: account.provider, dryRun: account.dryRun !== false },
      previewId: randomUUID(),
      note: 'A preview writes nothing to Amazon. Applying this plan records every change for rollback.',
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async applyPlan(accountId, body = {}) {
    const account = this.requireAccount(accountId);
    const confirmed = body.confirm === true;
    if (!confirmed) throw new ApiError(400, 'confirmation-required', 'pass confirm: true to apply a plan; preview first and review it');
    const plan = body.plan !== undefined && Array.isArray(body.plan?.actions)
      ? body.plan
      : this.engine.plan(accountId, {
        ruleIds: Array.isArray(body.ruleIds) ? body.ruleIds : undefined,
        campaignId: body.campaignId,
        adGroupId: body.adGroupId,
        settings: body.settings,
      });
    if (plan.actions.length === 0) {
      return { run: { id: null, status: 'empty', planned: 0, applied: 0, failed: 0, skipped: 0 }, actions: [] };
    }
    const dryRun = body.dryRun === true;
    return this.engine.apply(accountId, {
      plan,
      trigger: body.trigger ?? 'manual',
      actor: body.actor ?? 'user',
      dryRun,
    });
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  listRuns(accountId, query = {}) {
    this.requireAccount(accountId);
    return {
      items: this.repository.listRuns({ accountId, limit: Number(query.limit ?? 50) }),
    };
  }

  /**
   * @param {string} accountId
   * @param {string} runId
   * @returns {Record<string, any>}
   */
  getRun(accountId, runId) {
    this.requireAccount(accountId);
    const run = this.repository.getRun(runId);
    if (run === undefined) throw new ApiError(404, 'unknown-run', `unknown run "${runId}"`);
    return { run, actions: this.repository.listRunActions(runId) };
  }

  /**
   * @param {string} accountId
   * @param {string} runId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async rollback(accountId, runId, body = {}) {
    this.requireAccount(accountId);
    if (body.confirm !== true) throw new ApiError(400, 'confirmation-required', 'pass confirm: true to roll a run back');
    return this.engine.rollback(runId, { actor: body.actor ?? 'user', onlyActionIds: body.actionIds });
  }

  /* ---------------------------------------------------------------- *
   * Analytics
   * ---------------------------------------------------------------- */

  overview(accountId, query) {
    this.requireAccount(accountId);
    return this.analytics.overview(accountId, query);
  }

  breakdown(accountId, query) {
    this.requireAccount(accountId);
    return { items: this.analytics.breakdown(accountId, query) };
  }

  words(accountId, query) {
    this.requireAccount(accountId);
    return { items: this.analytics.wordPerformance(accountId, query) };
  }

  deadKeywords(accountId, query) {
    this.requireAccount(accountId);
    return { items: this.analytics.deadKeywords(accountId, query) };
  }

  placements(accountId, query) {
    this.requireAccount(accountId);
    return { items: this.analytics.placements(accountId, query) };
  }

  attribution(accountId, query) {
    this.requireAccount(accountId);
    return this.analytics.attribution(accountId, query);
  }

  restock(accountId, query) {
    this.requireAccount(accountId);
    return { items: this.analytics.restock(accountId, query) };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  searchTerms(accountId, query) {
    this.requireAccount(accountId);
    const { start, end } = rangeOf(query);
    const rows = this.repository.aggregateSearchTerms(accountId, {
      start,
      end,
      campaignId: query.campaignId,
      adGroupId: query.adGroupId,
      search: query.search,
      limit: Number(query.limit ?? 300),
    });
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        text: String(row.text),
        campaignId: String(row.campaignId ?? ''),
        adGroupId: String(row.adGroupId ?? ''),
        adGroupCount: Number(row.adGroupCount ?? 1),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        spend: Number(row.spend ?? 0),
        sales: Number(row.sales ?? 0),
        orders: Number(row.orders ?? 0),
        units: Number(row.units ?? 0),
      })),
      window: { start, end },
    };
  }

  /**
   * Hour-of-day and day-of-week performance for the dayparting heatmap.
   * @param {string} accountId
   * @param {Record<string, any>} query
   * @returns {Record<string, any>}
   */
  heatmap(accountId, query = {}) {
    const account = this.requireAccount(accountId);
    const { start, end } = rangeOf(query);
    const entityId = (query.adGroupId !== undefined && query.adGroupId !== '' ? query.adGroupId : query.campaignId) ?? undefined;
    const rows = this.repository.hourlyHeatmap(accountId, {
      entityId,
      entityType: entityId === undefined ? undefined : (query.adGroupId !== undefined && query.adGroupId !== '' ? 'adGroup' : 'campaign'),
      start,
      end,
    });
    const byHour = this.repository.hourlyByHour(accountId, { entityId, start, end });
    const local = localParts(new Date(), account.timezone);
    return {
      cells: rows,
      byHour,
      window: { start, end },
      timezone: account.timezone,
      currentHour: local.hour,
      hasData: rows.length > 0,
    };
  }

  listProducts(accountId) {
    this.requireAccount(accountId);
    return { items: this.repository.listProducts(accountId) };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  saveProduct(accountId, body) {
    this.requireAccount(accountId);
    const asin = requireString(body.asin, 'asin', 20).toUpperCase();
    this.repository.putProduct(accountId, {
      asin,
      sku: String(body.sku ?? ''),
      title: String(body.title ?? ''),
      price: body.price === undefined ? null : Number(body.price),
      cogs: body.cogs === undefined ? null : Number(body.cogs),
      fbaFee: body.fbaFee === undefined ? null : Number(body.fbaFee),
      leadTimeDays: Number(body.leadTimeDays ?? 0),
      active: body.active !== false,
    });
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'product.saved', target: asin, detail: {} });
    return { ok: true, asin };
  }

  /* ---------------------------------------------------------------- *
   * Mass campaigns
   * ---------------------------------------------------------------- */

  massPreview(accountId, body) {
    this.requireAccount(accountId);
    const plans = this.mass.plan(accountId, body);
    return {
      plans,
      total: plans.length,
      note: 'Preview only. Campaigns are created PAUSED unless state is ENABLED.',
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async massCreate(accountId, body) {
    this.requireAccount(accountId);
    if (body.confirm !== true) throw new ApiError(400, 'confirmation-required', 'pass confirm: true to create the campaigns');
    return this.mass.create(accountId, body, { dryRun: body.dryRun === true, actor: body.actor ?? 'user' });
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async massUndo(accountId, body) {
    this.requireAccount(accountId);
    if (body.confirm !== true) throw new ApiError(400, 'confirmation-required', 'pass confirm: true to delete the campaigns');
    return this.mass.undo(accountId, { campaignIds: body.campaignIds, actor: body.actor ?? 'user', dryRun: body.dryRun === true });
  }

  /* ---------------------------------------------------------------- *
   * Schedules, audit, settings
   * ---------------------------------------------------------------- */

  listSchedules(accountId) {
    this.requireAccount(accountId);
    const adGroups = new Map(this.repository.listAdGroups(accountId).map((adGroup) => [adGroup.id, adGroup]));
    return {
      items: this.repository.listSchedules(accountId).map((schedule) => ({
        ...schedule,
        adGroupName: adGroups.get(schedule.adGroupId)?.name ?? schedule.adGroupId,
      })),
    };
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} body
   * @returns {Record<string, any>}
   */
  saveSchedule(accountId, body) {
    const account = this.requireAccount(accountId);
    const adGroupId = requireString(body.adGroupId, 'adGroupId', 200);
    const adGroup = this.repository.getAdGroup(adGroupId);
    if (adGroup === undefined) throw new ApiError(404, 'unknown-ad-group', `unknown ad group "${adGroupId}"`);
    const hours = Array.isArray(body.hours) ? body.hours.map((entry) => ({
      hour: clampInt(entry.hour, 0, 23, 0),
      enabled: entry.enabled !== false,
      modifier: clampNumber(entry.modifier, -90, 900, 0),
    })) : [];
    const saved = this.repository.putSchedule({
      id: randomUUID(),
      accountId,
      adGroupId,
      campaignId: adGroup.campaignId,
      timezone: account.timezone,
      hours,
      mode: body.mode === 'optimum' ? 'optimum' : 'schedule',
      ruleId: String(body.ruleId ?? ''),
      enabled: body.enabled !== false,
    });
    this.repository.audit({ accountId, actor: body.actor ?? 'user', action: 'schedule.saved', target: adGroup.name, detail: { hours: hours.length } });
    return { ok: true, id: saved.id };
  }

  /**
   * @param {string} accountId
   * @param {string} scheduleId
   * @returns {Record<string, any>}
   */
  deleteSchedule(accountId, scheduleId) {
    this.requireAccount(accountId);
    this.repository.deleteSchedule(scheduleId);
    this.repository.audit({ accountId, actor: 'user', action: 'schedule.deleted', target: scheduleId, detail: {} });
    return { deleted: true };
  }

  listAudit(query = {}) {
    return this.repository.listAudit({
      accountId: query.accountId,
      action: query.action,
      limit: Number(query.limit ?? 100),
      offset: Number(query.offset ?? 0),
    });
  }

  getSettings() {
    return this.settings();
  }

  /**
   * @param {Record<string, any>} body
   * @returns {Promise<Record<string, any>>}
   */
  async saveSettings(body) {
    const current = this.settings();
    const next = {
      ...current,
      autoApply: body.autoApply === undefined ? current.autoApply : body.autoApply === true,
      schedule: {
        ...current.schedule,
        ...(body.schedule ?? {}),
      },
      defaults: {
        ...current.defaults,
        ...(body.defaults ?? {}),
      },
    };
    await this.persistSettings(next);
    this.scheduler.configure(next.schedule);
    this.repository.audit({ actor: body.actor ?? 'user', action: 'settings.saved', target: 'plugin', detail: { autoApply: next.autoApply } });
    return next;
  }

  /**
   * Run one scheduler pass now, for the UI's "run now" control and for tests.
   * @param {Record<string, any>} [body]
   * @returns {Promise<Record<string, any>>}
   */
  async tickScheduler(body = {}) {
    const result = await this.scheduler.tick(new Date());
    this.repository.audit({ actor: body.actor ?? 'user', action: 'scheduler.ticked', target: 'plugin', detail: result });
    return result;
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  /**
   * @param {string} accountId
   * @returns {Record<string, any>}
   */
  requireAccount(accountId) {
    const account = this.repository.getAccount(accountId);
    if (account === undefined) throw new ApiError(404, 'unknown-account', `unknown account "${accountId}"`);
    return account;
  }
}

/**
 * @param {string} accountId
 * @param {Record<string, any>} query
 * @returns {[string, string, string]}
 */
function rangeOf(query = {}) {
  if (typeof query.start === 'string' && query.start.length > 0 && typeof query.end === 'string' && query.end.length > 0) {
    return { start: query.start, end: query.end };
  }
  const days = Math.max(1, Math.min(365, Number(query.days ?? 30)));
  const range = windowDates({ daysToAnalyze: days, daysToIgnore: 0 });
  return { start: range.start, end: range.end };
}

/**
 * @param {import('./repository.js').Repository} repository
 * @param {string} accountId
 * @param {Record<string, any>} body
 * @returns {Array<{campaignId: string, adGroupId?: string}>}
 */
function resolveTargets(repository, accountId, body) {
  /** @type {Array<{campaignId: string, adGroupId?: string}>} */
  const targets = [];
  if (typeof body.adGroupId === 'string' && body.adGroupId.length > 0) {
    const adGroup = repository.getAdGroup(body.adGroupId);
    if (adGroup === undefined) throw new ApiError(404, 'unknown-ad-group', `unknown ad group "${body.adGroupId}"`);
    targets.push({ campaignId: adGroup.campaignId, adGroupId: adGroup.id });
    return targets;
  }
  if (Array.isArray(body.adGroupIds) && body.adGroupIds.length > 0) {
    for (const id of body.adGroupIds.map(String)) {
      const adGroup = repository.getAdGroup(id);
      if (adGroup === undefined) throw new ApiError(404, 'unknown-ad-group', `unknown ad group "${id}"`);
      targets.push({ campaignId: adGroup.campaignId, adGroupId: adGroup.id });
    }
    return targets;
  }
  if (typeof body.campaignId === 'string' && body.campaignId.length > 0) {
    const campaign = repository.getCampaign(body.campaignId);
    if (campaign === undefined) throw new ApiError(404, 'unknown-campaign', `unknown campaign "${body.campaignId}"`);
    targets.push({ campaignId: campaign.id });
    return targets;
  }
  if (Array.isArray(body.campaignIds) && body.campaignIds.length > 0) {
    for (const id of body.campaignIds.map(String)) {
      const campaign = repository.getCampaign(id);
      if (campaign === undefined) throw new ApiError(404, 'unknown-campaign', `unknown campaign "${id}"`);
      targets.push({ campaignId: campaign.id });
    }
    return targets;
  }
  return targets;
}

/**
 * @param {Record<string, any>} rule
 * @returns {string[]}
 */
export function validateRule(rule) {
  const problems = [];
  if (rule.name.trim().length === 0) problems.push('name is required');
  if (rule.kind === 'bidding') {
    if (!Number.isFinite(Number(rule.params.targetAcos)) || Number(rule.params.targetAcos) <= 0) problems.push('targetAcos must be a positive number');
  }
  if (rule.kind === 'dayparting') {
    if (rule.params.mode === 'schedule') {
      const start = Number(rule.params.startHour);
      const end = Number(rule.params.endHour);
      if (!Number.isFinite(start) || start < 0 || start > 23) problems.push('startHour must be 0-23');
      if (!Number.isFinite(end) || end < 1 || end > 24) problems.push('endHour must be 1-24');
    }
  }
  if (rule.kind === 'placement') {
    if (!['topOfSearch', 'productPage', 'restOfSearch'].includes(String(rule.params.placement))) problems.push('placement must be topOfSearch, productPage, or restOfSearch');
  }
  if (rule.kind === 'status') {
    if (!['campaign', 'adGroup'].includes(String(rule.params.target))) problems.push('target must be campaign or adGroup');
    if (!['pause', 'enable'].includes(String(rule.params.action))) problems.push('action must be pause or enable');
  }
  if (rule.kind === 'dailyBudget' && rule.params.maxBudget !== null && rule.params.maxBudget !== undefined) {
    if (Number(rule.params.maxBudget) < Number(rule.params.minBudget ?? 0)) problems.push('maxBudget must not be below minBudget');
  }
  return problems;
}

/**
 * @param {Record<string, any>} rule
 * @returns {string}
 */
function summarizeRule(rule) {
  const params = rule.params ?? {};
  switch (rule.kind) {
    case 'bidding':
      return `Target ${params.targetAcos}% ACOS, max ${params.maxChangePercent}% per run`;
    case 'dayparting':
      return params.mode === 'optimum'
        ? 'Optimum hours from hourly performance'
        : `Active ${String(params.startHour).padStart(2, '0')}:00–${String(params.endHour).padStart(2, '0')}:00`;
    case 'import':
      return `Harvest from ${params.source} as ${params.matchType} at ${params.bidPercentOfCpc}% of CPC`;
    case 'negative':
      return `Negate from ${params.source} as ${params.matchType}`;
    case 'negativeWord':
      return `Negate words as ${params.matchType}`;
    case 'blacklist':
      return `${(params.negativeExact ?? []).length} exact + ${(params.negativePhrase ?? []).length} phrase terms`;
    case 'revive':
      return `Revive toward ${params.targetAcos}% ACOS, ${params.maxChangePercent}% steps`;
    case 'defaultBid':
      return `Default bid toward ${params.targetAcos}% ACOS`;
    case 'status':
      return `${params.action === 'enable' ? 'Enable' : 'Pause'} ${params.target === 'campaign' ? 'campaigns' : 'ad groups'} on criteria`;
    case 'dailyBudget':
      return `Day-of-week budget${params.baseline === null ? '' : ` from ${params.baseline}`}`;
    case 'placement':
      return `${params.placement} → ${params.targetModifier}%`;
    default:
      return '';
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function requireString(value, field, max) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError(400, 'missing-field', `${field} is required`);
  if (value.length > max) throw new ApiError(400, 'field-too-long', `${field} must be at most ${max} characters`);
  return value.trim();
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(Math.max(number, min), max));
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

export { defaultParams };
