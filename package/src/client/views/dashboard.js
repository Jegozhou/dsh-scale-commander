/**
 * Dashboard: the account at a glance.
 *
 * KPI cards with period-over-period deltas, a spend/sales trend, the biggest
 * spenders, and the alerts that deserve action today. Everything is read-only.
 * @module client/views/dashboard
 */

import React from 'react';
import { Kpi, Card, Table, LineChart, fmt, Badge, Empty, Button, Spinner } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number, onNavigate: (view: string, payload?: any) => void}} props
 */
export function Dashboard({ api, account, days, onNavigate }) {
  const overview = useResource((signal) => api.overview({ days }), [days]);
  const campaigns = useResource(() => api.breakdown({ level: 'campaign', days, sort: 'spend', limit: 8 }), [days]);
  const terms = useResource(() => api.breakdown({ level: 'searchTerm', days, sort: 'spend', limit: 8 }), [days]);

  if (overview.loading && overview.data === undefined) {
    return h('div', { className: 'sc-body' }, h(Spinner, { label: 'Loading account performance…' }));
  }
  if (overview.error !== null) {
    return h('div', { className: 'sc-body' }, h(Empty, {
      title: 'Could not load the overview',
      body: overview.error.message,
      action: h(Button, { onClick: overview.reload }, 'Try again'),
    }));
  }
  const data = overview.data;
  if (data.summary.impressions === 0) {
    return h('div', { className: 'sc-body' }, h(Empty, {
      title: 'No performance data yet',
      body: 'Run a sync to pull campaigns and metrics from Amazon, then come back.',
      action: h(Button, { variant: 'primary', onClick: () => onNavigate('accounts') }, 'Open accounts'),
    }));
  }
  const summary = data.summary;
  const deltas = data.deltas ?? {};
  const currency = account.currency;
  const series = data.series ?? [];
  const wasted = (terms.data?.items ?? []).filter((row) => row.orders === 0 && row.spend > 0).slice(0, 5);
  const winners = (campaigns.data?.items ?? []).filter((row) => row.orders > 0).slice(0, 5);

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-grid sc-grid-kpi' },
      h(Kpi, { label: 'Ad spend', value: summary.spend, format: 'currency', currency, delta: deltas.spend, tone: 'down-good' }),
      h(Kpi, { label: 'Ad sales', value: summary.sales, format: 'currency', currency, delta: deltas.sales }),
      h(Kpi, { label: 'ACOS', value: summary.acos, format: 'percent', delta: deltas.acos, tone: 'down-good' }),
      h(Kpi, { label: 'ROAS', value: summary.roas, format: 'ratio', delta: deltas.roas }),
      h(Kpi, { label: 'Orders', value: summary.orders, delta: deltas.orders }),
      h(Kpi, { label: 'CVR', value: summary.cvr, format: 'percent', delta: deltas.cvr }),
      h(Kpi, { label: 'TACOS', value: data.unitEconomics.tacos, format: 'percent', meta: 'ads + organic' }),
      h(Kpi, { label: 'Profit', value: data.unitEconomics.profit, format: 'currency', currency, meta: summary.margin === null ? 'margin unavailable' : `${summary.margin.toFixed(1)}% margin` }),
    ),

    h('div', { className: 'sc-grid sc-grid-2', style: { marginTop: 14 } },
      h(Card, {
        title: 'Spend and sales',
        actions: h('span', { className: 'sc-subtitle' }, `${data.window.start} → ${data.window.end}`),
      },
      h(LineChart, {
        points: series.map((row) => ({ x: row.date, y: row.sales })),
        label: 'Daily sales',
        currency,
        metric: 'sales',
      }),
      h(LineChart, {
        points: series.map((row) => ({ x: row.date, y: row.spend })),
        label: 'Daily spend',
        currency,
        metric: 'spend',
      }),
      ),
      h(Card, { title: 'Account composition' },
        h('div', { className: 'sc-stack' },
          row('Campaigns', `${data.totals.activeCampaigns} active / ${data.totals.campaigns} total`),
          row('Ad groups', String(data.totals.adGroups)),
          row('Keywords', String(data.totals.keywords)),
          row('Products', String(data.totals.products)),
          row('Break-even ACOS', fmt(data.unitEconomics.breakEvenAcos, 'acos')),
          h('div', { className: 'sc-hint' }, 'Break-even ACOS uses COGS and FBA fees from the product catalogue.'),
        ),
      ),
    ),

    h('div', { className: 'sc-grid sc-grid-2', style: { marginTop: 14 } },
      h(Card, {
        title: 'Biggest spenders',
        actions: h(Button, { size: 'sm', variant: 'ghost', onClick: () => onNavigate('campaigns') }, 'All campaigns'),
      },
      h(Table, {
        columns: [
          { key: 'name', label: 'Campaign', wrap: true, render: (row) => h('span', { title: row.id }, row.name) },
          { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.spend, 'spend', currency) },
          { key: 'sales', label: 'Sales', numeric: true, render: (row) => fmt(row.sales, 'sales', currency) },
          { key: 'acos', label: 'ACOS', numeric: true, render: (row) => h('span', { className: row.acos > 50 ? 'sc-down' : '' }, fmt(row.acos, 'acos')) },
          { key: 'orders', label: 'Orders', numeric: true },
        ],
        rows: campaigns.data?.items ?? [],
        rowKey: (row) => row.id,
        onRowClick: (row) => onNavigate('campaigns', { campaignId: row.id }),
      }),
      ),
      h(Card, {
        title: 'Spend without orders',
        actions: h(Button, { size: 'sm', variant: 'ghost', onClick: () => onNavigate('insights', { level: 'searchTerm' }) }, 'Search terms'),
      },
      wasted.length === 0
        ? h('div', { className: 'sc-hint' }, 'No search term spent money without an order in this window.')
        : h(Table, {
          columns: [
            { key: 'name', label: 'Search term', wrap: true },
            { key: 'clicks', label: 'Clicks', numeric: true },
            { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.spend, 'spend', currency) },
            { key: 'acos', label: 'ACOS', numeric: true, render: (row) => h(Badge, { tone: 'err' }, fmt(row.acos, 'acos')) },
          ],
          rows: wasted,
          rowKey: (row) => row.id,
        }),
      ),
    ),

    winners.length === 0 ? null : h(Card, { title: 'Top converting campaigns', style: { marginTop: 14 } },
      h('div', { className: 'sc-pill-row' }, winners.map((row) => h('button', {
        key: row.id,
        type: 'button',
        className: 'sc-chip sc-chip-on',
        style: { cursor: 'pointer' },
        onClick: () => onNavigate('campaigns', { campaignId: row.id }),
      }, `${row.name} · ${fmt(row.acos, 'acos')} ACOS`))),
    ),
  );
}

/**
 * @param {string} label
 * @param {string} value
 */
function row(label, value) {
  return h('div', { className: 'sc-row', style: { justifyContent: 'space-between', fontSize: 13 } },
    h('span', { className: 'sc-subtitle' }, label),
    h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, value),
  );
}
