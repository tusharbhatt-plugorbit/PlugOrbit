/**
 * @format
 */

import {createFakeCloud} from '../../src/dev/fakeCloud';
import type {FakeCloud} from '../../src/dev/fakeCloud';
import {CloudError} from '../../src/services/backend';
import {
  clearSession,
  getIdToken,
  loadSession,
  onSessionChange,
  resetSessionMemory,
  saveSession,
  sessionFromVerify,
} from '../../src/services/session';
import {createMemoryStorage, setStorage} from '../../src/store/storage';
import type {KeyValueStorage} from '../../src/store/storage';

let cloud: FakeCloud;
let storage: KeyValueStorage;

beforeEach(() => {
  storage = createMemoryStorage();
  setStorage(storage);
  resetSessionMemory();
  cloud = createFakeCloud();
  (globalThis as unknown as {fetch: unknown}).fetch = cloud.fetch;
});

const failureOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (e) {
    return e as CloudError;
  }
  throw new Error('Expected the call to reject.');
};

describe('sessionFromVerify', () => {
  const body = {
    id_token: 'ID',
    refresh_token: 'RT',
    expires_in: 3600,
    user: {uid: 'u1', email: 'a@b.co'},
  };

  test('reads what /auth/otp/verify returns', () => {
    expect(sessionFromVerify(body, 1_000)).toEqual({
      uid: 'u1',
      idToken: 'ID',
      refreshToken: 'RT',
      expiresAt: 1_000 + 3_600_000,
    });
  });

  test.each([
    ['nothing', undefined],
    ['a string', 'x'],
    ['no user', {...body, user: undefined}],
    ['no uid', {...body, user: {}}],
    ['empty id token', {...body, id_token: ''}],
    ['no refresh token', {...body, refresh_token: undefined}],
    ['string expiry', {...body, expires_in: '3600'}],
  ])('%s is not a session', (_name, raw) => {
    expect(sessionFromVerify(raw)).toBeNull();
  });
});

describe('storage', () => {
  test('a saved session is still there after a restart', async () => {
    await saveSession(cloud.session('u1'));
    resetSessionMemory();
    expect((await loadSession())?.uid).toBe('u1');
  });

  test('a corrupt blob means signed out, not a crash', async () => {
    await storage.setItem('plugorbit/session', '{not json');
    expect(await loadSession()).toBeNull();
  });

  test('a blob from another version is ignored', async () => {
    await storage.setItem(
      'plugorbit/session',
      JSON.stringify({v: 99, d: cloud.session('u1')}),
    );
    expect(await loadSession()).toBeNull();
  });

  test('clearing removes it for good and tells listeners', async () => {
    const changes = jest.fn();
    onSessionChange(changes);
    await saveSession(cloud.session('u1'));
    await clearSession();
    expect(changes).toHaveBeenCalledTimes(2);
    resetSessionMemory();
    expect(await loadSession()).toBeNull();
  });
});

describe('getIdToken', () => {
  test('is null when nobody is signed in', async () => {
    expect(await getIdToken()).toBeNull();
  });

  test('a fresh token is used as it is', async () => {
    const session = cloud.session('u1');
    await saveSession(session);
    expect(await getIdToken()).toBe(session.idToken);
    expect(cloud.refreshes).toBe(0);
  });

  test('concurrent callers share a single refresh, and the new tokens are saved', async () => {
    await saveSession(cloud.session('u1', {expiresInMs: 10_000}));
    const [a, b, c] = await Promise.all([
      getIdToken(),
      getIdToken(),
      getIdToken(),
    ]);
    expect(cloud.refreshes).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    resetSessionMemory();
    expect((await loadSession())?.idToken).toBe(a);
  });

  test('offline, a token that is only close to expiry is still used', async () => {
    const session = cloud.session('u1', {expiresInMs: 10_000});
    await saveSession(session);
    cloud.online = false;
    expect(await getIdToken()).toBe(session.idToken);
  });

  test('offline with an expired token, the caller is told it is a network problem', async () => {
    await saveSession(cloud.session('u1', {expiresInMs: -1_000}));
    cloud.online = false;
    const error = await failureOf(getIdToken());
    expect(error.code).toBe('NETWORK');
    expect(await loadSession()).not.toBeNull(); // kept: it may work once back online
  });

  test.each(['INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND'])(
    'a refresh refused with %s ends the sign-in',
    async code => {
      await saveSession(cloud.session('u1', {expiresInMs: -1}));
      cloud.refreshError = {status: 401, code};
      const error = await failureOf(getIdToken());
      expect(error.code).toBe('AUTH_LOST');
      expect(await loadSession()).toBeNull();
    },
  );

  test('a Backend that is down or misconfigured does not end the sign-in', async () => {
    await saveSession(cloud.session('u1', {expiresInMs: -1}));
    cloud.refreshError = {status: 503, code: 'FIREBASE_NOT_CONFIGURED'};
    const error = await failureOf(getIdToken());
    expect(error.code).toBe('SERVER');
    expect(await loadSession()).not.toBeNull();
  });
});
