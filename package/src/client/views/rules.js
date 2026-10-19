/**
 * Rules: the automation catalogue and editor.
 *
 * A rule is a kind plus parameters plus an optional Criteria Profile. The
 * editor renders parameters from the kind's defaults so a new rule kind only
 * needs a form fragment, not a new screen.
 * @module client/views/rules
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Field, Input, Select, Switch, Modal, Banner, Textarea } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, meta: any, onAssign: (ruleId: string) => void, toast: (message: string, tone?: 'ok'|'err') => void}} props
 */
export function Rules({ api, meta, onAssign, toast }) {
  const rules = useResource(() => api.rules(), []);
  const profiles = useResource(() => api.profiles(), []);
  const [editing, setEditing] = React.useState(null);
  const [kindFilter, setKindFilter] = React.useState('');
  const kinds = meta?.ruleKinds ?? {};

  const items = (rules.data?.items ?? []).filter((rule) => kindFilter === '' || rule.kind === kindFilter);

  const remove = async (rule) => {
    if (!globalThis.confirm?.(`Delete the rule "${rule.name}"? Its assignments are removed too.`)) return;
    try {
      await api.deleteRule(rule.id);
      toast('Rule deleted');
      rules.reload();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  const toggle = async (rule) => {
    try {
      await api.saveRule({ id: rule.id, kind: rule.kind, name: rule.name, enabled: !rule.enabled });
      rules.reload();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Select, {
        value: kindFilter,
        onChange: setKindFilter,
        ariaLabel: 'Filter by algorithm',
        options: [{ value: '', label: 'All algorithms' }, ...Object.entries(kinds).map(([key, value]) => ({ value: key, label: value.label }))],
      }),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${items.length} rule(s)`),
      h(Button, { variant: 'primary', onClick: () => setEditing({ mode: 'create' }) }, '+ New rule'),
    ),

    rules.loading && rules.data === undefined
      ? h(Spinner, { label: 'Loading rules…' })
      : h(Table, {
        columns: [
          { key: 'name', label: 'Rule', wrap: true, render: (row) => h('div', { className: 'sc-stack', style: { gap: 2 } },
            h('span', { style: { fontWeight: 600 } }, row.name),
            h('span', { className: 'sc-hint' }, row.summary),
          ) },
          { key: 'kind', label: 'Algorithm', render: (row) => h(Badge, { tone: 'brand' }, kinds[row.kind]?.label ?? row.kind) },
          { key: 'profile', label: 'Criteria', wrap: true, render: (row) => (row.profile === null ? h('span', { className: 'sc-flat' }, 'none') : h('span', { className: 'sc-hint' }, row.profile.name)) },
          { key: 'assignments', label: 'Assigned', numeric: true },
          { key: 'enabled', label: 'Enabled', render: (row) => h(Badge, { tone: row.enabled ? 'ok' : 'warn' }, row.enabled ? 'on' : 'off') },
          { key: 'dryRun', label: 'Mode', render: (row) => (row.dryRun ? h(Badge, { tone: 'warn' }, 'dry run') : h(Badge, null, 'live')) },
          { key: 'actions', label: '', render: (row) => h('div', { className: 'sc-row-tight' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => setEditing({ mode: 'edit', rule: row }) }, 'Edit'),
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => onAssign(row.id) }, 'Assign'),
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => toggle(row) }, row.enabled ? 'Disable' : 'Enable'),
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => remove(row) }, 'Delete'),
          ) },
        ],
        rows: items,
        rowKey: (row) => row.id,
        empty: h(Empty, {
          title: 'No rules yet',
          body: 'A rule turns a performance condition into an Amazon change. Start from a strategic objective for a complete strategy.',
        }),
      }),

    editing === null ? null : h(RuleEditor, {
      mode: editing.mode,
      rule: editing.rule,
      meta,
      profiles: profiles.data?.items ?? [],
      onClose: () => setEditing(null),
      onSaved: () => {
        setEditing(null);
        rules.reload();
        toast('Rule saved');
      },
      onError: (message) => toast(message, 'err'),
      api,
    }),
  );
}

/**
 * @param {{mode: 'create'|'edit', rule?: any, meta: any, profiles: Array<any>, api: Record<string, Function>, onClose: Function, onSaved: Function, onError: (message: string) => void}} props
 */
function RuleEditor({ mode, rule, meta, profiles, api, onClose, onSaved, onError }) {
  const kinds = meta?.ruleKinds ?? {};
  const [kind, setKind] = React.useState(rule?.kind ?? 'bidding');
  const [name, setName] = React.useState(rule?.name ?? '');
  const [description, setDescription] = React.useState(rule?.description ?? '');
  const [params, setParams] = React.useState(rule?.params ?? meta?.defaultParams?.[rule?.kind ?? 'bidding'] ?? {});
  const [profileId, setProfileId] = React.useState(rule?.profileId ?? '');
  const [enabled, setEnabled] = React.useState(rule?.enabled ?? true);
  const [dryRun, setDryRun] = React.useState(rule?.dryRun ?? false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (mode === 'create') setParams(meta?.defaultParams?.[kind] ?? {});
  }, [kind, meta, mode]);

  const set = (key, value) => setParams((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...(mode === 'edit' ? { id: rule.id } : {}),
        kind,
        name: name.trim().length === 0 ? kinds[kind]?.label ?? kind : name.trim(),
        description,
        params,
        profileId,
        enabled,
        dryRun,
      };
      await api.saveRule(payload);
      onSaved();
    } catch (error) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return h(Modal, {
    title: mode === 'create' ? 'New automation rule' : `Edit — ${rule.name}`,
    onClose,
    width: 820,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'save', variant: 'primary', onClick: save, disabled: saving }, saving ? 'Saving…' : 'Save rule'),
    ],
  },
  h('div', { className: 'sc-stack' },
    h('div', { className: 'sc-grid sc-grid-2' },
      h(Field, { label: 'Algorithm' },
        h(Select, {
          value: kind,
          onChange: (value) => {
            setKind(value);
            if (mode === 'create') setName('');
          },
          options: Object.entries(kinds).map(([key, value]) => ({ value: key, label: value.label })),
          disabled: mode === 'edit',
        }),
      ),
      h(Field, { label: 'Rule name', hint: 'Shown in previews, the audit trail, and the change log.' },
        h(Input, { value: name, onChange: setName, placeholder: kinds[kind]?.label ?? kind }),
      ),
    ),
    h('div', { className: 'sc-hint' }, kinds[kind]?.description ?? ''),

    h(ParamForm, { kind, params, set }),

    h('div', { className: 'sc-grid sc-grid-2' },
      h(Field, { label: 'Criteria Profile', hint: 'The performance conditions that must be met before the rule acts.' },
        h(Select, {
          value: profileId,
          onChange: setProfileId,
          options: [{ value: '', label: 'No criteria (rule-specific conditions only)' }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))],
        }),
      ),
      h('div', { className: 'sc-stack', style: { justifyContent: 'flex-end' } },
        h(Switch, { value: enabled, onChange: setEnabled, label: 'Enabled' }),
        h(Switch, { value: dryRun, onChange: setDryRun, label: 'Dry run — record the rule but never apply it' }),
      ),
    ),
    h(Field, { label: 'Description' }, h(Input, { value: description, onChange: setDescription, placeholder: 'Optional note for your team' })),
    kind === 'blacklist' ? h(BlacklistEditor, { params, set }) : null,
    kind === 'dayparting' ? h(DaypartingEditor, { params, set }) : null,
  ));
}

/**
 * The parameter form for each algorithm. Kept as one switch so adding a kind is
 * a single new case.
 * @param {{kind: string, params: any, set: (key: string, value: any) => void}} props
 */
function ParamForm({ kind, params, set }) {
  switch (kind) {
    case 'bidding':
    case 'defaultBid':
      return h('div', { className: 'sc-grid sc-grid-3' },
        numberField('Target ACOS (%)', params.targetAcos, (value) => set('targetAcos', value), 1, 500),
        numberField('Max change per run (%)', params.maxChangePercent, (value) => set('maxChangePercent', value), 0, 100),
        numberField('Bid cap', params.bidCap, (value) => set('bidCap', value === '' ? null : value), 0, 100, true),
        numberField('Days to observe a change', params.daysToObserve, (value) => set('daysToObserve', value), 0, 30),
        h(Field, { label: 'Bid floor', hint: 'Amazon refuses a bid below this.' }, h(Input, { type: 'number', value: params.minBid ?? 0.02, onChange: (value) => set('minBid', value), min: 0.02, step: 0.01 })),
        h(Field, { label: 'Cap at Amazon suggested bid' }, h(Switch, { value: params.useSuggestedBid === true, onChange: (value) => set('useSuggestedBid', value), label: 'Use the suggested bid as a ceiling' })),
      );
    case 'dayparting':
      return h('div', { className: 'sc-grid sc-grid-3' },
        h(Field, { label: 'Mode', hint: 'Optimum hours derives the schedule from hourly performance.' },
          h(Select, {
            value: params.mode ?? 'schedule',
            onChange: (value) => set('mode', value),
            options: [{ value: 'schedule', label: 'Fixed schedule' }, { value: 'optimum', label: 'Optimum hours from data' }],
          }),
        ),
        params.mode === 'optimum'
          ? numberField('Minimum orders per hour', params.minHourlyOrders, (value) => set('minHourlyOrders', value), 0, 100)
          : numberField('Start hour', params.startHour, (value) => set('startHour', value), 0, 23),
        params.mode === 'optimum' ? null : numberField('End hour (exclusive)', params.endHour, (value) => set('endHour', value), 1, 24),
      );
    case 'import':
      return h('div', { className: 'sc-grid sc-grid-3' },
        sourceField(params, set),
        h(Field, { label: 'New keyword match type' },
          h(Select, {
            value: params.matchType ?? 'exact',
            onChange: (value) => set('matchType', value),
            options: [{ value: 'exact', label: 'Exact' }, { value: 'phrase', label: 'Phrase' }, { value: 'broad', label: 'Broad' }],
          }),
        ),
        numberField('Initial bid (% of search-term CPC)', params.bidPercentOfCpc, (value) => set('bidPercentOfCpc', value), 10, 500),
        numberField('Max new keywords per run', params.maxKeywordsPerRun, (value) => set('maxKeywordsPerRun', value), 1, 1000),
      );
    case 'negative':
    case 'negativeWord':
      return h('div', { className: 'sc-grid sc-grid-3' },
        sourceField(params, set),
        h(Field, { label: 'Negative match type' },
          h(Select, {
            value: params.matchType ?? 'negativeExact',
            onChange: (value) => set('matchType', value),
            options: [{ value: 'negativeExact', label: 'Negative exact' }, { value: 'negativePhrase', label: 'Negative phrase' }],
          }),
        ),
        kind === 'negativeWord' ? numberField('Minimum word length', params.minWordLength, (value) => set('minWordLength', value), 2, 20) : null,
        h(Field, { label: 'Whitelist' }, h(Switch, { value: params.skipWhitelist !== false, onChange: (value) => set('skipWhitelist', value), label: 'Never negate whitelisted terms' })),
      );
    case 'revive':
      return h('div', { className: 'sc-grid sc-grid-3' },
        numberField('Target ACOS (%)', params.targetAcos, (value) => set('targetAcos', value), 1, 500),
        numberField('Bid increase per run (%)', params.maxChangePercent, (value) => set('maxChangePercent', value), 1, 100),
        numberField('Active = impressions in window', params.activeImpressions, (value) => set('activeImpressions', value), 0, 1000),
      );
    case 'status':
      return h('div', { className: 'sc-grid sc-grid-3' },
        h(Field, { label: 'Applies to' },
          h(Select, {
            value: params.target ?? 'adGroup',
            onChange: (value) => set('target', value),
            options: [{ value: 'adGroup', label: 'Ad groups' }, { value: 'campaign', label: 'Campaigns' }],
          }),
        ),
        h(Field, { label: 'Action' },
          h(Select, {
            value: params.action ?? 'pause',
            onChange: (value) => set('action', value),
            options: [{ value: 'pause', label: 'Pause' }, { value: 'enable', label: 'Enable' }],
          }),
        ),
      );
    case 'dailyBudget':
      return h('div', { className: 'sc-stack' },
        h('div', { className: 'sc-grid sc-grid-3' },
          numberField('Baseline budget (optional)', params.baseline, (value) => set('baseline', value === '' ? null : value), 0, 100000),
          numberField('Minimum budget', params.minBudget, (value) => set('minBudget', value), 1, 100000),
          numberField('Maximum budget (optional)', params.maxBudget, (value) => set('maxBudget', value === '' ? null : value), 1, 100000),
        ),
        h('div', { className: 'sc-stack' },
          h('span', { className: 'sc-label' }, 'Day-of-week multipliers (Mon → Sun)'),
          h('div', { className: 'sc-row' }, [1, 2, 3, 4, 5, 6, 7].map((day) => h('div', { key: day, className: 'sc-field', style: { width: 76 } },
            h('span', { className: 'sc-hint' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]),
            h(Input, {
              type: 'number',
              value: (params.dayOfWeekMultipliers ?? [1, 1, 1, 1, 1, 1, 1])[day - 1],
              step: 0.05,
              min: 0.1,
              onChange: (value) => {
                const next = [...(params.dayOfWeekMultipliers ?? [1, 1, 1, 1, 1, 1, 1])];
                next[day - 1] = value;
                set('dayOfWeekMultipliers', next);
              },
            }),
          ))),
        ),
      );
    case 'placement':
      return h('div', { className: 'sc-grid sc-grid-3' },
        h(Field, { label: 'Placement' },
          h(Select, {
            value: params.placement ?? 'topOfSearch',
            onChange: (value) => set('placement', value),
            options: [
              { value: 'topOfSearch', label: 'Top of search' },
              { value: 'productPage', label: 'Product pages' },
              { value: 'restOfSearch', label: 'Rest of search' },
            ],
          }),
        ),
        numberField('Target modifier (%)', params.targetModifier, (value) => set('targetModifier', value), 0, 900),
        numberField('Increment per run (%)', params.incrementPercent, (value) => set('incrementPercent', value), 0, 900),
        numberField('Decrement per run (%)', params.decrementPercent, (value) => set('decrementPercent', value), 0, 900),
      );
    default:
      return h('div', { className: 'sc-hint' }, 'This algorithm has no parameters beyond its criteria.');
  }
}

/**
 * @param {string} label
 * @param {any} value
 * @param {(value: any) => void} onChange
 * @param {number} min
 * @param {number} max
 * @param {boolean} [optional]
 */
function numberField(label, value, onChange, min, max, optional) {
  return h(Field, { label },
    h(Input, {
      type: 'number',
      value: value === null || value === undefined ? '' : value,
      onChange,
      min,
      max,
      placeholder: optional === true ? 'no cap' : undefined,
    }),
  );
}

/**
 * @param {any} params
 * @param {(key: string, value: any) => void} set
 */
function sourceField(params, set) {
  return h(Field, { label: 'Search term source', hint: 'Where the aggregated search terms come from.' },
    h(Select, {
      value: params.source ?? 'asin',
      onChange: (value) => set('source', value),
      options: [
        { value: 'asin', label: 'Same ASIN across the account' },
        { value: 'campaign', label: 'This campaign' },
        { value: 'adGroup', label: 'This ad group' },
        { value: 'customGroup', label: 'Custom group' },
      ],
    }),
  );
}

/**
 * Blacklist and whitelist term lists.
 * @param {{params: any, set: (key: string, value: any) => void}} props
 */
function BlacklistEditor({ params, set }) {
  const toList = (text) => text.split(/[\n,;]+/u).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  return h('div', { className: 'sc-grid sc-grid-2' },
    listField('Negative exact', params.negativeExact, (value) => set('negativeExact', value)),
    listField('Negative phrase', params.negativePhrase, (value) => set('negativePhrase', value)),
    listField('Exact whitelist (never negated as exact)', params.exactWhitelist, (value) => set('exactWhitelist', value)),
    listField('Phrase whitelist (never negated as phrase)', params.phraseWhitelist, (value) => set('phraseWhitelist', value)),
  );

  /**
   * @param {string} label
   * @param {unknown} value
   * @param {(value: string[]) => void} onChange
   */
  function listField(label, value, onChange) {
    const [text, setText] = React.useState(Array.isArray(value) ? value.join('\n') : '');
    return h(Field, { label, hint: 'One term per line.' },
      h('textarea', {
        className: 'sc-textarea',
        value: text,
        onChange: (event) => {
          setText(event.target.value);
          onChange(toList(event.target.value));
        },
      }),
    );
  }
}

/**
 * The dayparting hourly modifier grid inside the rule editor.
 * @param {{params: any, set: (key: string, value: any) => void}} props
 */
function DaypartingEditor({ params, set }) {
  const modifiers = Array.isArray(params.bidModifiers) ? params.bidModifiers : [];
  return h('div', { className: 'sc-stack' },
    h('span', { className: 'sc-label' }, 'Hourly bid modifiers (%) — each hour applies to the keyword base bid'),
    h('div', { className: 'sc-row' }, Array.from({ length: 24 }, (_, hour) => h('div', { key: hour, className: 'sc-field', style: { width: 52 } },
      h('span', { className: 'sc-hint', style: { textAlign: 'center' } }, String(hour).padStart(2, '0')),
      h(Input, {
        type: 'number',
        value: modifiers[hour] ?? 0,
        min: -90,
        max: 900,
        onChange: (value) => {
          const next = Array.from({ length: 24 }, (_, index) => Number(modifiers[index] ?? 0));
          next[hour] = value;
          set('bidModifiers', next);
        },
      }),
    ))),
  );
}
