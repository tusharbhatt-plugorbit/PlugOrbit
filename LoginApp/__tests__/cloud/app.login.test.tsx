/**
 * @format
 */

// The real <App/> against an in-memory Backend (src/dev/fakeCloud.ts): a login code that
// opens a Firebase session backs the phone up, and signing out right after an edit still
// uploads it.

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Alert, Text, TextInput} from 'react-native';
import App from '../../App';
import {createFakeCloud} from '../../src/dev/fakeCloud';
import type {FakeCloud} from '../../src/dev/fakeCloud';
import {seedSignedIn} from '../../src/dev/testHarness';
import {
  loadSession,
  peekSession,
  resetSessionMemory,
  saveSession,
} from '../../src/services/session';
import {appStore, resetAppStore} from '../../src/store/appStore';
import {resetCloudSyncForTests, stopCloudSync} from '../../src/store/cloudSync';
import {resetDemo} from '../../src/store/demoStore';
import {createMemoryStorage, setStorage} from '../../src/store/storage';

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

let cloud: FakeCloud;
let verifyBody: unknown;
const mounted: Renderer[] = [];

const settle = async (ms = 100) => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }
};

const renderApp = async (): Promise<Renderer> => {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  mounted.push(renderer);
  await settle();
  return renderer;
};

const pressText = async (r: Renderer, label: string) => {
  let node: ReactTestRenderer.ReactTestInstance | null =
    r.root.findAllByType(Text).find(n => n.props.children === label) ?? null;
  while (node && !node.props.onPress) {
    node = node.parent;
  }
  await act(async () => {
    node!.props.onPress();
  });
  await settle();
};

const pressLabel = async (
  r: Renderer,
  label: string,
  which: 'first' | 'last',
) => {
  const nodes = r.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === label,
  );
  expect(nodes.length).toBeGreaterThan(0);
  const node = which === 'first' ? nodes[0] : nodes[nodes.length - 1];
  await act(async () => {
    node.props.onPress();
  });
  await settle();
};

const type = async (r: Renderer, value: string) => {
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText(value);
  });
};

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  setStorage(createMemoryStorage());
  resetAppStore();
  resetDemo();
  resetSessionMemory();
  resetCloudSyncForTests();
  cloud = createFakeCloud();
  (globalThis as unknown as {fetch: unknown}).fetch = jest.fn(
    async (url: string, init?: never) => {
      if (url.endsWith('/auth/otp/send')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: 'sent',
            identifier_type: 'email',
            channel: 'email',
            delivered: true,
            dev_code: null,
            expires_in: 300,
            resend_in: 30,
          }),
        };
      }
      if (url.endsWith('/auth/otp/verify')) {
        return {ok: true, status: 200, json: async () => verifyBody};
      }
      return cloud.fetch(url, init);
    },
  );
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  stopCloudSync();
});

test('a login that opens a Firebase session is backed up from then on', async () => {
  const session = cloud.session('u1');
  cloud.seed('u1', 'favouriteStationIds', ['from-another-phone']);
  verifyBody = {
    verified: true,
    message: 'Verified.',
    session_status: 'ready',
    session: {
      id_token: session.idToken,
      refresh_token: session.refreshToken,
      expires_in: 3600,
      user: {uid: 'u1'},
    },
  };
  const r = await renderApp();

  await pressText(r, 'Get Started');
  await type(r, 'name@example.com');
  await pressText(r, 'Send Verification Code  →');
  await type(r, '123456');
  await pressText(r, 'Verify & Create Account  →');

  expect(appStore.get().signedIn).toBe(true);
  expect(peekSession()?.uid).toBe('u1');
  expect(appStore.get().accountUid).toBe('u1');
  // The account's data came down, and the sample content did not go up.
  expect(appStore.get().favouriteStationIds).toEqual(['from-another-phone']);
  expect(cloud.puts).toHaveLength(0);
});

test('a login without a session stays on this device and never calls the cloud', async () => {
  verifyBody = {verified: true, message: 'Verified.'};
  const r = await renderApp();

  await pressText(r, 'Get Started');
  await type(r, 'name@example.com');
  await pressText(r, 'Send Verification Code  →');
  await type(r, '123456');
  await pressText(r, 'Verify & Create Account  →');

  expect(appStore.get().signedIn).toBe(true);
  expect(await loadSession()).toBeNull();
  expect(cloud.gets).toBe(0);
  expect(cloud.puts).toHaveLength(0);
  expect(appStore.get().history.length).toBeGreaterThan(0); // sample content, as before
});

test('signing out right after an edit still uploads it, then forgets the session', async () => {
  seedSignedIn();
  appStore.set({favouriteStationIds: []});
  await saveSession(cloud.session('u1'));
  const r = await renderApp();
  expect(appStore.get().accountUid).toBe('u1'); // App started the backup

  appStore.set({favouriteStationIds: ['last-second']}); // inside the 2s pause
  await pressLabel(r, 'Profile', 'first');
  await pressLabel(r, 'Sign out', 'first'); // opens the confirmation
  await pressLabel(r, 'Sign out', 'last'); // confirms
  await settle(1_000);

  expect(appStore.get().signedIn).toBe(false);
  expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['last-second']);
  expect(await loadSession()).toBeNull();
});
