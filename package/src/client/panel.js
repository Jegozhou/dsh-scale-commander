/**
 * The Scale Commander page: account picker, navigation, and the active view.
 *
 * One component owns the page so the tab strip, the account selection, and the
 * global toasts share a single state tree. Views are plain components that
 * receive the account API they need.
 * @module client/panel
 */

import React from 'react';
import { Panel, Header, Tabs, Button, Select, Badge, Spinner, Empty, Toast } from './lib/ui.js';
import { useResource, useToasts, usePersistent } from './lib/state.js';
import { accountApi, globalApi } from './lib/api.js';
import { Dashboard } from './views/dashboard.js';
import { Campaigns } from './views/campaigns.js';
import { Rules } from './views/rules.js';
import { Preview, ChangeLog, AuditLog } from './views/preview.js';
import { Insights, Dayparting, Attribution, Placements } from './views/insights.js';
import { Accounts } from './views/accounts.js';
import { Objectives, MassBuilder } from './views/objectives.js';
import { AssignModal } from './views/assign.js';
import { NegativeModal } from './views/negative.js';

const h = React.createElement;

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'rules', label: 'Rules' },
  { id: 'objectives', label: 'Objectives' },
  { id: 'preview', label: 'Preview' },
  { id: 'changelog', label: 'Change log' },
  { id: 'insights', label: 'Insights' },
  { id: 'dayparting', label: 'Dayparting' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'placements', label: 'Placements' },
  { id: 'mass', label: 'Mass campaigns' },
  { id: 'audit', label: 'Audit' },
  { id: 'accounts', label: 'Accounts' },
];

/**
 * @param {{toasts: import('./lib/state.js').ToastStore}} props
 */
export function ScaleCommanderPage({ toasts }) {
  const accounts = useResource(() => globalApi.accounts(), []);
  const meta = useResource(() => globalApi.meta(), []);
  const settings = useResource(() => globalApi.settings(), []);
  const health = useResource(() => globalApi.health(), []);
  const [accountId, setAccountId] = usePersistent('accountId', '');
  const [tab, setTab] = usePersistent('tab', 'dashboard');
  const [days, setDays] = usePersistent('days', 30);
  const [scope, setScope] = React.useState({});
  const [assigning, setAssigning] = React.useState(null);
  const [negating, setNegating] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const toastItems = useToasts(toasts);

  const list = accounts.data ?? [];
  const current = list.find((account) => account.id === accountId) ?? list[0];
  const api = React.useMemo(() => (current === undefined ? null : accountApi(current.id)), [current?.id]);

  React.useEffect(() => {
    if (current !== undefined && current.id !== accountId) setAccountId(current.id);
  }, [current?.id]);

  const refresh = React.useCallback(() => {
    accounts.reload();
    setRefreshKey((value) => value + 1);
  }, [accounts]);

  const navigate = React.useCallback((nextTab, payload) => {
    setTab(nextTab);
    if (payload !== undefined) setScope(payload);
  }, []);

  const notify = React.useCallback((message, tone) => toasts.push(message, tone), [toasts]);

  if (accounts.loading && accounts.data === undefined) {
    return h(Panel, null, h('div', { className: 'sc-body' }, h(Spinner, { label: 'Connecting to the Host…' })));
  }
  if (accounts.error !== null) {
    return h(Panel, null,
      h(Header, { title: 'Scale Commander', subtitle: 'Amazon PPC automation' }),
      h('div', { className: 'sc-body' }, h(Empty, {
        title: 'The Host did not answer',
        body: accounts.error.message,
        action: h(Button, { onClick: accounts.reload }, 'Retry'),
      })),
    );
  }

  return h(Panel, null,
    h(Header, {
      title: 'Scale Commander',
      subtitle: current === undefined ? 'Amazon PPC automation' : `${current.name} · ${current.marketplaceLabel ?? ''} · ${current.currency}`,
      actions: h('div', { className: 'sc-row-tight' },
        health.data?.scheduler?.enabled === true
          ? h(Badge, { tone: health.data.scheduler.schedule?.autoApply ? 'ok' : undefined }, health.data.scheduler.schedule?.autoApply ? 'auto-apply on' : 'manual apply')
          : h(Badge, { tone: 'warn' }, 'scheduler off'),
        current === undefined ? null : h(Select, {
          value: current.id,
          onChange: (value) => {
            setAccountId(value);
            setScope({});
          },
          ariaLabel: 'Account',
          options: list.map((account) => ({ value: account.id, label: `${account.name}${account.provider === 'sandbox' ? ' (sandbox)' : ''}` })),
        }),
        h(Select, {
          value: String(days),
          onChange: (value) => setDays(Number(value)),
          ariaLabel: 'Date range',
          options: [{ value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' }, { value: '30', label: 'Last 30 days' }, { value: '60', label: 'Last 60 days' }, { value: '90', label: 'Last 90 days' }],
        }),
        h(Button, { size: 'sm', variant: 'ghost', onClick: refresh, title: 'Refresh' }, '↻'),
      ),
    }),
    h(Tabs, { tabs: TABS, active: tab, onChange: (next) => navigate(next) }),
    current === undefined || api === null
      ? h('div', { className: 'sc-body' }, h(Empty, {
        title: 'Add an account to begin',
        body: 'A sandbox account needs no credentials and generates a realistic Amazon account so every feature can be exercised.',
        action: h(Button, { variant: 'primary', onClick: () => navigate('accounts') }, 'Go to accounts'),
      }))
      : h(Views, {
        key: `${current.id}:${refreshKey}`,
        tab,
        api,
        globalApi,
        account: current,
        accounts: list,
        meta: meta.data,
        settings: settings.data,
        days,
        scope,
        navigate,
        notify,
        refresh,
        onAssign: (target) => setAssigning(target),
        onNegative: (term) => setNegating(term),
      }),
    assigning === null || api === null ? null : h(AssignModal, {
      api,
      target: assigning,
      onClose: () => setAssigning(null),
      onAssigned: () => {
        setAssigning(null);
        notify('Rule assigned');
      },
      toast: notify,
    }),
    negating === null || api === null ? null : h(NegativeModal, {
      api,
      account: current,
      term: negating,
      onClose: () => setNegating(null),
      onAdded: () => {
        setNegating(null);
        notify('Negative added');
      },
      toast: notify,
    }),
    h('div', { className: 'sc-toast' }, toastItems.map((item) => h(Toast, { key: item.id, message: item.message, tone: item.tone }))),
  );
}

/**
 * @param {any} props
 */
function Views(props) {
  const { tab, api, account, days, scope, navigate, notify, refresh, onAssign, onNegative } = props;
  switch (tab) {
    case 'dashboard':
      return h(Dashboard, { api, account, days, onNavigate: navigate });
    case 'campaigns':
      return h(Campaigns, {
        api,
        account,
        days,
        focus: scope,
        onAssign,
        onPreview: (nextScope) => navigate('preview', nextScope),
      });
    case 'rules':
      return h(Rules, {
        api,
        meta: props.meta,
        onAssign: (ruleId) => onAssign({ ruleId }),
        toast: notify,
      });
    case 'objectives':
      return h(Objectives, { api, meta: props.meta, toast: notify, onChanged: refresh });
    case 'preview':
      return h(Preview, {
        api,
        account,
        scope,
        days,
        onApplied: () => refresh(),
        toast: notify,
      });
    case 'changelog':
      return h(ChangeLog, { api, account, toast: notify, onRolledBack: refresh });
    case 'insights':
      return h(Insights, { api, account, days, focus: scope, onNegative });
    case 'dayparting':
      return h(Dayparting, { api, account, days, toast: notify });
    case 'attribution':
      return h(Attribution, { api, account, days });
    case 'placements':
      return h(Placements, { api, account, days });
    case 'mass':
      return h(MassBuilder, { api, account, toast: notify, onChanged: refresh });
    case 'audit':
      return h(AuditLog, { api, account });
    case 'accounts':
      return h(Accounts, {
        api,
        global: props.globalApi,
        accounts: props.accounts,
        meta: props.meta,
        settings: props.settings,
        onChanged: refresh,
        toast: notify,
      });
    default:
      return h('div', { className: 'sc-body' }, h(Empty, { title: 'Unknown view', body: tab }));
  }
}
