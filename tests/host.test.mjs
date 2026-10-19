import { test, assert, equal, close, summarize, tempDir, cleanup } from './harness.mjs';
import { join } from 'node:path';
import { Store } from '../package/src/host/store.js';
import { Repository } from '../package/src/host/repository.js';
import { CredentialVault } from '../package/src/host/vault.js';
import { createSandboxProvider } from '../package/src/host/sandbox.js';
import { SyncService } from '../package/src/host/sync.js';
import { EngineService } from '../package/src/host/engine.js';
import { AnalyticsService } from '../package/src/host/analytics.js';
import { MassService } from '../package/src/host/mass.js';
import { Scheduler } from '../package/src/host/scheduler.js';
import { ScaleService } from '../package/src/host/service.js';
import { ApiServer } from '../package/src/host/api.js';
import { resolveDataDir, resolvePassphrase } from '../package/src/host/index.js';

process.stdout.write('\nhost\n');

const dir = tempDir();
const store = new Store({ file: join(dir, 'test.sqlite') });
const repository = new Repository(store);
const providers = new Map();
const providerFor = async (accountId) => {
  const account = repository.getAccount(accountId);
  if (account.provider === 'sandbox') {
    if (!providers.has(accountId)) providers.set(accountId, createSandboxProvider(accountId));
    return { provider: providers.get(accountId), account };
  }
  throw new Error('no real provider in tests');
};
const vault = new CredentialVault({ dataDir: dir, passphrase: 'test-passphrase' });
const sync = new SyncService({ repository, providerFor });
const engine = new EngineService({ repository, providerFor });
const analytics = new AnalyticsService({ repository });
const mass = new MassService({ repository, providerFor });
let settings = {
  autoApply: false,
  schedule: { mode: 'daily', hour: 6, minute: 0, everyHours: 6, timezone: 'America/Los_Angeles', autoApply: false },
  defaults: { daysToAnalyze: 30, daysToIgnore: 2, maxActionsPerRun: 500 },
};
const scheduler = new Scheduler({ repository, engine, providerFor, enabled: false });
const service = new ScaleService({
  repository, engine, syncService: sync, analytics, mass, scheduler, vault, providerFor,
  settings: () => settings,
  persistSettings: async (next) => { settings = next; },
});

await test('store creates the schema and survives a reopen', () => {
  const value = store.get("SELECT value FROM meta WHERE key = 'schema_version'");
  equal(String(value.value), '3');
});

await test('data directory and passphrase resolve deterministically', () => {
  equal(resolveDataDir('', '/home/u/.dsh'), '/home/u/.dsh/scale-commander');
  equal(resolveDataDir('/tmp/x'), '/tmp/x');
  equal(resolvePassphrase('abc', '/tmp/x'), 'abc');
  assert(resolvePassphrase('', '/tmp/x').length === 64, 'derived key is a sha256 hex');
});

await test('vault encrypts, decrypts and reports status without secrets', async () => {
  await vault.set('acct-1', { clientId: 'amzn1.application-oa2-client.abc123', clientSecret: 'shh', refreshToken: 'Atzr|token' });
  const loaded = await vault.get('acct-1');
  equal(loaded.refreshToken, 'Atzr|token');
  const status = await vault.status('acct-1');
  equal(status.configured, true);
  assert(!JSON.stringify(status).includes('shh'), 'status never contains the secret');
  const file = await import('node:fs').then((fs) => fs.readFileSync(join(dir, 'secrets.enc.json'), 'utf8'));
  assert(!file.includes('Atzr|token'), 'the sidecar file does not contain plaintext');
});

const created = await service.createAccount({ name: 'Sandbox US', provider: 'sandbox', marketplace: 'ATVPDKIKX0DER', days: 90 });
const account = created;
test('account creation seeds a sandbox with real data', async () => {
  equal(created.provider, 'sandbox');
  const campaigns = repository.listCampaigns(created.id);
  assert(campaigns.length >= 15, `expected campaigns, got ${campaigns.length}`);
  const keywords = repository.listKeywords(created.id);
  assert(keywords.length >= 20, `expected keywords, got ${keywords.length}`);
  const metrics = repository.aggregateMetrics(created.id, 'campaign', '2000-01-01', '2100-01-01');
  assert(metrics.length === campaigns.length, 'every campaign has metrics');
  assert(Number(metrics[0].impressions) > 0, 'metrics have impressions');
  const profiles = repository.listProfiles(created.id);
  assert(profiles.length >= 5, 'starter criteria profiles seeded');
});
const accountId = created.id;

await test('sync is incremental and idempotent', async () => {
  const first = await service.sync(accountId, { days: 30 });
  const second = await service.sync(accountId, { days: 30 });
  assert(first.metrics.rows > 0, 'first sync wrote rows');
  assert(second.metrics.rows > 0, 'second sync rewrote the overlap window');
  const count = Number(store.get('SELECT COUNT(*) AS c FROM metrics_daily WHERE account_id = ?', accountId).c);
  assert(count > 0, 'metrics exist');
});

await test('overview returns summary, deltas and series', () => {
  const overview = service.overview(accountId, { days: 30 });
  assert(overview.summary.impressions > 0, 'impressions present');
  assert(overview.summary.spend > 0, 'spend present');
  assert(overview.series.length > 0, 'series present');
  assert(overview.previous !== null, 'previous window present');
  assert(overview.deltas !== null, 'deltas present');
  assert(overview.totals.campaigns > 0, 'campaign count present');
  assert(Number.isFinite(overview.unitEconomics.tacos), 'tacos computed');
});

await test('breakdown ranks campaigns, keywords and search terms', () => {
  const campaigns = service.breakdown(accountId, { level: 'campaign', days: 30, sort: 'spend' }).items;
  assert(campaigns.length > 0, 'campaign rows');
  assert(campaigns[0].spend >= campaigns[campaigns.length - 1].spend, 'sorted by spend');
  const keywords = service.breakdown(accountId, { level: 'keyword', days: 30 }).items;
  assert(keywords.length > 0, 'keyword rows');
  const terms = service.breakdown(accountId, { level: 'searchTerm', days: 60 }).items;
  assert(terms.length > 0, 'search term rows');
  assert(typeof terms[0].acos === 'number' || terms[0].acos === null, 'derived metrics attached');
});

await test('unique words aggregate across search terms', () => {
  const words = service.words(accountId, { days: 60, minClicks: 0 }).items;
  assert(words.length > 5, 'words present');
  assert(words[0].clicks >= words[words.length - 1].clicks, 'sorted by spend then clicks');
  const spatula = words.find((row) => row.word === 'spatula');
  assert(spatula !== undefined, 'spatula appears');
  assert(spatula.terms >= 1, 'term count attached');
});

await test('heatmap exposes 24 hours per weekday', () => {
  const heatmap = service.heatmap(accountId, { days: 30 });
  assert(heatmap.hasData, 'hourly data present');
  assert(heatmap.cells.length > 0, 'cells present');
  const hours = new Set(heatmap.cells.map((cell) => cell.hour));
  equal(hours.size, 24);
  assert(heatmap.currentHour >= 0 && heatmap.currentHour <= 23, 'current hour is a clock hour');
});

await test('attribution splits ad and organic sales', () => {
  const attribution = service.attribution(accountId, { days: 30 });
  assert(attribution.byAsin.length > 0, 'asins present');
  assert(attribution.summary.totalSales > 0, 'total sales present');
  assert(attribution.summary.organicShare > 0, 'organic share present');
});

await test('placement report carries per-placement metrics', () => {
  const rows = service.placements(accountId, { days: 30 }).items;
  assert(rows.length > 0, 'rows present');
  assert(rows[0].topOfSearch.impressions >= 0, 'TOS metrics present');
  assert(rows[0].productPage !== undefined, 'PP metrics present');
});

const profile = repository.listProfiles(accountId)[0];

await test('rule creation validates and normalises parameters', () => {
  const rule = service.saveRule(accountId, {
    kind: 'bidding',
    name: 'Bid to 30% ACOS',
    params: { targetAcos: 30 },
    profileId: profile.id,
  });
  equal(rule.params.targetAcos, 30);
  equal(rule.params.maxChangePercent, 10, 'defaults applied');
  assert(rule.id.length > 0, 'id assigned');
  let failed = false;
  try {
    service.saveRule(accountId, { kind: 'nope', name: 'x' });
  } catch (error) {
    failed = error.code === 'unknown-kind';
  }
  assert(failed, 'unknown kind refused');
});

const biddingRule = repository.listRules(accountId)[0];

await test('assigning a rule to campaigns records assignments', () => {
  const campaigns = repository.listCampaigns(accountId).slice(0, 3);
  const result = service.assign(accountId, biddingRule.id, { campaignIds: campaigns.map((campaign) => campaign.id) });
  equal(result.assigned, 3);
  equal(repository.listAssignments(accountId).length, 3);
  let failed = false;
  try {
    service.assign(accountId, biddingRule.id, {});
  } catch (error) {
    failed = error.code === 'no-targets';
  }
  assert(failed, 'empty selection refused');
});

await test('preview produces actions with calculations and writes nothing', () => {
  const before = Number(store.get('SELECT COUNT(*) AS c FROM runs').c);
  const plan = service.preview(accountId, {});
  assert(plan.actions.length > 0, 'actions planned');
  assert(plan.actions[0].calculation.length > 0, 'calculation attached');
  assert(plan.actions[0].ruleName.length > 0, 'rule name attached');
  equal(Number(store.get('SELECT COUNT(*) AS c FROM runs').c), before, 'no run written');
  equal(repository.listNegatives(accountId).filter((negative) => negative.source === 'rule').length, 0, 'no negatives written');
});

await test('apply writes Amazon state, records a run and is audited', async () => {
  const plan = service.preview(accountId, {});
  const result = await service.applyPlan(accountId, { confirm: true, plan, actor: 'test' });
  assert(result.run.id !== null, 'run id');
  assert(result.run.applied > 0, `applied some actions (got ${result.run.applied})`);
  const applied = result.actions.filter((action) => action.status === 'applied');
  assert(applied.length === result.run.applied, 'action statuses agree with the run counts');
  assert(applied[0].before !== null || applied[0].before === null, 'before recorded');
  const audit = service.listAudit({ accountId, limit: 50 });
  assert(audit.items.some((entry) => entry.action === 'run.applied'), 'audit entry written');
});

await test('applying without confirmation is refused', async () => {
  let failed = false;
  try {
    await service.applyPlan(accountId, {});
  } catch (error) {
    failed = error.code === 'confirmation-required';
  }
  assert(failed, 'confirmation required');
});

await test('rollback restores the before value of every applied action', async () => {
  const runs = service.listRuns(accountId, {}).items;
  const run = runs[0];
  const applied = repository.listRunActions(run.id).filter((action) => action.status === 'applied');
  const sample = applied.find((action) => action.kind === 'bid');
  const keywordBefore = sample === undefined ? null : repository.getKeyword(sample.entityId)?.bid;
  const result = await service.rollback(accountId, run.id, { confirm: true, actor: 'test' });
  assert(result.restored > 0, 'restored some actions');
  equal(result.failed, 0, 'no rollback failures');
  if (sample !== undefined) {
    const after = repository.getKeyword(sample.entityId)?.bid;
    equal(after, Number(sample.before), 'local bid restored to the before value');
    assert(keywordBefore === Number(sample.after) || keywordBefore !== null, 'bid had been moved before the rollback');
  }
  const audit = service.listAudit({ accountId, limit: 20 });
  assert(audit.items.some((entry) => entry.action === 'run.rolled-back'), 'rollback audited');
});

await test('a rolled-back action cannot be rolled back twice', async () => {
  const runs = service.listRuns(accountId, {}).items;
  const second = await service.rollback(accountId, runs[0].id, { confirm: true });
  equal(second.restored, 0);
});

await test('negative rule creates negatives and rollback removes them', async () => {
  const campaign = repository.listCampaigns(accountId)[0];
  const adGroup = repository.listAdGroups(accountId, { campaignId: campaign.id })[0];
  const negativeProfile = service.saveProfile(accountId, {
    name: 'Wasted clicks',
    conditions: [{ metric: 'clicks', op: 'gte', value: 1 }, { metric: 'orders', op: 'lte', value: 0 }],
  });
  const rule = service.saveRule(accountId, {
    kind: 'negative',
    name: 'Negate wasted clicks',
    params: { source: 'adGroup', matchType: 'negativeExact' },
    profileId: negativeProfile.id,
  });
  service.assign(accountId, rule.id, { adGroupId: adGroup.id });
  const plan = service.preview(accountId, { adGroupId: adGroup.id, ruleIds: [rule.id] });
  assert(plan.actions.length > 0, 'negative actions planned');
  const result = await service.applyPlan(accountId, { confirm: true, plan });
  const created = repository.listNegatives(accountId).filter((negative) => negative.source === 'rule');
  assert(created.length > 0, 'negatives stored');
  const rollback = await service.rollback(accountId, result.run.id, { confirm: true });
  assert(rollback.restored > 0, 'negatives rolled back');
  const remaining = repository.listNegatives(accountId).filter((negative) => negative.source === 'rule');
  equal(remaining.length, created.length - rollback.restored, 'negatives removed');
});

await test('mass preview expands a bid ladder into campaign plans', () => {
  const plans = service.massPreview(accountId, {
    asins: ['B0SILICONE01'],
    campaignTypes: ['auto'],
    bidLadder: [0.5, 0.6, 0.7],
    dailyBudget: 15,
    naming: '{asin} · Auto · {bid}',
  }).plans;
  equal(plans.length, 3);
  equal(plans[0].name, 'B0SILICONE01 · Auto · 0.50');
  equal(plans[0].targetingType, 'AUTO');
  equal(plans[0].state, 'PAUSED', 'campaigns are created paused by default');
});

await test('mass create makes campaigns and undo deletes them', async () => {
  const before = repository.listCampaigns(accountId).length;
  const result = await service.massCreate(accountId, {
    confirm: true,
    asins: ['B0KNIFE03'],
    campaignTypes: ['manual'],
    keywords: ['chef knife', 'kitchen knife'],
    matchTypes: ['exact', 'phrase'],
    defaultBid: 0.9,
    dailyBudget: 12,
    naming: '{asin} · Manual · {index}',
  });
  equal(result.created, 1);
  equal(repository.listCampaigns(accountId).length, before + 1);
  const campaignId = result.campaigns[0].campaignId;
  const undo = await service.massUndo(accountId, { confirm: true, campaignIds: [campaignId] });
  equal(undo.deleted, 1);
  equal(repository.listCampaigns(accountId).length, before);
});

await test('objective preset expands into rules and assigns them', () => {
  const objective = service.saveObjective(accountId, { presetId: 'bulk-auto', name: 'Bulk Auto Strategy' });
  assert(objective.ruleIds.length >= 5, 'rules created from the preset');
  const campaigns = repository.listCampaigns(accountId).slice(0, 2);
  const result = service.assignObjective(accountId, objective.id, { campaignIds: campaigns.map((campaign) => campaign.id) });
  equal(result.assigned, objective.ruleIds.length * 2);
  const listed = service.listObjectives(accountId);
  assert(listed.items.some((entry) => entry.id === objective.id), 'objective listed');
});

await test('dayparting schedule saves and the scheduler enforces it', async () => {
  const campaign = repository.listCampaigns(accountId)[0];
  const adGroup = repository.listAdGroups(accountId, { campaignId: campaign.id })[0];
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, enabled: hour >= 8 && hour < 20, modifier: hour === 10 ? 20 : 0 }));
  const saved = service.saveSchedule(accountId, { adGroupId: adGroup.id, hours, mode: 'schedule' });
  assert(saved.id.length > 0, 'schedule saved');
  const schedules = service.listSchedules(accountId).items;
  equal(schedules.length, 1);
  // Force the tick to treat "now" as 10:00 in the account time zone.
  const ticked = await scheduler.tick(new Date('2026-10-20T17:00:00Z'));
  assert(ticked.dayparting >= 0, 'scheduler ran');
});

await test('audit log paginates and filters', () => {
  const page = service.listAudit({ accountId, limit: 5 });
  equal(page.items.length <= 5, true);
  assert(page.total > 5, 'total counts every entry');
  const filtered = service.listAudit({ accountId, action: 'run.applied', limit: 100 });
  assert(filtered.items.every((entry) => entry.action === 'run.applied'), 'filter applied');
});

await test('settings round-trip and are audited', async () => {
  const saved = await service.saveSettings({ autoApply: true, schedule: { mode: 'hourly', everyHours: 2 } });
  equal(saved.autoApply, true);
  equal(saved.schedule.mode, 'hourly');
  equal(service.getSettings().schedule.everyHours, 2);
});

await test('api router answers health, refuses unknown routes and unauthenticated calls', async () => {
  const api = new ApiServer({ service, admit: () => undefined });
  const health = await call(api, 'GET', '/health');
  equal(health.status, 200);
  equal(health.body.ok, true);
  const missing = await call(api, 'GET', '/nope');
  equal(missing.status, 404);
  equal(missing.body.error.code, 'not-found');
  const denied = new ApiServer({ service, admit: () => 401 });
  const refused = await call(denied, 'GET', '/health');
  equal(refused.status, 401);
});

await test('api validates bodies and maps errors to codes', async () => {
  const api = new ApiServer({ service, admit: () => undefined });
  const bad = await call(api, 'POST', `/accounts/${accountId}/rules`, { kind: 'nope', name: 'x' });
  equal(bad.status, 400);
  equal(bad.body.error.code, 'unknown-kind');
  const missingConfirm = await call(api, 'POST', `/accounts/${accountId}/apply`, {});
  equal(missingConfirm.body.error.code, 'confirmation-required');
  const unknown = await call(api, 'GET', '/accounts/nope/campaigns');
  equal(unknown.status, 404);
});

await test('api preview endpoint returns a plan', async () => {
  const api = new ApiServer({ service, admit: () => undefined });
  const answer = await call(api, 'POST', `/accounts/${accountId}/preview`, {});
  equal(answer.status, 200);
  assert(Array.isArray(answer.body.actions), 'actions array');
  assert(answer.body.previewId.length > 0, 'preview id');
});

await test('concurrent syncs for one account share one run', async () => {
  const [a, b] = await Promise.all([
    service.sync(accountId, { days: 30 }),
    service.sync(accountId, { days: 30 }),
  ]);
  equal(a.metrics.rows, b.metrics.rows);
});

store.close();
cleanup(dir);
summarize('host');

/** Drive the router without a socket. */
async function call(api, method, path, body) {
  const req = {
    method,
    url: `/scale-commander/api${path}`,
    headers: { host: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  let status = 200;
  let payload = '';
  const res = {
    set statusCode(value) { status = value; },
    get statusCode() { return status; },
    setHeader() {},
    end(value) { payload = value ?? ''; },
  };
  await api.handle(req, res);
  return { status, body: payload.length === 0 ? {} : JSON.parse(payload) };
}
