/**
 * Client state: one small store, explicit loading and error states.
 *
 * The store is a plain observable object — no external dependency — so the
 * plugin keeps its bundle self-contained. Every read goes through `useResource`,
 * which tracks a request generation so a late answer cannot overwrite a newer
 * one.
 * @module client/lib/state
 */

import React from 'react';

/**
 * A minimal observable value.
 * @template T
 */
export class Store {
  /**
   * @param {T} initial
   */
  constructor(initial) {
    this.value = initial;
    this.listeners = new Set();
  }

  /** @returns {T} */
  get() {
    return this.value;
  }

  /** @param {T|((current: T) => T)} next */
  set(next) {
    const value = typeof next === 'function' ? next(this.value) : next;
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  /** @param {() => void} listener @returns {() => void} */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Subscribe a component to a store.
 * @template T
 * @param {Store<T>} store
 * @returns {T}
 */
export function useStore(store) {
  const [, force] = React.useReducer((count) => count + 1, 0);
  React.useEffect(() => store.subscribe(force), [store]);
  return store.get();
}

/**
 * A resource hook: runs `load` when its dependencies change, exposes
 * `{data, error, loading, reload}` and drops answers from superseded requests.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} load
 * @param {Array<unknown>} deps
 * @param {{enabled?: boolean, initial?: T}} [options]
 * @returns {{data: T|undefined, error: Error|null, loading: boolean, reload: () => void, setData: (next: T) => void}}
 */
export function useResource(load, deps, options = {}) {
  const enabled = options.enabled !== false;
  const [state, setState] = React.useState({ data: options.initial, error: null, loading: enabled });
  const [nonce, setNonce] = React.useState(0);
  const generation = React.useRef(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  React.useEffect(() => {
    if (!enabled) {
      setState((current) => ({ ...current, loading: false }));
      return undefined;
    }
    const current = generation.current + 1;
    generation.current = current;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    loadRef.current(controller.signal).then((data) => {
      if (generation.current !== current) return;
      setState({ data, error: null, loading: false });
    }, (error) => {
      if (generation.current !== current || controller.signal.aborted) return;
      setState((previous) => ({ ...previous, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = React.useCallback(() => setNonce((value) => value + 1), []);
  const setData = React.useCallback((next) => setState((previous) => ({ ...previous, data: next })), []);
  return { ...state, reload, setData };
}

/**
 * Toasts with automatic dismissal.
 */
export class ToastStore {
  constructor() {
    this.items = [];
    this.listeners = new Set();
    this.next = 1;
  }

  /**
   * @param {string} message
   * @param {'ok'|'err'} [tone]
   */
  push(message, tone = 'ok') {
    const id = this.next++;
    this.items = [...this.items, { id, message, tone }];
    this.#emit();
    setTimeout(() => this.dismiss(id), tone === 'err' ? 8000 : 4000);
  }

  /** @param {number} id */
  dismiss(id) {
    this.items = this.items.filter((item) => item.id !== id);
    this.#emit();
  }

  #emit() {
    for (const listener of this.listeners) listener();
  }

  /** @param {() => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * @param {ToastStore} store
 * @returns {Array<{id: number, message: string, tone: string}>}
 */
export function useToasts(store) {
  const [, force] = React.useReducer((count) => count + 1, 0);
  React.useEffect(() => store.subscribe(force), [store]);
  return store.items;
}

/**
 * Persist one small value in localStorage without throwing in a sandboxed frame.
 * @param {string} key
 * @param {unknown} fallback
 * @returns {[unknown, (next: unknown) => void]}
 */
export function usePersistent(key, fallback) {
  const storageKey = `scale-commander.${key}`;
  const [value, setValue] = React.useState(() => {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  const update = React.useCallback((next) => {
    setValue(next);
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage may be unavailable; the in-memory value still works */
    }
  }, [storageKey]);
  return [value, update];
}

/**
 * Debounce a value so typing does not fire a request per keystroke.
 * @param {string} value
 * @param {number} [delay]
 * @returns {string}
 */
export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
