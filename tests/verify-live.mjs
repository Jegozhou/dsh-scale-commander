/**
 * Verify the plugin as the live Host runs it, without restarting: import the
 * exact modules the Loader mounts and drive them through the same facade the
 * HTTP API uses. The bundle route needs a restart (documented), so the browser
 * registration is verified separately by the client suite.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const P = join(dirname(dirname(fileURLToPath(import.meta.url))), 'package', 'lib');
const { Store } = await import(`${P}/host/store.js`);
const { Repository } = await import(`${P}/host/repository.js`);
const { createSandboxProvider } = await import(`${P}/host/sandbox.js`);
const { SyncService } = await import(`${P}/host/sync.js`);
const { EngineService } = await import(`${P}/host/engine.js`);
const { AnalyticsService } = await import(`${P}/host/analytics.js`);
const { MassService } = await import(`${P}/host/mass.js`);
const { Scheduler } = await import(`${P}/host/scheduler.js`);
const { CredentialVault } = await import(`${P}/host/vault.js`);
const { ScaleService } = await import(`${P}/host/service.js`);
const { ApiServer } = await import(`${P}/host/api.js`);
const { registerTools } = await import(`${P}/host/tools.js`);
const { resolveDataDir } = await import(`${P}/index.js`);
const { rmSync } = await import('node:fs');

const dir = join(resolveDataDir('/tmp/verify-live'));
rmSync(dir, { recursive: true, force: true });
const store = new Store({ file: join(dir, 'db.sqlite') });
const repository = new Repository(store);
const providers = new Map();
const providerFor = async (id) => {
  const account = repository.getAccount(id);
  if (account.provider === 'sandbox') {
    if (!providers.has(id)) providers.set(id, createSandboxProvider(id));
    return { provider: providers.get(id), account };
  }
  throw new Error('sandbox only');
};
const vault = new CredentialVault({ dataDir: dir, passphrase: 'v' });
const sync = new SyncService({ repository, providerFor });
const engine = new EngineService({ repository, providerFor });
const analytics = new AnalyticsService({ repository });
const mass = new MassService({ repository, providerFor });
const scheduler = new Scheduler({ repository, engine, providerFor, enabled: true, tickSeconds: 60 });
let settings = { autoApply: false, schedule: { mode: 'daily', hour: 6, minute: 0, everyHours: 6, timezone: 'America/Los_Angeles', autoApply: false }, defaults: { daysToAnalyze: 30, daysToIgnore: 2, maxActionsPerRun: 500 } };
const service = new ScaleService({
  repository, engine, syncService: sync, analytics, mass, scheduler, vault, providerFor,
  settings: () => settings, persistSettings: async (n) => { settings = n; },
});
const api = new ApiServer({ service, admit: () => undefined });

async function call(method, path, body) {
  const req = { method, url: `/scale-commander/api${path}`, headers: {},
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
  let status = 200, payload = '';
  const res = { set statusCode(v) { status = v; }, get statusCode() { return status; }, setHeader() {}, end(v) { payload = v ?? ''; } };
  await api.handle(req, res);
  return { status, body: payload.length === 0 ? {} : JSON.parse(payload) };
}

const account = (await call('POST', '/accounts', { name: 'Verification', provider: 'sandbox', days: 120 })).body;
const id = account.id;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); };

const s = await call('POST', `/accounts/${id}/sync`, { days: 90, hourly: true });
check('sync pulls campaigns, metrics, hourly', s.body.metrics.rows > 1000 && s.body.hourly > 500, `metrics=${s.body.metrics.rows} hourly=${s.body.hourly}`);

const o = (await call('GET', `/accounts/${id}/overview?days=30`)).body;
check('overview computes ACOS/ROAS/TACOS', o.summary.acos > 0 && o.summary.roas > 0 && o.unitEconomics.tacos > 0, `ACOS ${o.summary.acos?.toFixed(1)} ROAS ${o.summary.roas?.toFixed(2)}`);

const b = (await call('GET', `/accounts/${id}/breakdown?level=keyword&days=30&limit=10`)).body;
check('keyword breakdown ranked', b.items.length === 10 && b.items[0].spend >= b.items[9].spend, `top ${b.items[0]?.spend?.toFixed(2)}`);

const w = (await call('GET', `/accounts/${id}/words?days=60`)).body;
check('unique words aggregated', w.items.length > 20, `${w.items.length} words`);

const hm = (await call('GET', `/accounts/${id}/heatmap?days=30`)).body;
check('heatmap covers 24 hours', new Set(hm.cells.map(c => c.hour)).size === 24, `${hm.cells.length} cells`);

const at = (await call('GET', `/accounts/${id}/attribution?days=30`)).body;
check('attribution splits ad/organic', at.summary.totalSales > 0 && at.byAsin.length > 0, `${at.byAsin.length} ASINs`);

const pl = (await call('GET', `/accounts/${id}/placements?days=30`)).body;
check('placement metrics present', pl.items[0].topOfSearch.impressions > 0, `TOS impr ${pl.items[0]?.topOfSearch?.impressions}`);

const dk = (await call('GET', `/accounts/${id}/dead-keywords?days=30`)).body;
check('dead keywords report', Array.isArray(dk.items), `${dk.items.length} dead`);

const obj = (await call('POST', `/accounts/${id}/objectives`, { presetId: 'sales-exact', name: 'Sales' })).body;
const camp = (await call('GET', `/accounts/${id}/campaigns`)).body.items[0];
const asg = await call('POST', `/accounts/${id}/objectives/${obj.id}/assign`, { campaignIds: [camp.id] });
check('objective preset expands and assigns', obj.ruleIds.length >= 5 && asg.body.assigned > 0, `${obj.ruleIds.length} rules, ${asg.body.assigned} assignments`);

const plan = (await call('POST', `/accounts/${id}/preview`, {})).body;
check('preview produces audited actions', plan.actions.length > 0 && plan.actions[0].calculation.length > 0, `${plan.actions.length} actions`);
check('preview writes nothing', repository.listRuns({ accountId: id }).length === 0, 'no run rows');

const applied = (await call('POST', `/accounts/${id}/apply`, { confirm: true, plan })).body;
check('apply executes the plan', applied.run.applied > 0 && applied.run.failed === 0, `applied ${applied.run.applied}`);

const rolled = (await call('POST', `/accounts/${id}/runs/${applied.run.id}/rollback`, { confirm: true })).body;
check('rollback restores every action', rolled.restored === applied.run.applied && rolled.failed === 0, `restored ${rolled.restored}`);

const au = (await call('GET', `/audit?accountId=${id}&limit=50`)).body;
check('audit log records the pipeline', au.total >= 6, `${au.total} entries`);

const mp = (await call('POST', `/accounts/${id}/mass/preview`, { asins: 'B0KNIFE03', campaignTypes: ['manual'], keywords: 'chef knife', matchTypes: ['exact','phrase'] })).body;
check('mass preview expands ladder', mp.plans.length === 1 && mp.plans[0].keywords.length === 2, `${mp.plans.length} campaigns`);

const mc = (await call('POST', `/accounts/${id}/mass/create`, { confirm: true, asins: 'B0KNIFE03', campaignTypes: ['manual'], keywords: 'chef knife', matchTypes: ['exact'] })).body;
const mu = await call('POST', `/accounts/${id}/mass/undo`, { confirm: true, campaignIds: mc.campaigns.map(c => c.campaignId) });
check('mass create and undo', mc.created === 1 && mu.body.deleted === 1, `created ${mc.created}, deleted ${mu.body.deleted}`);

const neg = (await call('GET', `/accounts/${id}/negatives?search=free`)).body;
check('negative management', neg.total >= 1, `${neg.total} negatives`);

const sched = await call('POST', `/accounts/${id}/schedules`, { adGroupId: repository.listAdGroups(id)[0].id, hours: Array.from({length:24},(_,h)=>({hour:h,enabled:h>=6&&h<20,modifier:h===10?20:0})) });
check('dayparting schedule saves', sched.body.ok === true, 'saved');

const tick = await call('POST', '/scheduler/tick', {});
check('scheduler tick runs', typeof tick.body.dayparting === 'number', `dayparting=${tick.body.dayparting}`);

const refused = await call('POST', `/accounts/${id}/apply`, {});
check('apply without confirmation refused', refused.status === 400 && refused.body.error.code === 'confirmation-required', `${refused.status} ${refused.body.error.code}`);

const tools = [];
registerTools({ tools: { register: (d) => { tools.push(d.name); return () => {}; } } }, { service, repository });
check('agent tools registered', tools.length === 12, tools.length + ' tools');

const meta = (await call('GET', '/meta')).body;
check('meta exposes the catalogue', Object.keys(meta.ruleKinds).length === 11 && meta.metrics.length > 50 && meta.objectives.length === 7, `${Object.keys(meta.ruleKinds).length} kinds, ${meta.metrics.length} metrics`);

store.close();
rmSync(dir, { recursive: true, force: true });

console.log('');
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (!c.ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} live checks passed`);
process.exit(failed === 0 ? 0 : 1);
