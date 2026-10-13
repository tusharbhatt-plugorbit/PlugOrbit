/**
 * @format
 *
 * "Continue with Google" on the log in / sign up screen: offered only when this build
 * can start it, and a signed-in Google session is saved before the app opens.
 */

const mockConfig = {available: true};
jest.mock('../src/config/googleAuth', () => ({
  get googleSignInAvailable() {
    return mockConfig.available;
  },
  googleSignInUseBrowser: false,
  googleSignInWebClientId: 'web-client-id',
}));
jest.mock('../src/services/googleSignIn', () => ({
  signInWithGoogle: jest.fn(),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthScreen} from '../src/screens/auth/AuthScreen';
import {OtpError} from '../src/services/otpApi';
import {signInWithGoogle} from '../src/services/googleSignIn';
import {loadSession, resetSessionMemory} from '../src/services/session';
import {createMemoryStorage, setStorage} from '../src/store/storage';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const google = signInWithGoogle as jest.Mock;
const mounted: Renderer[] = [];

const SESSION = {
  uid: 'g-user',
  idToken: 'google-id-token',
  refreshToken: 'google-refresh',
  expiresAt: Date.now() + 3_600_000,
};

async function renderAuth(
  mode: 'login' | 'signup' = 'login',
  onAuthenticated = jest.fn(),
): Promise<{r: Renderer; onAuthenticated: jest.Mock}> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider>
        <AuthScreen
          mode={mode}
          onSwitchMode={() => {}}
          onBack={() => {}}
          onAuthenticated={onAuthenticated}
        />
      </SafeAreaProvider>,
    );
  });
  mounted.push(r);
  return {r, onAuthenticated};
}

const googleButton = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === 'Continue with Google',
  )[0];

const texts = (r: Renderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join(''));

const press = async (r: Renderer) => {
  await act(async () => {
    googleButton(r).props.onPress();
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {});
  }
};

beforeEach(() => {
  mockConfig.available = true;
  setStorage(createMemoryStorage());
  resetSessionMemory();
  google.mockReset();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

test('the Google button is not offered when this build cannot start Google sign-in', async () => {
  mockConfig.available = false;
  const {r} = await renderAuth();
  expect(googleButton(r)).toBeUndefined();
  expect(texts(r)).not.toContain('OR');
});

test('the Google button is offered, worded for log in and for sign up', async () => {
  const login = await renderAuth('login');
  expect(googleButton(login.r)).toBeDefined();
  expect(texts(login.r)).toContain('Log in with Google');
  const signup = await renderAuth('signup');
  expect(texts(signup.r)).toContain('Sign up with Google');
});

test('a Google session is saved, then the app opens', async () => {
  google.mockResolvedValue(SESSION);
  const {r, onAuthenticated} = await renderAuth();
  await press(r);
  expect(google).toHaveBeenCalledTimes(1);
  expect(onAuthenticated).toHaveBeenCalledTimes(1);
  expect(await loadSession()).toMatchObject({uid: 'g-user'});
});

test('cancelling the Google account picker changes nothing and shows no error', async () => {
  google.mockResolvedValue(null);
  const {r, onAuthenticated} = await renderAuth();
  await press(r);
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(await loadSession()).toBeNull();
  expect(
    r.root.findAll(n => n.props.accessibilityRole === 'alert' && typeof n.type === 'string'),
  ).toHaveLength(0);
});

test('a Google failure is explained inline and does not sign in', async () => {
  google.mockRejectedValue(
    new OtpError('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not enabled yet. Please use email sign-in.'),
  );
  const {r, onAuthenticated} = await renderAuth();
  await press(r);
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(texts(r)).toContain('Google sign-in is not enabled yet. Please use email sign-in.');
});

test('a second tap while Google sign-in is running does not start another', async () => {
  let finish!: (v: typeof SESSION) => void;
  google.mockReturnValue(new Promise(res => (finish = res)));
  const {r, onAuthenticated} = await renderAuth();
  await act(async () => {
    googleButton(r).props.onPress();
  });
  await act(async () => {
    googleButton(r).props.onPress();
  });
  expect(google).toHaveBeenCalledTimes(1);
  await act(async () => finish(SESSION));
  for (let i = 0; i < 3; i++) {
    await act(async () => {});
  }
  expect(onAuthenticated).toHaveBeenCalledTimes(1);
});
