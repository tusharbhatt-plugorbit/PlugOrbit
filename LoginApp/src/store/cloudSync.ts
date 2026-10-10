import {AppState as RNAppState} from 'react-native';
import type {AppStateStatus, NativeEventSubscription} from 'react-native';
import {CloudError} from '../services/backend';
import {
  clearSession,
  loadSession,
  onSessionChange,
  peekSession,
} from '../services/session';
import {fetchRemoteState, pushState} from '../services/stateApi';
import type {RemoteSlice} from '../services/stateApi';
import {appStore, INITIAL_STATE, resetAppData, STORE_VERSION} from './appStore';
import type {AppState} from './appStore';
import {createStore} from './createStore';
import {sigOf} from './signature';
import {getStorage} from './storage';
import {SYNCED_KEYS} from './syncedKeys';
import type {SyncedKey} from './syncedKeys';

// Cloud backup of the persisted store. The device stays the source of truth: the app reads
// and writes only the local store, exactly as before, and this module mirrors the fields in
// SYNCED_KEYS to the signed-in user's account (Backend -> Firestore) in the background.
//
// Per field ("slice") the module remembers `base` (the server version it last saw) and
// `sig` (a fingerprint of the value it last synced). A slice is dirty when its fingerprint
// differs from `sig`, so restarts and crashes lose nothing. Each cycle: pull, reconcile,
// push only dirty slices.
//
//   cloud changed, nothing pending here -> take the cloud copy
//   edited here,   cloud unchanged      -> upload
//   both changed                        -> this phone wins (rare: one person, two phones)
//   first sign-in on this phone         -> merge by record id, nothing is lost either way
//   another account's data on this phone-> cleared before anything is shown or uploaded
//
// Sample (demo) content is never uploaded, and offline is normal: failed cycles retry with
// backoff and on the next app start or foreground.

const META_KEY = 'plugorbit/sync';
const META_VERSION = 1;
const PUSH_DELAY_MS = 2_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const SIGN_OUT_FLUSH_MS = 4_000;

type SliceMeta = {base: string | null; sig: string};
type Meta = {
  slices: Partial<Record<SyncedKey, SliceMeta>>;
  /** Fingerprint of a value the Backend refused, so the same payload is not retried forever. */
  blocked: Partial<Record<SyncedKey, string>>;
};

export type SyncStatus = {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
};

/** What the UI may show about backup (unused by screens so far; kept for a future indicator). */
export const cloudStatus = createStore<SyncStatus>({
  state: 'off',
  lastSyncedAt: null,
  error: null,
});

const setStatus = (patch: Partial<SyncStatus>) => cloudStatus.set(patch);

const emptyMeta = (): Meta => ({slices: {}, blocked: {}});

// --------------------------------------------------------------------- shapes --

type Kind = 'records' | 'strings' | 'object' | 'string' | 'stringOrNull';

const KIND: Record<SyncedKey, Kind> = {
  vehicles: 'records',
  activeVehicleId: 'stringOrNull',
  filters: 'object',
  tripPrefs: 'object',
  alertPrefs: 'object',
  privacy: 'object',
  language: 'string',
  plus: 'object',
  favouriteStationIds: 'strings',
  savedRoutes: 'records',
  history: 'records',
  tickets: 'records',
  notifications: 'records',
  feedbackDone: 'strings',
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is `value` something this field can safely hold? (Cloud data is never trusted blindly.) */
function fits(key: SyncedKey, value: unknown): boolean {
  if (key === 'language') {
    return value === 'en' || value === 'hi';
  }
  switch (KIND[key]) {
    case 'records':
      return Array.isArray(value) && value.every(isObject);
    case 'strings':
      return Array.isArray(value) && value.every(v => typeof v === 'string');
    case 'object':
      return isObject(value);
    case 'string':
      return typeof value === 'string';
    default:
      return value === null || typeof value === 'string';
  }
}

/** The cloud copy as the store should hold it: objects get today's defaults filled in. */
function coerce(key: SyncedKey, value: unknown): unknown {
  return KIND[key] === 'object'
    ? {...(INITIAL_STATE[key] as object), ...(value as object)}
    : value;
}

const identityOf = (item: unknown): string =>
  isObject(item) && typeof item.id === 'string'
    ? `id:${item.id}`
    : `json:${JSON.stringify(item)}`;

/** First sign-in on a phone that already has data: keep the account's copy plus anything only here. */
function mergeFirstLink(key: SyncedKey, local: unknown, remote: unknown) {
  if (sigOf(local) === sigOf(INITIAL_STATE[key])) {
    return remote;
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const known = new Set(remote.map(identityOf));
    return [...remote, ...local.filter(item => !known.has(identityOf(item)))];
  }
  if (key === 'activeVehicleId') {
    return remote ?? local;
  }
  return remote; // settings: the account's choices win
}

// ---------------------------------------------------------------------- state --

let started = false;
let epoch = 0; // bumped on stop, so a cycle in flight cannot touch a newer run's state
let meta: Meta = emptyMeta();
let applying = false; // true while remote data is written into the store (not a user edit)
let queue: Promise<void> = Promise.resolve();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;
let lastRefs: Partial<Record<SyncedKey, unknown>> = {};
// Fields the cloud holds in a newer app version's shape: never read or overwritten by this one.
let held = new Set<SyncedKey>();
let unsubscribeStore: (() => void) | null = null;
let unsubscribeSession: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;

async function loadMeta(): Promise<Meta> {
  try {
    const raw = await getStorage().getItem(META_KEY);
    const parsed = raw ? (JSON.parse(raw) as {v?: number; d?: unknown}) : null;
    const d = parsed?.v === META_VERSION ? parsed.d : null;
    if (isObject(d) && isObject(d.slices) && isObject(d.blocked)) {
      return {
        slices: d.slices as Meta['slices'],
        blocked: d.blocked as Meta['blocked'],
      };
    }
  } catch {
    // Corrupt: start over. The worst case is one extra first-link merge.
  }
  return emptyMeta();
}

async function saveMeta(): Promise<void> {
  try {
    await getStorage().setItem(
      META_KEY,
      JSON.stringify({v: META_VERSION, d: meta}),
    );
  } catch {
    // Storage full or unavailable: carry on in memory.
  }
}

const localValue = (key: SyncedKey): unknown => appStore.get()[key];
const baselineSig = (key: SyncedKey) =>
  meta.slices[key]?.sig ?? sigOf(INITIAL_STATE[key]);
const isDemo = (key: SyncedKey, sig: string) =>
  appStore.get().demoSeed[key] === sig;

/** Edited since the last sync, and worth uploading (not sample content, not already refused). */
function isDirty(key: SyncedKey): boolean {
  if (held.has(key)) {
    return false;
  }
  const sig = sigOf(localValue(key));
  return (
    sig !== baselineSig(key) && !isDemo(key, sig) && meta.blocked[key] !== sig
  );
}

const snapshotRefs = () => {
  const state = appStore.get();
  const refs: Partial<Record<SyncedKey, unknown>> = {};
  SYNCED_KEYS.forEach(key => {
    refs[key] = state[key];
  });
  return refs;
};

function writeToStore(patch: Partial<AppState>) {
  applying = true;
  try {
    appStore.set(patch);
  } finally {
    applying = false;
  }
  lastRefs = snapshotRefs();
}

// ---------------------------------------------------------------------- cycle --

/** Make sure the data on this phone belongs to the account that is signed in. */
async function adoptIdentity(uid: string): Promise<void> {
  const owner = appStore.get().accountUid;
  if (owner === uid) {
    return;
  }
  if (owner !== null) {
    // Another account used this phone: its data must not be shown to, merged into or
    // uploaded for this one.
    applying = true;
    try {
      await resetAppData({
        signedIn: appStore.get().signedIn,
        hydrated: true,
        accountUid: uid,
      });
    } finally {
      applying = false;
    }
    meta = emptyMeta();
  } else {
    // First link of this phone: sample content is not this user's data. Drop it; the
    // account's own data (if any) arrives next.
    const state = appStore.get();
    const patch: Record<string, unknown> = {accountUid: uid};
    SYNCED_KEYS.forEach(key => {
      if (isDemo(key, sigOf(state[key]))) {
        patch[key] = INITIAL_STATE[key];
      }
    });
    writeToStore({...patch, demoSeed: {}} as Partial<AppState>);
  }
  lastRefs = snapshotRefs();
  await saveMeta();
}

/** Usable cloud copy of a field, or undefined (missing, other app version, or malformed). */
function usable(key: SyncedKey, slice: RemoteSlice | undefined) {
  if (!slice || (slice.schemaVersion ?? 1) !== STORE_VERSION) {
    return undefined;
  }
  return fits(key, slice.value) ? slice : undefined;
}

/** Apply the cloud's changes to the store. */
function reconcile(remote: Record<string, RemoteSlice>): void {
  const patch: Record<string, unknown> = {};
  held = new Set();
  SYNCED_KEYS.forEach(key => {
    const raw = remote[key];
    if (raw && (raw.schemaVersion ?? 1) > STORE_VERSION) {
      held.add(key);
    }
    const slice = usable(key, raw);
    const known = meta.slices[key];
    if (!slice) {
      if (known && raw === undefined) {
        delete meta.slices[key]; // the cloud copy is gone: upload ours again
      }
      if (!meta.slices[key]) {
        // Nothing usable in the cloud yet. Remember that this field has been reconciled, so
        // a cloud copy that appears later is treated as a change to merge or win against,
        // not as a first link.
        meta.slices[key] = {base: null, sig: sigOf(INITIAL_STATE[key])};
      }
      return;
    }
    if (known && known.base === slice.rev) {
      return; // cloud unchanged since the last sync
    }
    const local = localValue(key);
    if (!known) {
      const merged = coerce(key, mergeFirstLink(key, local, slice.value));
      patch[key] = merged;
      // Baseline = the cloud copy; if the merge added records only found here, they upload next.
      meta.slices[key] = {
        base: slice.rev,
        sig: sigOf(coerce(key, slice.value)),
      };
    } else if (sigOf(local) === known.sig) {
      const next = coerce(key, slice.value);
      patch[key] = next;
      meta.slices[key] = {base: slice.rev, sig: sigOf(next)};
    } else {
      // Edited here and in the cloud: this phone wins; the upload replaces the cloud copy.
      meta.slices[key] = {base: slice.rev, sig: known.sig};
    }
  });
  if (Object.keys(patch).length > 0) {
    writeToStore(patch as Partial<AppState>);
  }
}

/** Upload the dirty fields. Returns true when the Backend refused some data for good. */
async function pushDirty(alive: () => boolean): Promise<boolean> {
  const state = appStore.get();
  const keys = SYNCED_KEYS.filter(isDirty);
  if (keys.length === 0) {
    return false;
  }
  const sent = new Map(keys.map(k => [k, sigOf(state[k])] as const));

  const upload = async (batch: SyncedKey[]) => {
    const payload: Record<string, unknown> = {};
    batch.forEach(k => {
      payload[k] = state[k];
    });
    const at = await pushState(payload, STORE_VERSION);
    if (!alive()) {
      return;
    }
    batch.forEach(k => {
      meta.slices[k] = {base: at[k], sig: sent.get(k) as string};
      delete meta.blocked[k];
    });
  };

  try {
    await upload(keys);
    return false;
  } catch (e) {
    if (!(e instanceof CloudError) || e.code !== 'REJECTED') {
      throw e;
    }
  }
  // One field made the Backend refuse the whole request: find which, upload the rest.
  let refused = false;
  for (const key of keys) {
    try {
      await upload([key]);
    } catch (e) {
      if (e instanceof CloudError && e.code === 'REJECTED') {
        if (alive()) {
          meta.blocked[key] = sent.get(key) as string;
        }
        refused = true;
      } else {
        throw e;
      }
    }
  }
  return refused;
}

const hasPending = () => SYNCED_KEYS.some(isDirty);

async function cycle(): Promise<void> {
  const mine = epoch;
  const alive = () => started && mine === epoch;
  if (!alive()) {
    return;
  }
  try {
    const session = await loadSession();
    if (!alive()) {
      return;
    }
    if (!session) {
      setStatus({state: 'off', error: null});
      return;
    }
    setStatus({state: 'syncing'});
    await adoptIdentity(session.uid);
    const remote = await fetchRemoteState();
    if (!alive()) {
      return;
    }
    reconcile(remote);
    const refused = await pushDirty(alive);
    if (!alive()) {
      return;
    }
    retryStep = 0;
    setStatus({
      state: refused ? 'error' : 'idle',
      lastSyncedAt: Date.now(),
      error: refused ? 'Some data could not be backed up.' : null,
    });
    if (hasPending()) {
      schedulePush(PUSH_DELAY_MS); // edited while this cycle was talking to the server
    }
  } catch (e) {
    if (!alive()) {
      return;
    }
    if (e instanceof CloudError && e.code === 'NETWORK') {
      setStatus({state: 'offline', error: null});
      scheduleRetry();
    } else if (
      e instanceof CloudError &&
      (e.code === 'AUTH_LOST' || e.code === 'NO_SESSION')
    ) {
      setStatus({state: 'off', error: null}); // the session is gone; sign in again to resume
    } else {
      setStatus({state: 'error', error: 'Backup is not working right now.'});
      scheduleRetry();
    }
  } finally {
    if (alive()) {
      await saveMeta();
    }
  }
}

function clearTimers() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function schedulePush(delay: number) {
  if (!started) {
    return;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow();
  }, delay);
}

function scheduleRetry() {
  if (!started || retryTimer) {
    return;
  }
  const delay = Math.min(RETRY_BASE_MS * 2 ** retryStep, RETRY_MAX_MS);
  retryStep += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    syncNow();
  }, delay);
}

function onStoreChange() {
  if (applying || !started) {
    return;
  }
  const state = appStore.get();
  const changed = SYNCED_KEYS.filter(key => state[key] !== lastRefs[key]);
  if (changed.length === 0) {
    return;
  }
  changed.forEach(key => {
    lastRefs[key] = state[key];
  });
  if (changed.some(isDirty)) {
    schedulePush(PUSH_DELAY_MS);
  }
}

function onAppState(next: AppStateStatus) {
  // Coming back: pick up changes made on another phone. Leaving: upload what is pending.
  if (next === 'active' || hasPending()) {
    syncNow();
  }
}

// ------------------------------------------------------------------------ API --

/** Pull, reconcile and push now. Never rejects; progress is in `cloudStatus`. */
export function syncNow(): Promise<void> {
  if (!started) {
    return Promise.resolve();
  }
  clearTimers();
  queue = queue.then(cycle, cycle);
  return queue;
}

/**
 * Begin backing up (idempotent). Call once the store is hydrated and the user is signed in.
 * Does nothing visible when there is no cloud session (Backend without Firebase, or a
 * sign-in that could not open one): the app then simply stays on-device, as before.
 */
export async function startCloudSync(): Promise<void> {
  if (started) {
    return;
  }
  started = true;
  const mine = epoch;
  meta = await loadMeta();
  if (!started || mine !== epoch) {
    return;
  }
  lastRefs = snapshotRefs();
  unsubscribeStore = appStore.subscribe(onStoreChange);
  unsubscribeSession = onSessionChange(() => {
    if (!peekSession()) {
      stopCloudSync();
    }
  });
  appStateSub = RNAppState.addEventListener('change', onAppState);
  await syncNow();
}

/** Stop watching and syncing. Keeps the session and the sync bookkeeping. */
export function stopCloudSync(): void {
  started = false;
  epoch += 1;
  clearTimers();
  retryStep = 0;
  unsubscribeStore?.();
  unsubscribeSession?.();
  appStateSub?.remove();
  unsubscribeStore = unsubscribeSession = null;
  appStateSub = null;
  setStatus({state: 'off', error: null});
}

/**
 * Sign out: give pending edits one short chance to upload, then forget the session. The
 * data stays on the phone; signing back in as the same user resumes where this left off,
 * and signing in as someone else clears it first.
 */
export async function endCloudSession(): Promise<void> {
  if (started) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      syncNow(),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, SIGN_OUT_FLUSH_MS);
      }),
    ]);
    clearTimeout(timer);
  }
  stopCloudSync();
  await clearSession();
}

/** Forget the account link on this phone without touching the cloud copy (Presenter tools reset). */
export async function detachCloudSync(): Promise<void> {
  stopCloudSync();
  await clearSession();
  meta = emptyMeta();
  await saveMeta();
}

/** Test helper: back to a clean module state. */
export function resetCloudSyncForTests(): void {
  stopCloudSync();
  meta = emptyMeta();
  held = new Set();
  queue = Promise.resolve();
  lastRefs = {};
  cloudStatus.replace({state: 'off', lastSyncedAt: null, error: null});
}
