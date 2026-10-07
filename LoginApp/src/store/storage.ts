export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function createMemoryStorage(
  seed: Record<string, string> = {},
): KeyValueStorage {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async key => {
      data.delete(key);
    },
  };
}

let active: KeyValueStorage | null = null;

/** Override the storage (tests, or a different backend later). */
export function setStorage(storage: KeyValueStorage | null) {
  active = storage;
}

/**
 * AsyncStorage on device; in-memory when the native module isn't available
 * (Jest, web preview), so the app never fails to start because of storage.
 */
export function getStorage(): KeyValueStorage {
  if (active) {
    return active;
  }
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const as = mod.default ?? mod;
    if (as && typeof as.getItem === 'function') {
      active = {
        getItem: k => as.getItem(k),
        setItem: (k, v) => as.setItem(k, v),
        removeItem: k => as.removeItem(k),
      };
      return active;
    }
  } catch {
    // fall through to memory
  }
  active = createMemoryStorage();
  return active;
}
