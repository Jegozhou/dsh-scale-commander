/**
 * Insights: the analysis surfaces.
 *
 * Search terms, unique words, dead keywords, placement performance and sales
 * attribution. Each tab is a ranked table with the same column semantics, so a
 * person can move between them without relearning the layout.
 * @module client/views/insights
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Select, Input, fmt, LineChart } from '../lib/ui.js';
import { useResource, useDebounced } from '../lib/state.js';

const h = React.createElement;

const LEVELS = [
  { value: 'campaign', label: 'Campaigns' },
  { value: 'adGroup', label: 'Ad groups' },
  { value: 'keyword', label: 'Keywords' },
  { value: 'target', label: 'Product targets' },
  { value: 'searchTerm', label: 'Search terms' },
  { value: 'word', label: 'Unique words' },
];

/**
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number, focus?: any, onNegative: (term: any) => void}} props
 */
export function Insights({ api, account, days, focus, onNegative }) {
  const [level, setLevel] = React.useState(focus?.level ?? 'searchTerm');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('spend');
  const [minClicks, setMinClicks] = React.useState(0);
  const debounced = useDebounced(search);
  const currency = account.currency;

  const rows = useResource((signal) => {
    if (level === 'word') return api.words({ days, search: debounced, minClicks });
    if (level === 'searchTerm') return api.breakdown({ level: 'searchTerm', days, sort, search: debounced, limit: 300 });
    return api.breakdown({ level, days, sort, search: debounced, limit: 300 });
  }, [level, days, sort, debounced, minClicks]);

  const items = rows.data?.items ?? [];
  const totals = items.reduce((acc, row) => ({
    spend: acc.spend + Number(row.spend ?? 0),
    sales: acc.sales + Number(row.sales ?? 0),
    clicks: acc.clicks + Number(row.clicks ?? 0),
    orders: acc.orders + Number(row.orders ?? 0),
  }), { spend: 0, sales: 0, clicks: 0, orders: 0 });

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Select, { value: level, onChange: setLevel, ariaLabel: 'Analysis level', options: LEVELS }),
      h(Input, { value: search, onChange: setSearch, placeholder: 'Filter by name…', ariaLabel: 'Filter rows', style: { width: 200 } }),
      level === 'word' ? h(Input, { type: 'number', value: minClicks, onChange: setMinClicks, ariaLabel: 'Minimum clicks', placeholder: 'min clicks', style: { width: 110 }, min: 0 }) : null,
      h(Select, {
        value: sort,
        onChange: setSort,
        ariaLabel: 'Sort by',
        options: [
          { value: 'spend', label: 'Sort: spend' },
          { value: 'sales', label: 'Sort: sales' },
          { value: 'acos', label: 'Sort: ACOS' },
          { value: 'clicks', label: 'Sort: clicks' },
          { value: 'orders', label: 'Sort: orders' },
          { value: 'ctr', label: 'Sort: CTR' },
        ],
      }),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${items.length} row(s) · ${fmt(totals.spend, 'spend', currency)} spend · ${fmt(totals.clicks, 'clicks')} clicks`),
    ),
    rows.loading && rows.data === undefined
      ? h(Spinner, { label: 'Aggregating performance…' })
      : h(Table, {
        columns: columnsFor(level, currency, onNegative),
        rows: items,
        rowKey: (row) => `${row.id}-${row.name}`,
        empty: h(Empty, {
          title: 'No rows',
          body: level === 'word'
            ? 'Run a search-term sync to populate unique-word performance.'
            : 'Sync the account, or widen the date window.',
        }),
      }),
  );
}

/**
 * @param {string} level
 * @param {string} currency
 * @param {(term: any) => void} onNegative
 */
function columnsFor(level, currency, onNegative) {
  const base = [
    { key: 'name', label: level === 'word' ? 'Word' : 'Name', wrap: true, render: (row) => (level === 'word'
      ? h('span', null, row.word, row.terms === undefined ? null : h('span', { className: 'sc-hint', style: { marginLeft: 6 } }, `${row.terms} term(s)`))
      : h('span', { title: row.id }, row.name)) },
  ];
  if (level === 'keyword' || level === 'target') {
    base.push({ key: 'matchType', label: 'Match', render: (row) => (row.matchType === undefined ? '—' : h(Badge, null, row.matchType)) });
    base.push({ key: 'bid', label: 'Bid', numeric: true, render: (row) => (row.bid === null || row.bid === undefined ? '—' : fmt(row.bid, 'spend', currency)) });
  }
  if (level === 'searchTerm' || level === 'word') {
    base.push({ key: 'adGroupCount', label: 'AGs', numeric: true, render: (row) => String(row.adGroupCount ?? '—') });
  }
  return [
    ...base,
    { key: 'impressions', label: 'Impr.', numeric: true, render: (row) => fmt(row.impressions, 'impressions') },
    { key: 'clicks', label: 'Clicks', numeric: true, render: (row) => fmt(row.clicks, 'clicks') },
    { key: 'ctr', label: 'CTR', numeric: true, render: (row) => fmt(row.ctr, 'ctr') },
    { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.spend, 'spend', currency) },
    { key: 'sales', label: 'Sales', numeric: true, render: (row) => fmt(row.sales, 'sales', currency) },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'acos', label: 'ACOS', numeric: true, render: (row) => h('span', { className: row.acos > 50 && row.orders > 0 ? 'sc-down' : '' }, fmt(row.acos, 'acos')) },
    { key: 'cvr', label: 'CVR', numeric: true, render: (row) => fmt(row.cvr, 'cvr') },
    level === 'searchTerm' ? { key: 'action', label: '', render: (row) => h(Button, { size: 'sm', variant: 'ghost', onClick: () => onNegative(row) }, 'Negate') } : { key: 'action', label: '', render: () => null },
  ];
}

/**
 * Dayparting: the hourly heatmap and schedule editor.
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number, toast: (message: string, tone?: 'ok'|'err') => void}} props
 */
export function Dayparting({ api, account, days, toast }) {
  const [campaignId, setCampaignId] = React.useState('');
  const [adGroupId, setAdGroupId] = React.useState('');
  const [metric, setMetric] = React.useState('sales');
  const [selection, setSelection] = React.useState(() => Array.from({ length: 24 }, () => true));
  const [modifiers, setModifiers] = React.useState(() => Array.from({ length: 24 }, () => 0));
  const [saving, setSaving] = React.useState(false);

  const campaigns = useResource(() => api.campaigns({ days }), [days]);
  const adGroups = useResource(
    () => (campaignId === '' ? Promise.resolve({ items: [] }) : api.adGroups({ campaignId })),
    [campaignId],
    { enabled: campaignId !== '' },
  );
  const heatmap = useResource(
    () => api.heatmap({ days, campaignId, adGroupId }),
    [days, campaignId, adGroupId],
  );

  const cells = heatmap.data?.cells ?? [];
  const byHour = heatmap.data?.byHour ?? [];
  const max = Math.max(1, ...byHour.map((row) => Number(row.metrics?.[metric] ?? 0)));

  const toggleHour = (hour) => {
    setSelection((current) => current.map((value, index) => (index === hour ? !value : value)));
  };
  const setModifier = (hour, value) => {
    setModifiers((current) => current.map((entry, index) => (index === hour ? value : entry)));
  };

  const save = async () => {
    if (adGroupId === '') {
      toast('Select an ad group before saving a schedule', 'err');
      return;
    }
    setSaving(true);
    try {
      await api.saveSchedule({
        adGroupId,
        mode: 'schedule',
        hours: Array.from({ length: 24 }, (_, hour) => ({ hour, enabled: selection[hour], modifier: modifiers[hour] })),
      });
      toast('Schedule saved; the scheduler enforces it at the top of each hour');
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Select, {
        value: campaignId,
        onChange: (value) => {
          setCampaignId(value);
          setAdGroupId('');
        },
        ariaLabel: 'Campaign',
        options: [{ value: '', label: 'All campaigns' }, ...(campaigns.data?.items ?? []).map((campaign) => ({ value: campaign.id, label: campaign.name }))],
      }),
      h(Select, {
        value: adGroupId,
        onChange: setAdGroupId,
        ariaLabel: 'Ad group',
        options: [{ value: '', label: 'All ad groups' }, ...(adGroups.data?.items ?? []).map((adGroup) => ({ value: adGroup.id, label: adGroup.name }))],
      }),
      h(Select, {
        value: metric,
        onChange: setMetric,
        ariaLabel: 'Heatmap metric',
        options: [{ value: 'sales', label: 'Sales' }, { value: 'spend', label: 'Spend' }, { value: 'orders', label: 'Orders' }, { value: 'clicks', label: 'Clicks' }],
      }),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${heatmap.data?.timezone ?? account.timezone} · hour ${String(heatmap.data?.currentHour ?? 0).padStart(2, '0')}`),
    ),

    heatmap.loading && heatmap.data === undefined
      ? h(Spinner, { label: 'Loading hourly performance…' })
      : heatmap.data?.hasData !== true
        ? h(Empty, {
          title: 'No hourly data',
          body: 'Hourly performance comes from the Amazon hourly report. Run a sync with hourly enabled.',
          action: h(Button, { onClick: heatmap.reload }, 'Retry'),
        })
        : h('div', { className: 'sc-grid sc-grid-2' },
          h(Card, { title: `${metric} by day and hour` },
            h('div', { className: 'sc-heat' },
              h('div', { className: 'sc-heat-label' }, ''),
              Array.from({ length: 24 }, (_, hour) => h('div', { key: `h${hour}`, className: 'sc-heat-hour' }, hour % 3 === 0 ? String(hour).padStart(2, '0') : '')),
              [1, 2, 3, 4, 5, 6, 7].map((weekday) => [
                h('div', { key: `d${weekday}`, className: 'sc-heat-label' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday - 1]),
                ...Array.from({ length: 24 }, (_, hour) => {
                  const cell = cells.find((entry) => entry.dayOfWeek === weekday % 7 && entry.hour === hour);
                  const value = Number(cell?.[metric] ?? 0);
                  const intensity = max === 0 ? 0 : value / max;
                  return h('div', {
                    key: `c${weekday}-${hour}`,
                    className: 'sc-heat-cell',
                    title: `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday - 1]} ${String(hour).padStart(2, '0')}:00 — ${fmt(value, metric === 'spend' || metric === 'sales' ? 'spend' : 'clicks', account.currency)}`,
                    style: { background: `color-mix(in srgb, var(--dsw-alias-brand-primary) ${Math.round(intensity * 85) + (intensity > 0 ? 8 : 0)}%, var(--dsw-alias-bg-layer-2))` },
                  });
                }),
              ]),
            ),
            h('div', { className: 'sc-hint', style: { marginTop: 8 } }, 'Darker cells are stronger hours. Hover for the exact value.'),
          ),
          h(Card, { title: 'Schedule editor' },
            h('div', { className: 'sc-stack' },
              h('div', { className: 'sc-row-tight', style: { flexWrap: 'wrap' } },
                Array.from({ length: 24 }, (_, hour) => h('button', {
                  key: hour,
                  type: 'button',
                  className: `sc-chip ${selection[hour] ? 'sc-chip-on' : ''}`,
                  style: { cursor: 'pointer', minWidth: 34 },
                  onClick: () => toggleHour(hour),
                  title: `${String(hour).padStart(2, '0')}:00 — click to ${selection[hour] ? 'pause' : 'enable'}`,
                }, String(hour).padStart(2, '0'))),
              ),
              h('div', { className: 'sc-row' },
                h(Button, { size: 'sm', onClick: () => setSelection(Array.from({ length: 24 }, () => true)) }, 'All on'),
                h(Button, { size: 'sm', onClick: () => setSelection(Array.from({ length: 24 }, () => false)) }, 'All off'),
                h(Button, {
                  size: 'sm',
                  onClick: () => {
                    // Smart select: enable the hours whose metric is in the top half.
                    const values = byHour.map((row) => Number(row.metrics?.[metric] ?? 0));
                    const sorted = [...values].sort((a, b) => b - a);
                    const threshold = sorted[Math.floor(sorted.length / 2)] ?? 0;
                    setSelection(byHour.map((row) => Number(row.metrics?.[metric] ?? 0) >= threshold));
                  },
                }, 'Smart select'),
              ),
              h('span', { className: 'sc-label' }, 'Hourly bid modifier (%)'),
              h('div', { className: 'sc-row-tight', style: { flexWrap: 'wrap' } },
                Array.from({ length: 24 }, (_, hour) => h('div', { key: hour, className: 'sc-field', style: { width: 50 } },
                  h('span', { className: 'sc-hint', style: { textAlign: 'center' } }, String(hour).padStart(2, '0')),
                  h(Input, { type: 'number', value: modifiers[hour], min: -90, max: 900, onChange: (value) => setModifier(hour, value) }),
                )),
              ),
              h('div', { className: 'sc-row' },
                h(Button, { variant: 'primary', onClick: save, disabled: saving || adGroupId === '' }, saving ? 'Saving…' : 'Save schedule'),
                adGroupId === '' ? h('span', { className: 'sc-hint' }, 'Pick one ad group to save a schedule.') : null,
              ),
            ),
          ),
        ),

    h(Card, { title: 'Hourly totals', style: { marginTop: 14 } },
      h(LineChart, {
        points: byHour.map((row) => ({ x: String(row.hour).padStart(2, '0'), y: row.metrics?.[metric] ?? 0 })),
        label: `Hourly ${metric}`,
        currency: account.currency,
        metric: metric === 'spend' || metric === 'sales' ? 'spend' : 'clicks',
        height: 130,
      }),
    ),
  );
}

/**
 * Attribution and unit economics.
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number}} props
 */
export function Attribution({ api, account, days }) {
  const data = useResource(() => api.attribution({ days }), [days]);
  const restock = useResource(() => api.restock({ days }), [days]);
  const currency = account.currency;
  if (data.loading && data.data === undefined) return h('div', { className: 'sc-body' }, h(Spinner, { label: 'Computing attribution…' }));
  if (data.error !== null) return h('div', { className: 'sc-body' }, h(Empty, { title: 'Attribution unavailable', body: data.error.message }));
  const summary = data.data.summary;

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-grid sc-grid-kpi' },
      h(Card, null, h('div', { className: 'sc-card-title' }, 'Total sales'), h('div', { className: 'sc-card-value' }, fmt(summary.totalSales, 'sales', currency)), h('div', { className: 'sc-card-meta' }, `ads ${fmt(summary.sales, 'sales', currency)} + organic ${fmt(summary.organicSales, 'sales', currency)}`)),
      h(Card, null, h('div', { className: 'sc-card-title' }, 'Ad share'), h('div', { className: 'sc-card-value' }, fmt(summary.adShare, 'ctr')), h('div', { className: 'sc-card-meta' }, `organic ${fmt(summary.organicShare, 'ctr')}`)),
      h(Card, null, h('div', { className: 'sc-card-title' }, 'TACOS'), h('div', { className: 'sc-card-value' }, fmt(summary.tacos, 'acos')), h('div', { className: 'sc-card-meta' }, 'ad spend / total sales')),
      h(Card, null, h('div', { className: 'sc-card-title' }, 'Profit'), h('div', { className: 'sc-card-value' }, fmt(summary.profit, 'spend', currency)), h('div', { className: 'sc-card-meta' }, `margin ${fmt(summary.margin, 'ctr')}`)),
    ),
    h('div', { className: 'sc-grid sc-grid-2', style: { marginTop: 14 } },
      h(Card, { title: 'By ASIN' },
        h(Table, {
          columns: [
            { key: 'asin', label: 'ASIN', render: (row) => h('span', { className: 'sc-mono' }, row.asin) },
            { key: 'title', label: 'Product', wrap: true },
            { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.spend, 'spend', currency) },
            { key: 'sales', label: 'Ad sales', numeric: true, render: (row) => fmt(row.sales, 'sales', currency) },
            { key: 'organicSales', label: 'Organic', numeric: true, render: (row) => fmt(row.organicSales, 'sales', currency) },
            { key: 'totalSales', label: 'Total', numeric: true, render: (row) => fmt(row.totalSales, 'sales', currency) },
            { key: 'tacos', label: 'TACOS', numeric: true, render: (row) => fmt(row.tacos, 'acos') },
            { key: 'margin', label: 'Margin', numeric: true, render: (row) => fmt(row.margin, 'ctr') },
          ],
          rows: data.data.byAsin,
          rowKey: (row) => row.asin,
        }),
      ),
      h(Card, { title: 'Sales trend' },
        h(LineChart, {
          points: data.data.series.map((row) => ({ x: row.date, y: Number(row.sales ?? 0) + Number(row.organicSales ?? 0) })),
          label: 'Daily total sales',
          currency,
          metric: 'sales',
        }),
      ),
    ),
    h(Card, { title: 'Restock forecast', style: { marginTop: 14 } },
      h(Table, {
        columns: [
          { key: 'asin', label: 'ASIN', render: (row) => h('span', { className: 'sc-mono' }, row.asin) },
          { key: 'title', label: 'Product', wrap: true },
          { key: 'unitsSold', label: 'Units', numeric: true },
          { key: 'dailyUnits', label: 'Units / day', numeric: true, render: (row) => Number(row.dailyUnits).toFixed(2) },
          { key: 'restockUnits30', label: '30-day need', numeric: true },
          { key: 'projectedRevenue30', label: '30-day revenue', numeric: true, render: (row) => fmt(row.projectedRevenue30, 'sales', currency) },
          { key: 'projectedProfit30', label: '30-day profit', numeric: true, render: (row) => fmt(row.projectedProfit30, 'spend', currency) },
        ],
        rows: restock.data?.items ?? [],
        rowKey: (row) => row.asin,
        empty: h(Empty, { title: 'No products', body: 'Add products with COGS and FBA fees to project profit and restock.' }),
      }),
    ),
  );
}

/**
 * Placement performance.
 * @param {{api: Record<string, Function>, account: Record<string, any>, days: number}} props
 */
export function Placements({ api, account, days }) {
  const data = useResource(() => api.placements({ days }), [days]);
  const currency = account.currency;
  const rows = data.data?.items ?? [];
  return h('div', { className: 'sc-body' },
    data.loading && data.data === undefined
      ? h(Spinner, { label: 'Loading placement performance…' })
      : h(Table, {
        columns: [
          { key: 'name', label: 'Campaign', wrap: true },
          { key: 'tos', label: 'TOS ACOS', numeric: true, render: (row) => fmt(row.topOfSearch.acos, 'acos') },
          { key: 'tosMod', label: 'TOS %', numeric: true, render: (row) => `${row.placements.topOfSearch ?? 0}%` },
          { key: 'pp', label: 'PP ACOS', numeric: true, render: (row) => fmt(row.productPage.acos, 'acos') },
          { key: 'ppMod', label: 'PP %', numeric: true, render: (row) => `${row.placements.productPage ?? 0}%` },
          { key: 'ros', label: 'ROS ACOS', numeric: true, render: (row) => fmt(row.restOfSearch.acos, 'acos') },
          { key: 'rosMod', label: 'ROS %', numeric: true, render: (row) => `${row.placements.restOfSearch ?? 0}%` },
          { key: 'spend', label: 'Spend', numeric: true, render: (row) => fmt(row.spend, 'spend', currency) },
        ],
        rows,
        rowKey: (row) => row.id,
        empty: h(Empty, { title: 'No placement data', body: 'Placement metrics appear after a sync that includes placement columns.' }),
      }),
  );
}
