/**
 * Verifies the browser bundle against the Harness module-loader contract
 * without a browser: the factory registers, the plugin exposes `apply`, and
 * `apply` registers the panel, the icon, the locale and the stylesheet as
 * effects that clean up.
 */
import { test, assert, equal, summarize } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = readFileSync(join(root, 'package', 'lib', 'client.js'), 'utf8');

process.stdout.write('\nclient\n');

/** A React stand-in: hooks are stateful enough to render one tree. */
function fakeReact() {
  const createElement = (type, props, ...children) => ({
    $$typeof: 'element',
    type,
    props: { ...(props ?? {}), children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children) },
  });
  const hookState = [];
  let cursor = 0;
  const React = {
    createElement,
    Fragment: 'fragment',
    useState(initial) {
      const index = cursor++;
      if (hookState[index] === undefined) hookState[index] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = hookState[index];
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useReducer(reducer, initial) {
      const index = cursor++;
      if (hookState[index] === undefined) hookState[index] = { value: initial };
      const cell = hookState[index];
      return [cell.value, (action) => { cell.value = reducer(cell.value, action); }];
    },
    useEffect(fn) {
      const index = cursor++;
      if (hookState[index] === undefined) {
        hookState[index] = { cleanup: undefined };
        const cleanup = fn();
        if (typeof cleanup === 'function') hookState[index].cleanup = cleanup;
      }
    },
    useLayoutEffect() {},
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useRef(initial) {
      const index = cursor++;
      if (hookState[index] === undefined) hookState[index] = { current: initial };
      return hookState[index];
    },
    useContext() { return {}; },
    memo: (component) => component,
    forwardRef: (component) => component,
    createContext: (value) => ({ Provider: 'provider', Consumer: 'consumer', value }),
    __reset() { hookState.length = 0; cursor = 0; },
  };
  return React;
}

/** A document good enough for the stylesheet effect. */
function fakeDocument() {
  const head = [];
  return {
    head: {
      append(node) { head.push(node); },
    },
    createElement(tag) {
      return { tagName: tag, dataset: {}, textContent: '', remove() { const index = head.indexOf(this); if (index >= 0) head.splice(index, 1); } };
    },
    addEventListener() {},
    removeEventListener() {},
    __head: head,
  };
}

const React = fakeReact();
const document = fakeDocument();
const registrations = [];
let loaderFactory;

const sandbox = {
  window: {},
  document,
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => { throw new Error('no network in the bundle test'); },
  AbortController,
  AbortSignal,
  URL,
  URLSearchParams,
  Response,
  Request,
  Headers,
  TextDecoder,
  TextEncoder,
  Blob,
  FormData,
  performance,
  queueMicrotask,
  structuredClone,
};
sandbox.window.__ModuleLoader__ = { load(registration) { registrations.push(registration); loaderFactory = registration.factory; } };
sandbox.globalThis = sandbox;
sandbox.window.document = document;
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox, { filename: 'client.js' });

test('the bundle registers exactly one factory under the package name', () => {
  equal(registrations.length, 1);
  equal(registrations[0].id, '@local/dsh-scale-commander');
  assert(typeof loaderFactory === 'function', 'factory is callable');
});

const plugin = loaderFactory((name) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: 'fragment' };
  throw new Error(`unexpected module: ${name}`);
});

test('the plugin exposes apply and no other lifecycle verb', () => {
  assert(plugin !== undefined && typeof plugin.apply === 'function', 'apply is a function');
});

const effects = [];
const slots = [];
const locales = [];
const ctx = {
  effect(fn, label) {
    const cleanup = fn();
    effects.push({ label, cleanup });
    return cleanup;
  },
  slots: {
    // The real service calls the injection callback immediately and disposes
    // its registrations when the owning declaration collapses.
    inject(name, callback) {
      slots.push({ name });
      const dispose = callback();
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
    register(options, component) {
      slots.push({ registered: options.name, options, component });
      return () => {};
    },
  },
  locale: {
    register(ns, dicts) { locales.push({ ns, dicts }); return () => {}; },
    bind() { return (key) => key; },
  },
};

test('apply registers the page, the sidebar icon, the locale and the stylesheet', () => {
  plugin.apply(ctx);
  const injected = slots.filter((entry) => entry.name !== undefined).map((entry) => entry.name);
  assert(injected.includes('main'), 'registers into main');
  assert(injected.includes('sidebar.panellist'), 'registers into the sidebar panel list');
  equal(locales.length, 1);
  equal(locales[0].ns, 'scale-commander');
  assert(document.__head.length === 1, 'injects exactly one style tag');
  assert(document.__head[0].textContent.includes('--dsw-alias-bg-base'), 'the stylesheet uses theme tokens');
});

test('the registered page and icon are React components', () => {
  const page = slots.find((entry) => entry.registered === 'main');
  const icon = slots.find((entry) => entry.registered === 'sidebar.panellist');
  assert(typeof page.component === 'function', 'page component is a function');
  assert(typeof icon.component === 'function', 'icon component is a function');
  const tree = icon.component({ size: 18, active: false });
  equal(tree.type, 'svg');
  equal(tree.props.width, 18);
});

test('every effect returns a disposer so the plugin unloads cleanly', () => {
  for (const effect of effects) {
    assert(typeof effect.cleanup === 'function', `effect ${effect.label} has a disposer`);
  }
  for (const effect of effects) effect.cleanup();
  equal(document.__head.length, 0);
});

test('the page renders its empty state when the Host has no accounts', () => {
  const page = slots.find((entry) => entry.registered === 'main');
  React.__reset();
  const tree = page.component({ toasts: { push() {}, subscribe() { return () => {}; }, items: [] } });
  assert(tree !== undefined && tree.type !== undefined, 'renders a tree');
  const text = JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value));
  assert(text.length > 0, 'tree serialises');
});

summarize('client');
