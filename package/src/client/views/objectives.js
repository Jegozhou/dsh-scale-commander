/**
 * Strategic objectives and mass campaigns: the two ways to scale.
 *
 * An objective expands a documented preset into real rules and assigns them to
 * the selected ad groups. The mass builder turns a bid ladder and a keyword
 * seed list into many campaigns in one audited batch.
 * @module client/views/objectives
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Field, Input, Select, Modal, Banner, Textarea, fmt } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, meta: any, toast: (message: string, tone?: 'ok'|'err') => void, onChanged: () => void}} props
 */
export function Objectives({ api, meta, toast, onChanged }) {
  const objectives = useResource(() => api.objectives(), []);
  const campaigns = useResource(() => api.campaigns({}), []);
  const adGroups = useResource(() => api.adGroups({}), []);
  const [assigning, setAssigning] = React.useState(null);
  const [creating, setCreating] = React.useState(false);

  const items = objectives.data?.items ?? [];
  const presets = objectives.data?.presets ?? meta?.objectives ?? [];

  const remove = async (objective) => {
    if (!globalThis.confirm?.(`Delete the objective "${objective.name}"? The rules it created remain.`)) return;
    try {
      await api.deleteObjective(objective.id);
      toast('Objective deleted');
      objectives.reload();
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Button, { variant: 'primary', onClick: () => setCreating(true) }, '+ New objective from preset'),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${items.length} objective(s)`),
    ),

    items.length === 0
      ? h(Empty, {
        title: 'No strategic objectives yet',
        body: 'An objective bundles several algorithms into one strategy, then applies it to every ad group you choose.',
      })
      : h(Table, {
        columns: [
          { key: 'name', label: 'Objective', wrap: true, render: (row) => h('div', { className: 'sc-stack', style: { gap: 2 } },
            h('span', { style: { fontWeight: 600 } }, row.name),
            h('span', { className: 'sc-hint' }, row.description || '—'),
          ) },
          { key: 'adType', label: 'Ads', render: (row) => h(Badge, null, row.adType) },
          { key: 'rules', label: 'Rules', render: (row) => h('div', { className: 'sc-pill-row' }, row.rules.map((rule) => h('span', { key: rule.id, className: 'sc-chip', title: rule.name }, rule.kind))) },
          { key: 'assignments', label: 'Assigned', numeric: true },
          { key: 'actions', label: '', render: (row) => h('div', { className: 'sc-row-tight' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => setAssigning(row) }, 'Assign'),
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => remove(row) }, 'Delete'),
          ) },
        ],
        rows: items,
        rowKey: (row) => row.id,
      }),

    h(Card, { title: 'Preset strategies', style: { marginTop: 16 } },
      h('div', { className: 'sc-grid sc-grid-2' }, presets.map((preset) => h('div', { key: preset.id, className: 'sc-card' },
        h('div', { className: 'sc-row' }, h('strong', null, preset.name), h('div', { className: 'sc-spacer' }), h(Badge, { tone: 'brand' }, preset.adType)),
        h('div', { className: 'sc-hint', style: { margin: '6px 0' } }, preset.description),
        h('div', { className: 'sc-pill-row' }, preset.rules.map((rule, index) => h('span', { key: index, className: 'sc-chip' }, rule.kind))),
        h('div', { className: 'sc-row', style: { marginTop: 8 } },
          h(Button, {
            size: 'sm',
            onClick: async () => {
              try {
                await api.saveObjective({ presetId: preset.id, name: preset.name });
                toast(`Objective "${preset.name}" created`);
                objectives.reload();
                onChanged();
              } catch (error) {
                toast(error.message, 'err');
              }
            },
          }, 'Create from this preset'),
        ),
      ))),
    ),

    assigning === null ? null : h(AssignObjectiveModal, {
      api,
      objective: assigning,
      campaigns: campaigns.data?.items ?? [],
      adGroups: adGroups.data?.items ?? [],
      onClose: () => setAssigning(null),
      onAssigned: () => {
        setAssigning(null);
        objectives.reload();
        onChanged();
        toast('Objective assigned');
      },
      toast,
    }),

    creating ? h(CreateObjectiveModal, {
      presets,
      onClose: () => setCreating(false),
      onCreate: async (payload) => {
        try {
          await api.saveObjective(payload);
          setCreating(false);
          objectives.reload();
          onChanged();
          toast('Objective created');
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    }) : null,
  );
}

/**
 * @param {{presets: Array<any>, onClose: Function, onCreate: (payload: any) => void}} props
 */
function CreateObjectiveModal({ presets, onClose, onCreate }) {
  const [presetId, setPresetId] = React.useState(presets[0]?.id ?? '');
  const [name, setName] = React.useState(presets[0]?.name ?? '');
  return h(Modal, {
    title: 'New strategic objective',
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'create', variant: 'primary', onClick: () => onCreate({ presetId, name }) }, 'Create'),
    ],
  },
  h('div', { className: 'sc-stack' },
    h(Field, { label: 'Preset', hint: 'Each preset creates a rule and a criteria profile per algorithm, so you can edit them afterwards.' },
      h(Select, {
        value: presetId,
        onChange: (value) => {
          setPresetId(value);
          setName(presets.find((preset) => preset.id === value)?.name ?? '');
        },
        options: presets.map((preset) => ({ value: preset.id, label: `${preset.name} — ${preset.description}` })),
      })),
    h(Field, { label: 'Objective name' }, h(Input, { value: name, onChange: setName })),
  ));
}

/**
 * @param {{api: Record<string, Function>, objective: any, campaigns: Array<any>, adGroups: Array<any>, onClose: Function, onAssigned: Function, toast: Function}} props
 */
function AssignObjectiveModal({ api, objective, campaigns, adGroups, onClose, onAssigned, toast }) {
  const [selected, setSelected] = React.useState(new Set());
  const [saving, setSaving] = React.useState(false);
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const assign = async () => {
    setSaving(true);
    try {
      const result = await api.assignObjective(objective.id, { adGroupIds: [...selected] });
      toast(`Assigned ${result.assigned} rule-target pair(s)`);
      onAssigned();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  return h(Modal, {
    title: `Assign "${objective.name}"`,
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'go', variant: 'primary', onClick: assign, disabled: saving || selected.size === 0 }, saving ? 'Assigning…' : `Assign to ${selected.size} ad group(s)`),
    ],
  },
  h('div', { className: 'sc-stack' },
    h('div', { className: 'sc-hint' }, `This assigns ${objective.rules.length} rule(s) to every selected ad group.`),
    h('div', { className: 'sc-side-list' }, adGroups.map((adGroup) => {
      const campaign = campaigns.find((entry) => entry.id === adGroup.campaignId);
      return h('label', { key: adGroup.id, className: 'sc-side-item' },
        h('input', { type: 'checkbox', checked: selected.has(adGroup.id), onChange: () => toggle(adGroup.id) }),
        h('span', null, `${campaign?.name ?? adGroup.campaignId} · ${adGroup.name}`),
      );
    })),
  ));
}

/**
 * The mass campaign builder.
 * @param {{api: Record<string, Function>, account: Record<string, any>, toast: Function, onChanged: Function}} props
 */
export function MassBuilder({ api, account, toast, onChanged }) {
  const [asins, setAsins] = React.useState('B0SILICONE01');
  const [campaignTypes, setCampaignTypes] = React.useState(['auto']);
  const [bidLadder, setBidLadder] = React.useState('0.5, 0.6, 0.7, 0.8');
  const [keywords, setKeywords] = React.useState('');
  const [matchTypes, setMatchTypes] = React.useState(['exact']);
  const [dailyBudget, setDailyBudget] = React.useState(15);
  const [defaultBid, setDefaultBid] = React.useState(0.75);
  const [naming, setNaming] = React.useState('{asin} · {campaignType} · {bid}');
  const [state, setState] = React.useState('PAUSED');
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const currency = account.currency;

  const spec = {
    asins,
    campaignTypes,
    bidLadder,
    keywords,
    matchTypes,
    dailyBudget,
    defaultBid,
    naming,
    state,
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api.massPreview(spec));
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.massCreate({ ...spec, confirm: true });
      toast(`Created ${result.created} campaign(s); ${result.failed} failed`);
      setPreview({ ...preview, result });
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const ids = (preview?.result?.campaigns ?? []).map((entry) => entry.campaignId).filter(Boolean);
    if (ids.length === 0) return;
    if (!globalThis.confirm?.(`Delete the ${ids.length} campaign(s) this batch created?`)) return;
    try {
      const result = await api.massUndo({ confirm: true, campaignIds: ids });
      toast(`Deleted ${result.deleted} campaign(s)`);
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  const toggleType = (type) => {
    setCampaignTypes((current) => (current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]));
  };
  const toggleMatch = (type) => {
    setMatchTypes((current) => (current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]));
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-grid sc-grid-2' },
      h(Card, { title: 'Campaign batch' },
        h('div', { className: 'sc-stack' },
          h(Field, { label: 'ASINs', hint: 'Comma or newline separated.' }, h(Textarea, { value: asins, onChange: setAsins, rows: 3 })),
          h(Field, { label: 'Campaign types' },
            h('div', { className: 'sc-row-tight' }, ['auto', 'manual', 'asin'].map((type) => h(Button, {
              key: type,
              size: 'sm',
              variant: campaignTypes.includes(type) ? 'primary' : undefined,
              onClick: () => toggleType(type),
            }, type === 'auto' ? 'Auto' : type === 'manual' ? 'Manual' : 'ASIN targeting'))),
          ),
          campaignTypes.includes('auto')
            ? h(Field, { label: 'Bid ladder (auto campaigns)', hint: 'One auto campaign per bid, so traffic tiers can be compared.' },
              h(Input, { value: bidLadder, onChange: setBidLadder }))
            : null,
          campaignTypes.includes('manual') || campaignTypes.includes('asin')
            ? h(Field, { label: 'Keyword seeds (manual campaigns)', hint: 'Each seed becomes one keyword per selected match type.' },
              h(Textarea, { value: keywords, onChange: setKeywords, rows: 3, placeholder: 'silicone spatula\nheat resistant spatula' }))
            : null,
          h(Field, { label: 'Match types' },
            h('div', { className: 'sc-row-tight' }, ['exact', 'phrase', 'broad'].map((type) => h(Button, {
              key: type,
              size: 'sm',
              variant: matchTypes.includes(type) ? 'primary' : undefined,
              onClick: () => toggleMatch(type),
            }, type))),
          ),
          h('div', { className: 'sc-grid sc-grid-3' },
            h(Field, { label: 'Daily budget' }, h(Input, { type: 'number', value: dailyBudget, min: 1, onChange: setDailyBudget })),
            h(Field, { label: 'Default bid' }, h(Input, { type: 'number', value: defaultBid, min: 0.02, step: 0.01, onChange: setDefaultBid })),
            h(Field, { label: 'Initial state' }, h(Select, {
              value: state,
              onChange: setState,
              options: [{ value: 'PAUSED', label: 'Paused (recommended)' }, { value: 'ENABLED', label: 'Enabled' }],
            })),
          ),
          h(Field, { label: 'Naming template', hint: 'Tokens: {asin} {index} {bid} {campaignType} {date} {matchType}' },
            h(Input, { value: naming, onChange: setNaming })),
          h('div', { className: 'sc-row' },
            h(Button, { onClick: runPreview, disabled: busy }, busy ? 'Working…' : 'Preview batch'),
            preview?.plans?.length > 0 ? h(Button, { variant: 'primary', onClick: create, disabled: busy }, `Create ${preview.plans.length} campaign(s)`) : null,
            preview?.result?.campaigns?.length > 0 ? h(Button, { variant: 'danger', onClick: undo, disabled: busy }, 'Undo this batch') : null,
          ),
        ),
      ),
      h(Card, { title: 'Batch preview' },
        preview === null
          ? h('div', { className: 'sc-hint' }, 'Preview the batch to see every campaign, its budget, and its keywords before anything is created.')
          : h('div', { className: 'sc-stack' },
            h(Banner, null, `${preview.plans?.length ?? 0} campaign(s) planned. Campaigns are created paused unless you chose otherwise.`),
            h(Table, {
              columns: [
                { key: 'name', label: 'Name', wrap: true },
                { key: 'targetingType', label: 'Targeting' },
                { key: 'dailyBudget', label: 'Budget', numeric: true, render: (row) => fmt(row.dailyBudget, 'spend', currency) },
                { key: 'defaultBid', label: 'Bid', numeric: true, render: (row) => fmt(row.defaultBid, 'spend', currency) },
                { key: 'keywords', label: 'Keywords', numeric: true, render: (row) => String(row.keywords.length) },
              ],
              rows: preview.plans ?? [],
              rowKey: (row) => String(row.index),
            }),
          ),
      ),
    ),
  );
}
