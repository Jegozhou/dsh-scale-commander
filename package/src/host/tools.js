/**
 * Agent tools.
 *
 * A thin, typed surface over ScaleService so the model can inspect accounts,
 * preview a plan, apply it after the person confirms, and read the audit trail.
 * Tools never bypass validation: every one calls the same service method the
 * browser calls.
 *
 * `tools.register` is a global registration, so the tools are visible to every
 * agent in the profile that can see plugin tools.
 * @module host/tools
 */

import { RULE_KINDS } from '../shared/domain.js';

/**
 * Register every tool; returns the disposers.
 * @param {any} ctx
 * @param {{service: import('./service.js').ScaleService, repository: import('./repository.js').Repository}} deps
 * @returns {Array<() => void>}
 */
export function registerTools(ctx, deps) {
  if (typeof ctx.tools?.register !== 'function') return [];
  // A composition without a tool registry keeps the web surface and the
  // scheduler; only the agent tools disappear.
  const { service } = deps;
  /** @type {Array<() => void>} */
  const disposers = [];

  /**
   * @param {object} definition
   * @param {(args: any) => Promise<unknown>} run
   * @param {string} title
   */
  const tool = (definition, run, title) => {
    disposers.push(ctx.tools.register({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: {
        schema: definition.output ?? {},
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      presentCall: (args) => ({ card: 'generic', title, kind: 'other', rawInput: args }),
      async execute(args) {
        try {
          return await run(args);
        } catch (error) {
          return {
            error: {
              code: error?.code ?? 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    }));
  };

  tool({
    name: 'scale_commander_accounts',
    description: 'List the Amazon advertising accounts Scale Commander manages, with connection status, campaign and rule counts, and the marketplace. Use it first to find the account id every other tool needs.',
    parameters: {},
    output: {},
  }, async () => ({ accounts: service.listAccounts() }), 'List Scale Commander accounts');

  tool({
    name: 'scale_commander_overview',
    description: 'Read the performance overview for one account: spend, sales, ACOS, ROAS, orders, CTR, CVR, TACOS and profit for a window, plus the previous window for comparison. Read-only.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id from scale_commander_accounts.' },
      days: { type: 'number', description: 'Window length in days (default 30, max 365).' },
    },
    output: {},
  }, async (args) => service.overview(requireArg(args, 'account_id'), { days: Number(args.days ?? 30) }), 'Account overview');

  tool({
    name: 'scale_commander_preview',
    description: 'Evaluate every enabled rule in scope and return the exact actions it would take, with the step-by-step calculation behind each one. Writes nothing to Amazon. Always preview before applying.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      campaign_id: { type: 'string', description: 'Limit the preview to one campaign.' },
      ad_group_id: { type: 'string', description: 'Limit the preview to one ad group.' },
      rule_ids: { type: 'array', items: { type: 'string' }, description: 'Limit the preview to these rule ids.' },
      limit: { type: 'number', description: 'Maximum actions to return (default 100).' },
    },
    output: {},
  }, async (args) => {
    const plan = service.preview(requireArg(args, 'account_id'), {
      campaignId: args.campaign_id,
      adGroupId: args.ad_group_id,
      ruleIds: args.rule_ids,
    });
    const limit = Math.max(1, Math.min(500, Number(args.limit ?? 100)));
    return {
      previewId: plan.previewId,
      generatedAt: plan.generatedAt,
      planned: plan.actions.length,
      returned: Math.min(limit, plan.actions.length),
      rules: plan.rules,
      skippedRules: plan.skippedRules,
      actions: plan.actions.slice(0, limit).map((action) => ({
        id: action.id,
        rule: action.ruleName,
        kind: action.kind,
        entity: action.entityName,
        before: action.before,
        after: action.after,
        reason: action.reason,
        calculation: action.calculation,
      })),
      note: plan.note,
    };
  }, 'Preview automation changes');

  tool({
    name: 'scale_commander_apply',
    description: 'Apply a previewed plan to Amazon. Every change is recorded with its before/after values so it can be rolled back. Requires confirm: true, which the person must ask for explicitly.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      confirm: { type: 'boolean', required: true, description: 'Must be true; confirms the person approved the plan.' },
      preview_id: { type: 'string', description: 'The previewId returned by scale_commander_preview, for the audit trail.' },
      campaign_id: { type: 'string', description: 'Limit the apply to one campaign.' },
      rule_ids: { type: 'array', items: { type: 'string' }, description: 'Limit the apply to these rule ids.' },
      dry_run: { type: 'boolean', description: 'Record the plan without sending it to Amazon.' },
    },
    output: {},
  }, async (args) => {
    if (args.confirm !== true) return { error: { code: 'confirmation-required', message: 'pass confirm: true after the person approves the preview' } };
    const result = await service.applyPlan(requireArg(args, 'account_id'), {
      confirm: true,
      campaignId: args.campaign_id,
      ruleIds: args.rule_ids,
      dryRun: args.dry_run === true,
      trigger: 'agent',
      actor: 'agent',
    });
    return {
      runId: result.run.id,
      status: result.run.status,
      planned: result.run.planned,
      applied: result.run.applied,
      failed: result.run.failed,
      skipped: result.run.skipped,
      summary: result.run.summary,
      actions: result.actions.slice(0, 50).map((action) => ({
        entity: action.entityName,
        kind: action.kind,
        before: action.before,
        after: action.after,
        status: action.status,
        error: action.error || undefined,
      })),
      rollback: result.run.id === null ? undefined : `scale_commander_rollback with run_id ${result.run.id}`,
    };
  }, 'Apply automation changes');

  tool({
    name: 'scale_commander_rollback',
    description: 'Undo the applied actions of one run, restoring the recorded before value of every change, newest first. Requires confirm: true.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      run_id: { type: 'string', required: true, description: 'Run id from scale_commander_apply or scale_commander_runs.' },
      confirm: { type: 'boolean', required: true, description: 'Must be true.' },
    },
    output: {},
  }, async (args) => {
    if (args.confirm !== true) return { error: { code: 'confirmation-required', message: 'pass confirm: true to roll back' } };
    return service.rollback(requireArg(args, 'account_id'), requireArg(args, 'run_id'), { confirm: true, actor: 'agent' });
  }, 'Roll back a run');

  tool({
    name: 'scale_commander_runs',
    description: 'List automation runs for an account, newest first, with counts of planned, applied and failed actions. Use it to find a run id for rollback or inspection.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      limit: { type: 'number', description: 'Maximum runs to return (default 20).' },
    },
    output: {},
  }, async (args) => service.listRuns(requireArg(args, 'account_id'), { limit: Number(args.limit ?? 20) }), 'List automation runs');

  tool({
    name: 'scale_commander_rules',
    description: 'List the automation rules in an account with their parameters, criteria profile, assignment count and one-line summary. Read-only.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
    },
    output: {},
  }, async (args) => {
    const result = service.listRules(requireArg(args, 'account_id'));
    return { rules: result.items.map((rule) => ({
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      kindLabel: RULE_KINDS[rule.kind]?.label ?? rule.kind,
      enabled: rule.enabled,
      dryRun: rule.dryRun,
      summary: rule.summary,
      assignments: rule.assignments,
      profile: rule.profile?.name ?? null,
      params: rule.params,
    })) };
  }, 'List automation rules');

  tool({
    name: 'scale_commander_create_rule',
    description: 'Create an automation rule. Kinds: bidding, dayparting, import, negative, negativeWord, blacklist, revive, defaultBid, status, dailyBudget, placement. Returns the rule id for scale_commander_assign.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      kind: { type: 'string', required: true, description: 'Rule kind.' },
      name: { type: 'string', required: true, description: 'Rule name.' },
      params: { type: 'object', additionalProperties: true, description: 'Rule parameters object; defaults apply for omitted fields.' },
      profile_id: { type: 'string', description: 'Criteria profile id to attach.' },
      enabled: { type: 'boolean', description: 'Whether the rule runs (default true).' },
      dry_run: { type: 'boolean', description: 'Record the rule but never apply it.' },
    },
    output: {},
  }, async (args) => {
    const saved = service.saveRule(requireArg(args, 'account_id'), {
      kind: requireArg(args, 'kind'),
      name: requireArg(args, 'name'),
      params: args.params ?? {},
      profileId: args.profile_id,
      enabled: args.enabled !== false,
      dryRun: args.dry_run === true,
      actor: 'agent',
    });
    return { id: saved.id, name: saved.name, kind: saved.kind, params: saved.params };
  }, 'Create automation rule');

  tool({
    name: 'scale_commander_assign',
    description: 'Assign a rule to campaigns or ad groups. Pass exactly one of campaign_id, campaign_ids, ad_group_id, or ad_group_ids.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      rule_id: { type: 'string', required: true, description: 'Rule id.' },
      campaign_id: { type: 'string', description: 'One campaign.' },
      campaign_ids: { type: 'array', items: { type: 'string' }, description: 'Several campaigns.' },
      ad_group_id: { type: 'string', description: 'One ad group.' },
      ad_group_ids: { type: 'array', items: { type: 'string' }, description: 'Several ad groups.' },
    },
    output: {},
  }, async (args) => service.assign(requireArg(args, 'account_id'), requireArg(args, 'rule_id'), {
    campaignId: args.campaign_id,
    campaignIds: args.campaign_ids,
    adGroupId: args.ad_group_id,
    adGroupIds: args.ad_group_ids,
    actor: 'agent',
  }), 'Assign rule');

  tool({
    name: 'scale_commander_insights',
    description: 'Read a performance breakdown: campaigns, ad groups, keywords, targets, search terms, or unique words. Use it to find waste, winners and dead keywords before writing rules.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      level: { type: 'string', required: true, description: 'campaign | adGroup | keyword | target | searchTerm | word' },
      days: { type: 'number', description: 'Window length in days (default 30).' },
      sort: { type: 'string', description: 'Metric to sort by, e.g. spend, sales, acos, clicks (default spend).' },
      limit: { type: 'number', description: 'Rows to return (default 25).' },
      search: { type: 'string', description: 'Substring filter on the row name.' },
    },
    output: {},
  }, async (args) => {
    const accountId = requireArg(args, 'account_id');
    const level = requireArg(args, 'level');
    const limit = Math.max(1, Math.min(200, Number(args.limit ?? 25)));
    const query = { days: Number(args.days ?? 30), sort: args.sort, limit, search: args.search };
    if (level === 'word') return { level, rows: service.words(accountId, query).items };
    if (level === 'searchTerm') return { level, rows: service.breakdown(accountId, { ...query, level: 'searchTerm' }).items };
    if (!['campaign', 'adGroup', 'keyword', 'target'].includes(level)) {
      return { error: { code: 'bad-level', message: `level must be campaign, adGroup, keyword, target, searchTerm, or word` } };
    }
    return { level, rows: service.breakdown(accountId, { ...query, level }).items };
  }, 'Read performance breakdown');

  tool({
    name: 'scale_commander_audit',
    description: 'Read the audit log: every configuration change, sync, preview, apply, rollback and scheduler tick, with actor and detail.',
    parameters: {
      account_id: { type: 'string', description: 'Limit to one account.' },
      limit: { type: 'number', description: 'Entries to return (default 50).' },
      offset: { type: 'number', description: 'Pagination offset.' },
    },
    output: {},
  }, async (args) => service.listAudit({
    accountId: args.account_id,
    limit: Number(args.limit ?? 50),
    offset: Number(args.offset ?? 0),
  }), 'Read audit log');

  tool({
    name: 'scale_commander_sync',
    description: 'Pull the latest campaigns, metrics, search terms and hourly performance from Amazon into the local store. Run it before a preview when the data may be stale.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id.' },
      days: { type: 'number', description: 'History to fetch on the first sync (default 90).' },
    },
    output: {},
  }, async (args) => service.sync(requireArg(args, 'account_id'), { days: Number(args.days ?? 90) }), 'Sync account data');

  return disposers;
}

/**
 * @param {Record<string, unknown>} args
 * @param {string} key
 * @returns {string}
 */
function requireArg(args, key) {
  const value = args?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} is required`);
  return value.trim();
}
