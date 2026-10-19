/**
 * Add one negative keyword by hand, straight to Amazon.
 * @module client/views/negative
 */

import React from 'react';
import { Modal, Button, Field, Select, Input, Spinner, Banner } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, account: any, term: any, onClose: Function, onAdded: Function, toast: Function}} props
 */
export function NegativeModal({ api, account, term, onClose, onAdded, toast }) {
  const campaigns = useResource(() => api.campaigns({}), []);
  const [campaignId, setCampaignId] = React.useState(term.campaignId ?? '');
  const adGroups = useResource(
    () => (campaignId === '' ? Promise.resolve({ items: [] }) : api.adGroups({ campaignId })),
    [campaignId],
    { enabled: campaignId !== '' },
  );
  const [adGroupId, setAdGroupId] = React.useState(term.adGroupId ?? '');
  const [text, setText] = React.useState(term.name ?? term.text ?? '');
  const [matchType, setMatchType] = React.useState('negativeExact');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.addNegative({ adGroupId, text, matchType });
      toast('Negative keyword created in Amazon');
      onAdded();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return h(Modal, {
    title: 'Add a negative keyword',
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'go', variant: 'primary', onClick: save, disabled: saving || adGroupId === '' || text.trim() === '' }, saving ? 'Creating…' : 'Create negative'),
    ],
  },
  h('div', { className: 'sc-stack' },
    h(Banner, { tone: 'warn' }, `This writes directly to ${account.provider === 'sandbox' ? 'the sandbox' : 'Amazon'} and is recorded in the audit log.`),
    h(Field, { label: 'Campaign' }, h(Select, {
      value: campaignId,
      onChange: (value) => {
        setCampaignId(value);
        setAdGroupId('');
      },
      options: [{ value: '', label: 'Choose a campaign…' }, ...(campaigns.data?.items ?? []).map((campaign) => ({ value: campaign.id, label: campaign.name }))],
    })),
    h(Field, { label: 'Ad group' }, adGroups.loading
      ? h(Spinner, null)
      : h(Select, {
        value: adGroupId,
        onChange: setAdGroupId,
        options: [{ value: '', label: 'Choose an ad group…' }, ...(adGroups.data?.items ?? []).map((adGroup) => ({ value: adGroup.id, label: adGroup.name }))],
      })),
    h(Field, { label: 'Search term' }, h(Input, { value: text, onChange: setText })),
    h(Field, { label: 'Match type' }, h(Select, {
      value: matchType,
      onChange: setMatchType,
      options: [{ value: 'negativeExact', label: 'Negative exact' }, { value: 'negativePhrase', label: 'Negative phrase' }],
    })),
  ));
}
