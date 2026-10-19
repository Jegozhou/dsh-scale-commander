/**
 * Accounts: connection setup, sandbox seeding, and the settings that drive the
 * scheduler. This is the only place credentials are entered, and they are sent
 * once to the Host, which encrypts them and never returns them.
 * @module client/views/accounts
 */

import React from 'react';
import { Card, Table, Badge, Button, Empty, Spinner, Field, Input, Select, Switch, Modal, Banner } from '../lib/ui.js';
import { useResource } from '../lib/state.js';

const h = React.createElement;

/**
 * @param {{api: Record<string, Function>, global: Record<string, Function>, accounts: Array<any>, meta: any, settings: any, onChanged: () => void, toast: (message: string, tone?: 'ok'|'err') => void}} props
 */
export function Accounts({ api, global: globalApi, accounts, meta, settings, onChanged, toast }) {
  const [creating, setCreating] = React.useState(false);
  const [credentialsFor, setCredentialsFor] = React.useState(null);
  const [busy, setBusy] = React.useState('');

  const sync = async (account) => {
    setBusy(`sync:${account.id}`);
    try {
      const result = await api.sync(account.id, { days: 90, hourly: true });
      toast(`Synced ${result.metrics.rows} metric rows and ${result.searchTerms} search terms`);
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy('');
    }
  };

  const reseed = async (account) => {
    if (!globalThis.confirm?.(`Regenerate the sandbox data for "${account.name}"? Existing sandbox campaigns and metrics are replaced.`)) return;
    setBusy(`seed:${account.id}`);
    try {
      await api.seedSandbox(account.id, { days: 120 });
      toast('Sandbox regenerated');
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy('');
    }
  };

  const connect = async (account) => {
    setBusy(`connect:${account.id}`);
    try {
      const result = await globalApi.connectAccount(account.id, {});
      toast(`Connected as profile ${result.selected?.profileId ?? ''}`);
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy('');
    }
  };

  const remove = async (account) => {
    if (!globalThis.confirm?.(`Delete "${account.name}"? Its stored data and credentials are removed.`)) return;
    try {
      await globalApi.deleteAccount(account.id);
      toast('Account deleted');
      onChanged();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  return h('div', { className: 'sc-body' },
    h('div', { className: 'sc-row', style: { marginBottom: 12 } },
      h(Button, { variant: 'primary', onClick: () => setCreating(true) }, '+ Add account'),
      h('div', { className: 'sc-spacer' }),
      h('span', { className: 'sc-subtitle' }, `${accounts.length} account(s)`),
    ),

    accounts.length === 0
      ? h(Empty, {
        title: 'No advertising account yet',
        body: 'Add a sandbox account to explore every feature with realistic data, or connect a real Amazon Ads account with a Login with Amazon refresh token.',
        action: h(Button, { variant: 'primary', onClick: () => setCreating(true) }, 'Add the first account'),
      })
      : h(Table, {
        columns: [
          { key: 'name', label: 'Account', wrap: true, render: (row) => h('div', { className: 'sc-stack', style: { gap: 2 } },
            h('span', { style: { fontWeight: 600 } }, row.name),
            h('span', { className: 'sc-hint sc-mono' }, row.id),
          ) },
          { key: 'provider', label: 'Provider', render: (row) => h(Badge, { tone: row.provider === 'sandbox' ? 'warn' : 'brand' }, row.provider) },
          { key: 'marketplaceLabel', label: 'Marketplace' },
          { key: 'status', label: 'Status', render: (row) => h(Badge, { tone: row.status === 'connected' ? 'ok' : row.status === 'error' ? 'err' : 'warn' }, row.status) },
          { key: 'counts', label: 'Data', render: (row) => `${row.counts.campaigns} campaigns · ${row.counts.rules} rules` },
          { key: 'lastSyncAt', label: 'Last sync', render: (row) => (row.lastSyncAt === null ? 'never' : new Date(row.lastSyncAt).toLocaleString()) },
          { key: 'actions', label: '', render: (row) => h('div', { className: 'sc-row-tight' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => sync(row), disabled: busy === `sync:${row.id}` }, busy === `sync:${row.id}` ? 'Syncing…' : 'Sync'),
            row.provider === 'sandbox'
              ? h(Button, { size: 'sm', variant: 'ghost', onClick: () => reseed(row), disabled: busy === `seed:${row.id}` }, 'Regenerate')
              : h(Button, { size: 'sm', variant: 'ghost', onClick: () => setCredentialsFor(row) }, 'Credentials'),
            row.provider === 'sandbox' ? null : h(Button, { size: 'sm', variant: 'ghost', onClick: () => connect(row), disabled: busy === `connect:${row.id}` }, 'Test connection'),
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => remove(row) }, 'Delete'),
          ) },
        ],
        rows: accounts,
        rowKey: (row) => row.id,
      }),

    accounts.some((account) => account.lastError !== '') ? h('div', { style: { marginTop: 12 } },
      accounts.filter((account) => account.lastError !== '').map((account) => h(Banner, { key: account.id, tone: 'warn' },
        `${account.name}: ${account.lastError}`))) : null,

    h('div', { className: 'sc-grid sc-grid-2', style: { marginTop: 18 } },
      h(Card, { title: 'Automation schedule' },
        h(ScheduleSettings, { settings, global: globalApi, onSaved: onChanged, toast }),
      ),
      h(Card, { title: 'How the automation runs' },
        h('div', { className: 'sc-stack', style: { fontSize: 12.5 } },
          h('div', null, '1. The scheduler wakes every minute and checks the automation window.'),
          h('div', null, '2. It evaluates every enabled rule with an assignment, producing actions.'),
          h('div', null, '3. Each action is written to the run, sent to Amazon, and recorded with its before value.'),
          h('div', null, '4. Dayparting is enforced at the top of every hour independently of the automation window.'),
          h(Banner, null, 'Automatic apply is off by default. With it off, automation only runs when you press Apply, which keeps the audit trail under your control.'),
        ),
      ),
    ),

    creating ? h(CreateAccountModal, {
      global: globalApi,
      meta,
      onClose: () => setCreating(false),
      onCreated: () => {
        setCreating(false);
        onChanged();
      },
      toast,
    }) : null,

    credentialsFor === null ? null : h(CredentialsModal, {
      account: credentialsFor,
      global: globalApi,
      onClose: () => setCredentialsFor(null),
      onSaved: () => {
        setCredentialsFor(null);
        onChanged();
      },
      toast,
    }),
  );
}

/**
 * @param {{settings: any, global: Record<string, Function>, onSaved: () => void, toast: Function}} props
 */
function ScheduleSettings({ settings, global: globalApi, onSaved, toast }) {
  const [draft, setDraft] = React.useState(settings);
  React.useEffect(() => setDraft(settings), [settings]);
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await globalApi.saveSettings({
        autoApply: draft.autoApply,
        schedule: draft.schedule,
        defaults: draft.defaults,
      });
      toast('Settings saved');
      onSaved();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  return h('div', { className: 'sc-stack' },
    h(Switch, {
      value: draft.autoApply === true,
      onChange: (value) => setDraft({ ...draft, autoApply: value }),
      label: 'Apply automation automatically on the schedule',
    }),
    h('div', { className: 'sc-grid sc-grid-2' },
      h(Field, { label: 'Frequency' },
        h(Select, {
          value: draft.schedule.mode,
          onChange: (value) => setDraft({ ...draft, schedule: { ...draft.schedule, mode: value } }),
          options: [{ value: 'daily', label: 'Daily at a local time' }, { value: 'hourly', label: 'Every N hours' }, { value: 'interval', label: 'Fixed interval' }],
        }),
      ),
      draft.schedule.mode === 'daily'
        ? h(Field, { label: 'Hour of day (0–23)' }, h(Input, { type: 'number', value: draft.schedule.hour, min: 0, max: 23, onChange: (value) => setDraft({ ...draft, schedule: { ...draft.schedule, hour: value } }) }))
        : h(Field, { label: 'Hours between runs' }, h(Input, { type: 'number', value: draft.schedule.everyHours, min: 1, max: 24, onChange: (value) => setDraft({ ...draft, schedule: { ...draft.schedule, everyHours: value } }) })),
      h(Field, { label: 'Analysis window (days)', hint: 'How much history the algorithms read.' },
        h(Input, { type: 'number', value: draft.defaults.daysToAnalyze, min: 1, max: 365, onChange: (value) => setDraft({ ...draft, defaults: { ...draft.defaults, daysToAnalyze: value } }) })),
      h(Field, { label: 'Recent days to ignore', hint: 'Attribution lag: recent days are incomplete.' },
        h(Input, { type: 'number', value: draft.defaults.daysToIgnore, min: 0, max: 30, onChange: (value) => setDraft({ ...draft, defaults: { ...draft.defaults, daysToIgnore: value } }) })),
      h(Field, { label: 'Max actions per run' },
        h(Input, { type: 'number', value: draft.defaults.maxActionsPerRun, min: 1, max: 5000, onChange: (value) => setDraft({ ...draft, defaults: { ...draft.defaults, maxActionsPerRun: value } }) })),
    ),
    h('div', { className: 'sc-row' }, h(Button, { variant: 'primary', onClick: save, disabled: saving }, saving ? 'Saving…' : 'Save settings')),
  );
}

/**
 * @param {{global: Record<string, Function>, meta: any, onClose: Function, onCreated: Function, toast: Function}} props
 */
function CreateAccountModal({ global: globalApi, meta, onClose, onCreated, toast }) {
  const [name, setName] = React.useState('My Amazon account');
  const [provider, setProvider] = React.useState('sandbox');
  const [marketplace, setMarketplace] = React.useState('ATVPDKIKX0DER');
  const [days, setDays] = React.useState(120);
  const [saving, setSaving] = React.useState(false);
  const marketplaces = meta?.marketplaces ?? {};

  const create = async () => {
    setSaving(true);
    try {
      await globalApi.createAccount({ name, provider, marketplace, days });
      toast(provider === 'sandbox' ? 'Sandbox account created and seeded' : 'Account created — add credentials next');
      onCreated();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return h(Modal, {
    title: 'Add an advertising account',
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'create', variant: 'primary', onClick: create, disabled: saving || name.trim().length === 0 }, saving ? 'Creating…' : 'Create'),
    ],
  },
  h('div', { className: 'sc-stack' },
    h(Field, { label: 'Account name' }, h(Input, { value: name, onChange: setName })),
    h(Field, {
      label: 'Provider',
      hint: 'A sandbox account generates a realistic Amazon account locally, so every feature can be exercised without credentials.',
    }, h(Select, {
      value: provider,
      onChange: setProvider,
      options: [
        { value: 'sandbox', label: 'Sandbox — generated data, no credentials' },
        { value: 'amazon', label: 'Amazon Ads — real API with a refresh token' },
      ],
    })),
    h(Field, { label: 'Marketplace' }, h(Select, {
      value: marketplace,
      onChange: setMarketplace,
      options: Object.entries(marketplaces).map(([id, value]) => ({ value: id, label: `${value.label} (${value.currency})` })),
    })),
    provider === 'sandbox'
      ? h(Field, { label: 'Days of history to generate', hint: '120 days gives the algorithms enough data for every window.' },
        h(Input, { type: 'number', value: days, min: 30, max: 400, onChange: setDays }))
      : h(Banner, null, 'After creating the account, open Credentials and paste your Login with Amazon client id, client secret, and refresh token. They are encrypted at rest and never returned to the browser.'),
  ));
}

/**
 * @param {{account: any, global: Record<string, Function>, onClose: Function, onSaved: Function, toast: Function}} props
 */
function CredentialsModal({ account, global: globalApi, onClose, onSaved, toast }) {
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [refreshToken, setRefreshToken] = React.useState('');
  const [profileId, setProfileId] = React.useState(account.profileId ?? '');
  const [saving, setSaving] = React.useState(false);
  const status = useResource(() => globalApi.credentialStatus(account.id), [account.id]);

  const save = async () => {
    setSaving(true);
    try {
      await globalApi.saveCredentials(account.id, { clientId, clientSecret, refreshToken, profileId });
      toast('Credentials stored');
      onSaved();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return h(Modal, {
    title: `Amazon credentials — ${account.name}`,
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, 'Cancel'),
      h(Button, { key: 'save', variant: 'primary', onClick: save, disabled: saving }, saving ? 'Saving…' : 'Store credentials'),
    ],
  },
  h('div', { className: 'sc-stack' },
    h(Banner, null, 'Create a Login with Amazon application in Amazon Ads, authorize it for your advertising profile, and paste the three values below. The refresh token is the only long-lived secret.'),
    status.data === undefined ? null : h('div', { className: 'sc-pill-row' },
      h('span', { className: 'sc-chip' }, status.data.configured ? 'credentials stored' : 'no credentials yet'),
      status.data.clientIdHint === '' ? null : h('span', { className: 'sc-chip' }, `client ${status.data.clientIdHint}`),
      ...(status.data.storedIn ?? []).map((where) => h('span', { key: where, className: 'sc-chip' }, where)),
    ),
    h(Field, { label: 'Client id' }, h(Input, { value: clientId, onChange: setClientId, placeholder: 'amzn1.application-oa2-client.…' })),
    h(Field, { label: 'Client secret' }, h(Input, { type: 'password', value: clientSecret, onChange: setClientSecret })),
    h(Field, { label: 'Refresh token' }, h(Input, { type: 'password', value: refreshToken, onChange: setRefreshToken, placeholder: 'Atzr|…' })),
    h(Field, { label: 'Advertising profile id', hint: 'Optional; the first profile the token grants is used when empty.' }, h(Input, { value: profileId, onChange: setProfileId })),
  ));
}
