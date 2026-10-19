/**
 * The rule assignment dialog: pick one rule, pick the campaigns or ad groups.
 * @module client/views/assign
 */

import React from 'react';
import { Modal, Button, Field, Select, Input, Spinner, Badge } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, target: {ruleId?: string, campaignId?: string, adGroupId?: string}, onClose: Function, onAssigned: Function, toast: Function}} props
 */
export function AssignModal({ api, target, onClose, onAssigned, toast }) {
  const rules = useResource(() => api.rules(), []);
  const campaigns = useResource(() => api.campaigns({}), []);
  const adGroups = useResource(() => api.adGroups({}), []);
  const [ruleId, setRuleId] = React.useState(target.ruleId ?? '');
  const [level, setLevel] = React.useState(target.adGroupId === undefined ? 'campaign' : 'adGroup');
  const [selected, setSelected] = React.useState(new Set(target.adGroupId !== undefined ? [target.adGroupId] : (target.campaignId !== undefined ? [target.campaignId] : [])));
  const [search, setSearch] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const options = level === 'campaign'
    ? (campaigns.data?.items ?? []).map((campaign) => ({ id: campaign.id, label: campaign.name }))
    : (adGroups.data?.items ?? []).map((adGroup) => {
      const campaign = (campaigns.data?.items ?? []).find((entry) => entry.id === adGroup.campaignId);
      return { id: adGroup.id, label: `${campaign?.name ?? adGroup.campaignId} · ${adGroup.name}` };
    });
  const filtered = options.filter((option) => search.trim().length === 0 || option.label.toLowerCase().includes(search.trim().toLowerCase()));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    if (ruleId === '') {
      toast('Choose a rule first', 'err');
      return;
    }
    setSaving(true);
    try {
      const result = await api.assign(ruleId, level === 'campaign' ? { campaignIds: [...selected] } : { adGroupIds: [...selected] });
      toast(`Assigned to ${result.assigned} target(s)`);
      onAssigned();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return h(Modal, {
    title: 'Assign a rule',
    onClose,
    width: 640,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'go', variant: 'primary', onClick: save, disabled: saving || selected.size === 0 || ruleId === '' }, saving ? 'Assigning…' : `Assign to ${selected.size}`),
    ],
  },
  h('div', { className: 'sc-stack' },
    h(Field, { label: 'Rule' }, rules.loading
      ? h(Spinner, null)
      : h(Select, {
        value: ruleId,
        onChange: setRuleId,
        options: [{ value: '', label: 'Choose a rule…' }, ...(rules.data?.items ?? []).map((rule) => ({ value: rule.id, label: `${rule.name} (${rule.kind})` }))],
      })),
    h('div', { className: 'sc-grid sc-grid-2' },
      h(Field, { label: 'Assign to' }, h(Select, {
        value: level,
        onChange: (value) => {
          setLevel(value);
          setSelected(new Set());
        },
        options: [{ value: 'campaign', label: 'Campaigns' }, { value: 'adGroup', label: 'Ad groups' }],
      })),
      h(Field, { label: 'Filter' }, h(Input, { value: search, onChange: setSearch, placeholder: 'Search…' })),
    ),
    h('div', { className: 'sc-side-list' }, filtered.slice(0, 400).map((option) => h('label', { key: option.id, className: 'sc-side-item' },
      h('input', { type: 'checkbox', checked: selected.has(option.id), onChange: () => toggle(option.id) }),
      h('span', null, option.label),
    ))),
    h('div', { className: 'sc-row' },
      h(Button, { size: 'sm', onClick: () => setSelected(new Set(filtered.map((option) => option.id))) }, 'Select all shown'),
      h(Button, { size: 'sm', onClick: () => setSelected(new Set()) }, 'Clear'),
    ),
  ));
}
