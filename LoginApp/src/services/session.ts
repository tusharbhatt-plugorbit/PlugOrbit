import {getStorage} from '../store/storage';
import {CloudError, errorCode, isRecord, request} from './backend';

// The Firebase sign-in the Backend hands out after a login code is verified: a short-lived
// ID token (about an hour) plus a refresh token. Only the Backend talks to Firebase; the app
// just carries these tokens as a Bearer header.
//
// TODO(security): tokens are kept with the rest of the app data in AsyncStorage (app-private
// on a non-rooted device, not encrypted). Before a public release move SESSION_KEY into the
// iOS Keychain / Android Keystore (e.g. react-native-keychain) behind setStorage().

export type CloudSession = {
  uid: string;
  idToken: string;
  refreshToken: string;
  /** Epoch ms when the ID token stops being accepted. */
  expiresAt: number;
};

const SESSION_KEY = 'plugorbit/session';
const VERSION = 1;
// Refresh a little early so a request never leaves with a token about to expire.
const REFRESH_MARGIN_MS = 60_000;
// Refresh failures that mean "this sign-in is over". Anything else (outage, rate limit, a
// Backend that is down or misconfigured) keeps the session and is retried later.
const SESSION_OVER = new Set([
  'INVALID_REFRESH_TOKEN',
  'TOKEN_EXPIRED',
  'USER_NOT_FOUND',
  'USER_DISABLED',
]);

let current: CloudSession | null | undefined; // undefined = not read from storage yet
let loading: Promise<CloudSession | null> | null = null;
let refreshing: Promise<CloudSession> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

/** Called whenever the session is saved or cleared. */
export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session as last loaded, without touching storage (null before the first load). */
export function peekSession(): CloudSession | null {
  return current ?? null;
}

/** Reads the session the Backend returned from /auth/otp/verify. Null when absent or malformed. */
export function sessionFromVerify(
  raw: unknown,
  now: number = Date.now(),
): CloudSession | null {
  if (!isRecord(raw) || !isRecord(raw.user)) {
    return null;
  }
  const {id_token: idToken, refresh_token: refreshToken, expires_in} = raw;
  const uid = raw.user.uid;
  if (
    typeof idToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expires_in !== 'number' ||
    typeof uid !== 'string' ||
    !idToken ||
    !refreshToken ||
    !uid
  ) {
    return null;
  }
  return {uid, idToken, refreshToken, expiresAt: now + expires_in * 1000};
}

async function persist(session: CloudSession | null): Promise<void> {
  const storage = getStorage();
  try {
    if (session) {
      await storage.setItem(
        SESSION_KEY,
        JSON.stringify({v: VERSION, d: session}),
      );
    } else {
      await storage.removeItem(SESSION_KEY);
    }
  } catch {
    // Storage unavailable: the session still works in memory for this run.
  }
}

export function loadSession(): Promise<CloudSession | null> {
  if (current !== undefined) {
    return Promise.resolve(current);
  }
  if (!loading) {
    loading = (async () => {
      let loaded: CloudSession | null = null;
      try {
        const raw = await getStorage().getItem(SESSION_KEY);
        const parsed = raw
          ? (JSON.parse(raw) as {v?: number; d?: unknown})
          : null;
        const d = parsed?.v === VERSION ? parsed.d : null;
        if (
          isRecord(d) &&
          typeof d.uid === 'string' &&
          typeof d.idToken === 'string' &&
          typeof d.refreshToken === 'string' &&
          typeof d.expiresAt === 'number'
        ) {
          loaded = {
            uid: d.uid,
            idToken: d.idToken,
            refreshToken: d.refreshToken,
            expiresAt: d.expiresAt,
          };
        }
      } catch {
        // Corrupt blob: treated as signed out of the cloud.
      }
      // A save or clear while we were reading wins over what was on disk.
      if (current === undefined) {
        current = loaded;
      }
      loading = null;
      return current;
    })();
  }
  return loading;
}

export async function saveSession(session: CloudSession): Promise<void> {
  current = session;
  await persist(session);
  emit();
}

export async function clearSession(): Promise<void> {
  const had = current !== null;
  current = null;
  await persist(null);
  if (had) {
    emit();
  }
}

async function refresh(session: CloudSession): Promise<CloudSession> {
  const res = await request('POST', '/auth/refresh', {
    body: {refresh_token: session.refreshToken},
  });
  if (!res) {
    throw new CloudError('NETWORK', 'Could not reach the server.');
  }
  const b = res.body;
  if (
    res.ok &&
    isRecord(b) &&
    typeof b.id_token === 'string' &&
    typeof b.refresh_token === 'string' &&
    typeof b.expires_in === 'number'
  ) {
    const next: CloudSession = {
      uid: session.uid,
      idToken: b.id_token,
      refreshToken: b.refresh_token,
      expiresAt: Date.now() + b.expires_in * 1000,
    };
    // Someone may have signed out (or in as another user) while this was in flight.
    if (current?.uid === session.uid) {
      await saveSession(next);
    }
    return next;
  }
  const code = errorCode(res);
  if (code && SESSION_OVER.has(code)) {
    await clearSession();
    throw new CloudError('AUTH_LOST', 'Your session ended.', res.status);
  }
  throw new CloudError('SERVER', 'Could not refresh the session.', res.status);
}

/**
 * A valid ID token for the Backend, refreshed first when it is about to expire (concurrent
 * callers share one refresh). Null when nobody is signed in to the cloud. Throws CloudError:
 * NETWORK / SERVER when a needed refresh could not happen (the session is kept), AUTH_LOST
 * when the sign-in is over (the session was cleared).
 */
export async function getIdToken(
  options: {forceRefresh?: boolean} = {},
): Promise<string | null> {
  const session = await loadSession();
  if (!session) {
    return null;
  }
  const fresh = session.expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (fresh && !options.forceRefresh) {
    return session.idToken;
  }
  try {
    if (!refreshing) {
      refreshing = refresh(session).finally(() => {
        refreshing = null;
      });
    }
    return (await refreshing).idToken;
  } catch (e) {
    // Offline or Backend trouble, and the old token still has time left: use it.
    if (
      e instanceof CloudError &&
      e.code !== 'AUTH_LOST' &&
      !options.forceRefresh &&
      session.expiresAt > Date.now()
    ) {
      return session.idToken;
    }
    throw e;
  }
}

/** Test helper: forget the in-memory session without touching storage. */
export function resetSessionMemory(): void {
  current = undefined;
  loading = null;
  refreshing = null;
  listeners.clear();
}
