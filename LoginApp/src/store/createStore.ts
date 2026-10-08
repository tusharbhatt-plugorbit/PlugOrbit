import {useCallback, useRef, useSyncExternalStore} from 'react';
import type {KeyValueStorage} from './storage';

type Listener = () => void;
type Updater<T> = Partial<T> | ((state: T) => Partial<T>);

export type Store<T> = {
  get: () => T;
  set: (update: Updater<T>) => void;
  /** Replace the whole state (used by hydration and tests). */
  replace: (next: T) => void;
  subscribe: (listener: Listener) => () => void;
};

/** A tiny external store: no provider, selector subscriptions, easy to test. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach(l => l());
  return {
    get: () => state,
    set: update => {
      const patch = typeof update === 'function' ? update(state) : update;
      state = {...state, ...patch};
      emit();
    },
    replace: next => {
      state = next;
      emit();
    },
    subscribe: l => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

/** Subscribe to a slice; re-renders only when the selected value changes. */
export function useStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
): S {
  const last = useRef<{state: T; value: S} | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.get();
    if (last.current && last.current.state === state) {
      return last.current.value;
    }
    const value = selector(state);
    if (last.current && Object.is(last.current.value, value)) {
      last.current = {state, value: last.current.value};
      return last.current.value;
    }
    last.current = {state, value};
    return value;
  }, [store, selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export type PersistOptions<T> = {
  key: string;
  version: number;
  storage: KeyValueStorage;
  /** Which fields to keep. Anything else resets to the initial value. */
  pick: ReadonlyArray<keyof T>;
  debounceMs?: number;
};

export type Persisted = {
  /** Resolves once saved state (if any) has been merged in. */
  hydrated: Promise<void>;
  /** Write pending changes now (e.g. before the app backgrounds). */
  flush: () => Promise<void>;
  stop: () => void;
};

/**
 * Persist selected fields. Reads are version-checked and failure-tolerant: a
 * corrupt or old blob is ignored rather than crashing the app on launch.
 */
export function persist<T extends object>(
  store: Store<T>,
  options: PersistOptions<T>,
): Persisted {
  const {key, version, storage, pick, debounceMs = 250} = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;

  const snapshot = () => {
    const s = store.get();
    const out: Partial<T> = {};
    pick.forEach(k => {
      out[k] = s[k];
    });
    return JSON.stringify({v: version, d: out});
  };

  const write = async () => {
    timer = null;
    try {
      await storage.setItem(key, snapshot());
    } catch {
      // Storage full/unavailable: keep running in memory.
    }
  };

  const hydrated = (async () => {
    try {
      const raw = await storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as {v?: number; d?: Partial<T>};
        if (parsed && parsed.v === version && parsed.d) {
          store.set(parsed.d as Partial<T>);
        }
      }
    } catch {
      // Corrupt blob: start fresh.
    } finally {
      ready = true;
    }
  })();

  const unsubscribe = store.subscribe(() => {
    if (!ready) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(write, debounceMs);
  });

  return {
    hydrated,
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
      }
      await write();
    },
    stop: () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}
