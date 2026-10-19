/**
 * Campaigns: structure browsing plus the action surface for a campaign.
 *
 * Three panes in one view — campaigns, ad groups, keywords — with the rules
 * assigned at each level and a one-click way to assign more. This is where a
 * person confirms that automation is pointed at the right ads.
 * @module client/views/campaigns
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Input, Select, fmt, Banner } from '../lib/ui.js';
import { useResource, useDebounced } from '../lib/state.js';

const h = React.createElement;

const STATE_TONE = { ENABLED: 'ok', PAUSED: 'warn', ARCHIVED: '' };

/**
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number, focus?: any, onAssign: (target: any) => void, onPreview: (scope: any) => void}} props
 */
export function Campaigns({ api, account, days, focus, onAssign, onPreview }) {
  const [campaignId, setCampaignId] = React.useState(focus?.campaignId ?? '');
  const [search, setSearch] = React.useState('');
  const [stateFilter, setStateFilter] = React.useState('');
  const [adGroupId, setAdGroupId] = React.useState('');
  const debounced = useDebounced(search);
  const currency = account.currency;

  const campaigns = useResource(
    () => api.campaigns({ days, search: debounced, state: stateFilter }),
    [days, debounced, stateFilter],
  );
  const adGroups = useResource(
    () => (campaignId === '' ? Promise.resolve({ items: [] }) : api.adGroups({ days, campaignId })),
    [days, campaignId],
    { enabled: campaignId !== '' },
  );
  const keywords = useResource(
    () => (adGroupId === '' ? Promise.resolve({ items: [] }) : api.keywords({ days, adGroupId, limit: 500 })),
    [days, adGroupId],
    { enabled: adGroupId !== '' },
  );

  const items = campaigns.data?.items ?? [];
  const selected = items.find((campaign) => campaign.id === campaignId);

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Input, { value: search, onChange: setSearch, placeholder: 'Search campaigns…', ariaLabel: 'Search campaigns', style: { width: 240 } }),
      h(Select, {
        value: stateFilter,
        onChange: setStateFilter,
        ariaLabel: 'Filter by state',
        options: [
          { value: '', label: 'All states' },
          { value: 'ENABLED', label: 'Enabled' },
          { value: 'PAUSED', label: 'Paused' },
        ],
      }),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${items.length} campaign(s)`),
      selected === undefined ? null : h(Button, { size: 'sm', onClick: () => onPreview({ campaignId }) }, 'Preview this campaign'),
    ),
    campaigns.error === null ? null : h(Banner, { tone: 'warn' }, campaigns.error.message),
    h('div', { className: 'sc-split' },
      h('div', { className: 'sc-stack' },
        h(Card, { title: 'Campaigns' },
          campaigns.loading && items.length === 0
            ? h(Spinner, { label: 'Loading campaigns…' })
            : h(Table, {
              columns: [
                { key: 'name', label: 'Name', wrap: true, render: (row) => h('button', {
                  type: 'button',
                  className: 'sc-btn sc-btn-ghost sc-btn-sm',
                  style: { padding: 0, textAlign: 'left' },
                  onClick: (event) => {
                    event.stopPropagation();
                    setCampaignId(row.id);
                    setAdGroupId('');
                  },
                }, row.name) },
                { key: 'targetingType', label: 'Targeting', render: (row) => h(Badge, null, row.targetingType) },
                { key: 'state', label: 'State', render: (row) => h(Badge, { tone: STATE_TONE[row.state] }, row.state) },
                { key: 'budget', label: 'Budget', numeric: true, render: (row) => (row.budget === null ? '—' : fmt(row.budget, 'spend', currency)) },
                { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.metrics.spend, 'spend', currency) },
                { key: 'sales', label: 'Sales', numeric: true, render: (row) => fmt(row.metrics.sales, 'sales', currency) },
                { key: 'acos', label: 'ACOS', numeric: true, render: (row) => fmt(row.metrics.acos, 'acos') },
                { key: 'adGroupCount', label: 'AGs', numeric: true },
                { key: 'rules', label: 'Rules', numeric: true, render: (row) => h('span', { className: row.rules.length === 0 ? 'sc-flat' : '' }, String(row.rules.length)) },
              ],
              rows: items,
              rowKey: (row) => row.id,
              onRowClick: (row) => {
                setCampaignId(row.id);
                setAdGroupId('');
              },
              empty: h(Empty, {
                title: 'No campaigns',
                body: 'Sync the account to pull its campaigns from Amazon.',
              }),
            }),
        ),

        campaignId === '' ? h(Card, { title: 'Ad groups' }, h('div', { className: 'sc-hint' }, 'Select a campaign to see its ad groups.'))
          : h(Card, {
            title: `Ad groups — ${selected?.name ?? campaignId}`,
            actions: h(Button, { size: 'sm', variant: 'ghost', onClick: () => onAssign({ campaignId }) }, 'Assign a rule to the campaign'),
          },
          adGroups.loading ? h(Spinner, { label: 'Loading ad groups…' })
            : h(Table, {
              columns: [
                { key: 'name', label: 'Ad group', wrap: true, render: (row) => h('button', {
                  type: 'button',
                  className: 'sc-btn sc-btn-ghost sc-btn-sm',
                  style: { padding: 0, textAlign: 'left' },
                  onClick: () => setAdGroupId(row.id),
                }, row.name) },
                { key: 'state', label: 'State', render: (row) => h(Badge, { tone: STATE_TONE[row.state] }, row.state) },
                { key: 'defaultBid', label: 'Default bid', numeric: true, render: (row) => (row.defaultBid === null ? '—' : fmt(row.defaultBid, 'spend', currency)) },
                { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.metrics.spend, 'spend', currency) },
                { key: 'acos', label: 'ACOS', numeric: true, render: (row) => fmt(row.metrics.acos, 'acos') },
                { key: 'schedule', label: 'Schedule', render: (row) => (row.schedule === null ? h('span', { className: 'sc-flat' }, '—') : h(Badge, { tone: 'brand' }, `${row.schedule.hours.filter((hour) => hour.enabled).length}h`)) },
                { key: 'rules', label: 'Rules', numeric: true, render: (row) => String(row.rules.length) },
                { key: 'actions', label: '', render: (row) => h(Button, { size: 'sm', variant: 'ghost', onClick: () => onAssign({ campaignId, adGroupId: row.id }) }, 'Assign') },
              ],
              rows: adGroups.data?.items ?? [],
              rowKey: (row) => row.id,
              onRowClick: (row) => setAdGroupId(row.id),
            }),
          ),
      ),

      h('div', { className: 'sc-stack' },
        h(Card, { title: 'Keywords and targets' },
          adGroupId === ''
            ? h('div', { className: 'sc-hint' }, 'Select an ad group to see its keywords and product targets.')
            : keywords.loading
              ? h(Spinner, { label: 'Loading keywords…' })
              : h('div', { className: 'sc-table-wrap', style: { maxHeight: 520 } },
                h('table', { className: 'sc-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, 'Keyword'),
                    h('th', null, 'Match'),
                    h('th', { className: 'sc-num' }, 'Bid'),
                    h('th', { className: 'sc-num' }, 'Clicks'),
                    h('th', { className: 'sc-num' }, 'ACOS'),
                  )),
                  h('tbody', null, (keywords.data?.items ?? []).map((keyword) => h('tr', { key: keyword.id },
                    h('td', { className: 'sc-wrap' }, keyword.text, keyword.state !== 'ENABLED' ? h('span', { style: { marginLeft: 6 } }, h(Badge, { tone: 'warn' }, keyword.state)) : null),
                    h('td', null, h(Badge, null, keyword.matchType)),
                    h('td', { className: 'sc-num' }, keyword.bid === null ? '—' : fmt(keyword.bid, 'spend', currency)),
                    h('td', { className: 'sc-num' }, String(keyword.metrics.clicks ?? 0)),
                    h('td', { className: 'sc-num' }, fmt(keyword.metrics.acos, 'acos')),
                  ))),
                ),
              ),
        ),
        h(Card, { title: 'Assigned rules' },
          selected === undefined || selected.rules.length === 0
            ? h('div', { className: 'sc-hint' }, 'No rule is assigned to this campaign yet.')
            : h('div', { className: 'sc-stack' }, selected.rules.map((rule) => h('div', { key: rule.assignmentId, className: 'sc-row', style: { justifyContent: 'space-between', fontSize: 12.5 } },
              h('span', null, rule.ruleName || rule.ruleId),
              h(Badge, { tone: 'brand' }, rule.kind),
            ))),
        ),
      ),
    ),
  );
}
