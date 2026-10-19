/**
 * Preview and change log: what the engine intends to do, and what it did.
 *
 * The preview pane is the safety contract of the product: nothing reaches
 * Amazon until a person has seen every action, its before/after value, and the
 * arithmetic behind it.
 * @module client/views/preview
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Diff, Calculation, Banner, Modal, Select, fmt, Input } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

const KIND_METRIC = {
  bid: 'spend',
  targetBid: 'spend',
  defaultBid: 'spend',
  campaignBudget: 'spend',
  placement: 'percent',
};

/**
 * @param {{api: Record<string, Function>, account: Record<string, any>, scope: any, days: number, onApplied: () => void, toast: (message: string, tone?: 'ok'|'err') => void}} props
 */
export function Preview({ api, account, scope, days, onApplied, toast }) {
  const [plan, setPlan] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [confirming, setConfirming] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);
  const currency = account.currency;

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.preview({ ...scope, days });
      setPlan(next);
    } catch (failure) {
      setError(failure);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [api, scope, days]);

  React.useEffect(() => {
    void run();
  }, [run]);

  const apply = async () => {
    setApplying(true);
    try {
      const result = await api.apply({ confirm: true, plan });
      if (result.run.id === null) {
        toast('Nothing to apply');
      } else {
        toast(`Applied ${result.run.applied} change(s); ${result.run.failed} failed`);
      }
      setConfirming(false);
      onApplied(result);
      await run();
    } catch (failure) {
      toast(failure.message, 'err');
    } finally {
      setApplying(false);
    }
  };

  const actions = plan?.actions ?? [];
  const grouped = groupByRule(actions);

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Button, { onClick: run, disabled: loading }, loading ? 'Evaluating…' : 'Re-evaluate'),
      h('div', { className: 'sc-spacer' }),
      plan === null ? null : h('span', { className: 'sc-subtitle' }, `${actions.length} action(s) across ${grouped.length} rule(s)`),
      h(Button, { variant: 'primary', disabled: actions.length === 0 || loading, onClick: () => setConfirming(true) }, 'Apply changes…'),
    ),

    error === null ? null : h(Banner, { tone: 'warn' }, `Preview failed: ${error.message}`),
    h(Banner, null, 'A preview writes nothing. Applying records every before/after value so the run can be rolled back from the change log.'),

    loading && plan === null ? h(Spinner, { label: 'Evaluating every rule against the stored metrics…' }) : null,
    plan !== null && actions.length === 0
      ? h(Empty, {
        title: 'Nothing to change',
        body: plan.skippedRules.length === 0
          ? 'Every rule ran and no entity met its conditions. That is a healthy result, not an error.'
          : 'No rule is assigned in this scope. Assign a rule to a campaign or ad group first.',
      })
      : null,

    plan !== null && plan.skippedRules.length > 0
      ? h(Card, { title: 'Rules that did not run', style: { marginTop: 12 } },
        h('div', { className: 'sc-stack' }, plan.skippedRules.map((entry, index) => h('div', { key: index, className: 'sc-row', style: { justifyContent: 'space-between', fontSize: 12.5 } },
          h('span', null, `${entry.name} (${entry.kind})`),
          h('span', { className: 'sc-hint' }, entry.reason),
        ))))
      : null,

    grouped.map((group) => h(Card, {
      key: group.ruleId,
      title: `${group.ruleName} — ${group.actions.length} action(s)`,
      style: { marginTop: 12 },
    },
    h(Table, {
      columns: [
        { key: 'entity', label: 'Entity', wrap: true, render: (row) => h('div', { className: 'sc-stack', style: { gap: 2 } },
          h('span', null, row.entityName || row.entityId),
          h('span', { className: 'sc-hint sc-mono' }, `${row.entityType} · ${row.adGroupId || row.campaignId}`),
        ) },
        { key: 'kind', label: 'Change', render: (row) => h(Badge, { tone: 'brand' }, labelForKind(row.kind)) },
        { key: 'value', label: 'Before → after', numeric: true, render: (row) => renderDiff(row, currency) },
        { key: 'reason', label: 'Reason', wrap: true },
        { key: 'calc', label: '', render: (row) => h(Button, { size: 'sm', variant: 'ghost', onClick: () => setExpanded(expanded === row.id ? null : row.id) }, expanded === row.id ? 'Hide maths' : 'Show maths') },
      ],
      rows: group.actions,
      rowKey: (row) => row.id,
    }),
    expanded === null || !group.actions.some((action) => action.id === expanded)
      ? null
      : h('div', { style: { marginTop: 10 } },
        h(Calculation, { steps: group.actions.find((action) => action.id === expanded).calculation }),
        h(MetricsSummary, { metrics: group.actions.find((action) => action.id === expanded).metrics })),
    )),

    confirming ? h(Modal, {
      title: 'Apply these changes?',
      onClose: () => setConfirming(false),
      footer: [
        h(Button, { key: 'cancel', onClick: () => setConfirming(false) }, 'Cancel'),
        h(Button, { key: 'go', variant: 'primary', onClick: apply, disabled: applying }, applying ? 'Applying…' : `Apply ${actions.length} change(s)`),
      ],
    },
    h('div', { className: 'sc-stack' },
      h('div', null, `This sends ${actions.length} change(s) to ${account.provider === 'sandbox' ? 'the sandbox account' : 'Amazon'}.`),
      h(Banner, { tone: 'warn' }, 'Every change is recorded with its before value. Roll the run back from Change log if the result is wrong.'),
      h(SummaryList, { actions }),
    )) : null,
  );
}

/**
 * @param {{actions: Array<any>}} props
 */
function SummaryList({ actions }) {
  const counts = new Map();
  for (const action of actions) counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  return h('div', { className: 'sc-pill-row' }, [...counts.entries()].map(([kind, count]) => h('span', { key: kind, className: 'sc-chip' }, `${labelForKind(kind)}: ${count}`)));
}

/**
 * @param {{metrics: Record<string, number>}} props
 */
function MetricsSummary({ metrics }) {
  const keys = ['impressions', 'clicks', 'spend', 'sales', 'orders', 'acos', 'cvr'];
  return h('div', { className: 'sc-pill-row', style: { marginTop: 8 } },
    keys.map((key) => h('span', { key, className: 'sc-chip' }, `${key}: ${fmt(metrics[key], key)}`)));
}

/**
 * @param {Record<string, any>} action
 * @param {string} currency
 */
function renderDiff(action, currency) {
  if (action.kind === 'placement') {
    return h('span', { className: 'sc-diff' },
      h('span', { className: 'sc-diff-before' }, `${action.before?.modifier ?? action.before}%`),
      h('span', { className: 'sc-diff-arrow' }, '→'),
      h('span', { className: 'sc-diff-after' }, `${action.after?.modifier ?? action.after}%`),
    );
  }
  if (action.kind === 'negativeKeyword') {
    return h('span', null, `${action.after?.text} (${action.after?.matchType === 'negativePhrase' ? 'phrase' : 'exact'})`);
  }
  if (action.kind === 'importKeyword') {
    return h('span', null, `new ${action.after?.matchType} at ${fmt(action.after?.bid, 'spend', currency)}`);
  }
  if (action.kind === 'campaignBudget' || action.kind === 'campaignStatus' || action.kind === 'adGroupStatus') {
    const metric = KIND_METRIC[action.kind] ?? 'spend';
    return h(Diff, { before: action.before, after: action.after, metric, currency });
  }
  return h(Diff, { before: action.before, after: action.after, metric: 'spend', currency });
}

/**
 * @param {string} kind
 * @returns {string}
 */
export function labelForKind(kind) {
  switch (kind) {
    case 'bid': return 'Bid';
    case 'targetBid': return 'Target bid';
    case 'defaultBid': return 'Default bid';
    case 'campaignStatus': return 'Campaign state';
    case 'adGroupStatus': return 'Ad group state';
    case 'keywordStatus': return 'Keyword state';
    case 'campaignBudget': return 'Budget';
    case 'placement': return 'Placement';
    case 'negativeKeyword': return 'Negative';
    case 'importKeyword': return 'New keyword';
    case 'importTarget': return 'New target';
    case 'dayparting': return 'Schedule';
    default: return kind;
  }
}

/**
 * @param {Array<any>} actions
 * @returns {Array<{ruleId: string, ruleName: string, actions: Array<any>}>}
 */
function groupByRule(actions) {
  const map = new Map();
  for (const action of actions) {
    const key = action.ruleId ?? 'unknown';
    const entry = map.get(key) ?? { ruleId: key, ruleName: action.ruleName ?? 'Unknown rule', actions: [] };
    entry.actions.push(action);
    map.set(key, entry);
  }
  return [...map.values()];
}

/**
 * The change log: runs and their actions, with rollback.
 * @param {{api: Record<string, Function>, account: Record<string, any>, toast: (message: string, tone?: 'ok'|'err') => void, onRolledBack: () => void}} props
 */
export function ChangeLog({ api, account, toast, onRolledBack }) {
  const runs = useResource(() => api.runs({ limit: 50 }), []);
  const [selected, setSelected] = React.useState(null);
  const detail = useResource(
    () => (selected === null ? Promise.resolve(null) : api.run(selected)),
    [selected],
    { enabled: selected !== null },
  );
  const currency = account.currency;

  const rollback = async (run) => {
    if (!globalThis.confirm?.(`Restore the before value of every applied action in this run?`)) return;
    try {
      const result = await api.rollback(run.id, { confirm: true });
      toast(`Restored ${result.restored} change(s); ${result.failed} failed`);
      runs.reload();
      detail.reload();
      onRolledBack();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h('span', { className: 'sc-subtitle' }, `${runs.data?.items.length ?? 0} run(s)`),
      h('div', { className: 'sc-spacer' }),
      h(Button, { onClick: runs.reload }, 'Refresh'),
    ),
    runs.loading && runs.data === undefined
      ? h(Spinner, { label: 'Loading runs…' })
      : h(Table, {
        columns: [
          { key: 'startedAt', label: 'Started', render: (row) => new Date(row.startedAt).toLocaleString() },
          { key: 'trigger', label: 'Trigger', render: (row) => h(Badge, null, row.trigger) },
          { key: 'status', label: 'Status', render: (row) => h(Badge, { tone: statusTone(row.status) }, row.status) },
          { key: 'planned', label: 'Planned', numeric: true },
          { key: 'applied', label: 'Applied', numeric: true },
          { key: 'failed', label: 'Failed', numeric: true, render: (row) => h('span', { className: row.failed > 0 ? 'sc-down' : '' }, String(row.failed)) },
          { key: 'skipped', label: 'Skipped', numeric: true },
          { key: 'actions', label: '', render: (row) => h('div', { className: 'sc-row-tight' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => setSelected(row.id) }, 'Details'),
            row.applied > 0 ? h(Button, { size: 'sm', variant: 'ghost', onClick: () => rollback(row) }, 'Roll back') : null,
          ) },
        ],
        rows: runs.data?.items ?? [],
        rowKey: (row) => row.id,
        empty: h(Empty, { title: 'No runs yet', body: 'Apply a preview to create the first run.' }),
      }),

    selected === null ? null : h(Modal, {
      title: `Run ${selected}`,
      onClose: () => setSelected(null),
      width: 1000,
      footer: h(Button, { onClick: () => setSelected(null) }, 'Close'),
    },
    detail.loading ? h(Spinner, { label: 'Loading actions…' }) : h('div', { className: 'sc-stack' },
      h('div', { className: 'sc-pill-row' },
        h('span', { className: 'sc-chip' }, `status ${detail.data?.run.status}`),
        h('span', { className: 'sc-chip' }, `applied ${detail.data?.run.applied}`),
        h('span', { className: 'sc-chip' }, `failed ${detail.data?.run.failed}`),
        h('span', { className: 'sc-chip' }, `skipped ${detail.data?.run.skipped}`),
      ),
      h('div', { className: 'sc-table-wrap', style: { maxHeight: 460 } },
        h('table', { className: 'sc-table' },
          h('thead', null, h('tr', null,
            h('th', null, 'Rule'),
            h('th', null, 'Entity'),
            h('th', null, 'Change'),
            h('th', null, 'Before → after'),
            h('th', null, 'Status'),
            h('th', null, 'Error'),
          )),
          h('tbody', null, (detail.data?.actions ?? []).map((action) => h('tr', { key: action.id },
            h('td', { className: 'sc-wrap' }, action.ruleName),
            h('td', { className: 'sc-wrap' }, action.entityName),
            h('td', null, labelForKind(action.kind)),
            h('td', { className: 'sc-num' }, renderDiff(action, currency)),
            h('td', null, h(Badge, { tone: action.status === 'applied' ? 'ok' : action.status === 'failed' ? 'err' : 'warn' }, action.status)),
            h('td', { className: 'sc-wrap' }, action.error),
          ))),
        ),
      ),
    )),
  );
}

/**
 * @param {string} status
 * @returns {'ok'|'err'|'warn'|undefined}
 */
function statusTone(status) {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'err';
  if (status === 'previewed' || status === 'running') return 'warn';
  return undefined;
}

/**
 * The audit trail: every configuration and automation event.
 * @param {{api: Record<string, Function>, account: Record<string, any>}} props
 */
export function AuditLog({ api, account }) {
  const [limit, setLimit] = React.useState(100);
  const audit = useResource(() => api.audit({ accountId: account.id, limit }), [limit]);
  const items = audit.data?.items ?? [];

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h('span', { className: 'sc-subtitle' }, `${items.length} of ${audit.data?.total ?? 0} entries`),
      h('div', { className: 'sc-spacer' }),
      h(Select, {
        value: String(limit),
        onChange: (value) => setLimit(Number(value)),
        ariaLabel: 'Entries to show',
        options: [{ value: '50', label: '50' }, { value: '100', label: '100' }, { value: '250', label: '250' }],
      }),
      h(Button, { onClick: audit.reload }, 'Refresh'),
    ),
    audit.loading && audit.data === undefined
      ? h(Spinner, { label: 'Loading audit log…' })
      : h(Table, {
        columns: [
          { key: 'at', label: 'When', render: (row) => new Date(row.at).toLocaleString() },
          { key: 'actor', label: 'Actor', render: (row) => h(Badge, { tone: row.actor === 'scheduler' ? 'brand' : undefined }, row.actor) },
          { key: 'action', label: 'Action', render: (row) => h('span', { className: 'sc-mono' }, row.action) },
          { key: 'target', label: 'Target', wrap: true },
          { key: 'detail', label: 'Detail', wrap: true, render: (row) => h('span', { className: 'sc-hint sc-mono' }, JSON.stringify(row.detail).slice(0, 200)) },
        ],
        rows: items,
        rowKey: (row) => String(row.id),
        empty: h(Empty, { title: 'No audit entries', body: 'Actions, syncs and settings changes are recorded here.' }),
      }),
  );
}
