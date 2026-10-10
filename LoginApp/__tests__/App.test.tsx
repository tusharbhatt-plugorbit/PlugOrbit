/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, BackHandler, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import App from '../App';
import { seedSignedIn } from '../src/dev/testHarness';
import { STORE_VERSION, appStore, resetAppStore } from '../src/store/appStore';
import { resetDemo } from '../src/store/demoStore';
import { createMemoryStorage, setStorage } from '../src/store/storage';
import { resetLocalOtp } from '../src/services/otpApi';
import { hasSeenOnboarding, markOnboardingSeen } from '../src/store/onboarding';

const WELCOME_HEADLINE = 'Tell us where\nyou’re going.';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];

const renderApp = async (): Promise<Renderer> => {
  if (seenIntro) {
    await markOnboardingSeen();
  }
  let renderer!: Renderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  // Saved state loads asynchronously before the first screen shows.
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => {});
  }
  mounted.push(renderer);
  return renderer;
};

const textsOf = (renderer: Renderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

const findPressable = (renderer: Renderer, label: string) => {
  const node = renderer.root
    .findAllByType(Text)
    .find(n => n.props.children === label);
  let target: ReactTestRenderer.ReactTestInstance | null = node ?? null;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  return target!;
};

// Presses and waits for the handler (and so the whole OTP request) to finish.
const pressByText = async (renderer: Renderer, label: string) => {
  const target = findPressable(renderer, label);
  await ReactTestRenderer.act(() => target.props.onPress());
};

// The one back control on the auth screens is an icon arrow with a label.
const pressBack = async (renderer: Renderer) => {
  const target = renderer.root.findByProps({accessibilityLabel: 'Back'});
  await ReactTestRenderer.act(() => target.props.onPress());
};

// Presses without waiting for the handler, for requests left pending on purpose.
const pressWithoutWaiting = async (renderer: Renderer, label: string) => {
  const target = findPressable(renderer, label);
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
  });
};

// Lets promise chains (fetch -> json -> state) and queued renders settle.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await ReactTestRenderer.act(async () => {});
  }
};

const typeIdentifier = async (renderer: Renderer, value: string) => {
  const input = renderer.root.findByType(TextInput);
  await ReactTestRenderer.act(() => input.props.onChangeText(value));
};

const typeOtp = async (renderer: Renderer, value: string) => {
  const input = renderer.root.findByType(TextInput);
  await ReactTestRenderer.act(() => input.props.onChangeText(value));
};

const otpValueOf = (renderer: Renderer) =>
  renderer.root.findByType(TextInput).props.value;

// The code shown in the DEV banner, if there is one.
const devCodeOf = (renderer: Renderer) => {
  const line = textsOf(renderer).find(
    text => typeof text === 'string' && /^Your code is \d{6}$/.test(text),
  ) as string | undefined;
  return line?.slice('Your code is '.length);
};

// The inline message under the field (accessibilityRole="alert"), or null. The
// auth screens no longer use Alert popups: a popup steals focus from the keyboard.
const messageOf = (renderer: Renderer): string | null => {
  const node = renderer.root.findAll(n => n.props.accessibilityRole === 'alert' && typeof n.type === 'string')[0];
  if (!node) {
    return null;
  }
  const texts = node.findAllByType(Text).map(t => t.props.children);
  return texts.join('');
};

const findText = (renderer: Renderer, label: string) =>
  renderer.root.findAllByType(Text).find(n => n.props.children === label)!;

// WCAG contrast ratio of two #RRGGBB colours.
const contrastRatio = (a: string, b: string) => {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const fetchMock = jest.fn();

// Most tests are a returning install; the first-run tests turn this off.
let seenIntro = true;

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const sendBody = (overrides: Record<string, unknown> = {}) => ({
  message: 'Verification code sent.',
  identifier_type: 'email',
  channel: 'email',
  delivered: true,
  dev_code: null,
  expires_in: 300,
  resend_in: 30,
  ...overrides,
});

const apiError = (status: number, detail: Record<string, unknown>) =>
  jsonResponse(status, { detail });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

// Answers the two OTP endpoints. A handler may return a promise left pending.
const mockBackend = (routes: {
  send?: () => unknown;
  verify?: () => unknown;
}) => {
  fetchMock.mockImplementation((url: string) => {
    const handler = url.endsWith('/auth/otp/send')
      ? routes.send
      : routes.verify;
    return Promise.resolve(
      handler ? handler() : jsonResponse(404, { detail: 'Not Found' }),
    );
  });
};

const bodyOfCall = (index: number) => JSON.parse(fetchMock.mock.calls[index][1].body);

// Signs up through the identify step so the verify step is showing.
const startVerify = async (renderer: Renderer, identifier = 'name@example.com') => {
  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, identifier);
  await pressByText(renderer, 'Send verification code');
};

// Fake timers for the whole file. Swapping fake -> real timers between tests
// leaves Jest spinning on setImmediate after the last test (the run never
// exits), so install them once and restore only after the final test.
beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  alertSpy.mockClear();
  setStorage(createMemoryStorage());
  resetAppStore();
  resetDemo();
  resetLocalOtp();
  seenIntro = true;
  // Default: the Backend is unreachable, so the on-device code fallback runs.
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  (globalThis as any).fetch = fetchMock;
});

afterEach(async () => {
  (globalThis as any).__DEV__ = true;
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('renders correctly', async () => {
  const renderer = await renderApp();
  expect(textsOf(renderer)).toContain(WELCOME_HEADLINE);
});

test('the welcome screen leads with the brand, one promise and two actions', async () => {
  const renderer = await renderApp();
  const texts = textsOf(renderer);
  expect(texts).toContain('PlugOrbit');
  expect(texts).toContain(WELCOME_HEADLINE);
  expect(texts).toContain('Get started');
  expect(texts).toContain('I already have an account');
  // No second "Welcome to ..." title repeating the brand name.
  expect(texts).not.toContain('Welcome to PlugOrbit');
});

test('the welcome screen scrolls, so large system text never hides a button', async () => {
  const renderer = await renderApp();
  expect(renderer.root.findAllByType(ScrollView)).toHaveLength(1);
  const buttons = renderer.root.findAll(
    n => n.props.accessibilityRole === 'button' && n.props.onPress,
  );
  expect(buttons.length).toBeGreaterThanOrEqual(2);
});

test('the sign-in screen has exactly one back control, an icon arrow', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'I already have an account');

  const backs = renderer.root.findAll(
    n => n.props.accessibilityLabel === 'Back' && n.props.onPress,
  );
  expect(backs).toHaveLength(1);
  expect(textsOf(renderer)).not.toContain('← Back');

  await pressBack(renderer);
  expect(textsOf(renderer)).toContain(WELCOME_HEADLINE);
});

test('the mobile/email badge only appears once the input is recognised', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  expect(textsOf(renderer)).not.toContain('Auto-Detect');
  expect(textsOf(renderer)).not.toContain('Email');

  await typeIdentifier(renderer, 'name@example.com');
  expect(textsOf(renderer)).toContain('Email');
});

test('sign up uses a single mobile/email field followed by an OTP step', async () => {
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');

  // No name or password fields any more: just one identifier input.
  const inputs = renderer.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(1);

  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send verification code');

  const texts = textsOf(renderer);
  expect(texts).toContain('Enter your code');
  expect(texts).toContain('Verify and create account');
});

test('switching Sign Up / Sign In while a code is being sent drops the request', async () => {
  const send = deferred<unknown>();
  mockBackend({ send: () => send.promise });
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressWithoutWaiting(renderer, 'Send verification code');
  expect(textsOf(renderer)).toContain('Sending code…');
  await pressByText(renderer, ' Log in');

  // The response only arrives once the user has moved on.
  send.resolve(jsonResponse(200, sendBody()));
  await flush();

  const texts = textsOf(renderer);
  expect(texts).toContain('Welcome back');
  expect(texts).toContain('Send verification code');
  expect(texts).not.toContain('Enter your code');
  expect(alertSpy).not.toHaveBeenCalled();
  expect(messageOf(renderer)).toBeNull();
});

test('the identifier field is locked while a code is being sent', async () => {
  const send = deferred<unknown>();
  mockBackend({ send: () => send.promise });
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  expect(renderer.root.findByType(TextInput).props.editable).toBe(true);
  await pressWithoutWaiting(renderer, 'Send verification code');
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);

  send.resolve(jsonResponse(200, sendBody()));
  await flush();
  expect(textsOf(renderer)).toContain('Enter your code');
});

test('going Back while a code is being sent does not alert over the welcome screen', async () => {
  const send = deferred<unknown>();
  mockBackend({ send: () => send.promise });
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressWithoutWaiting(renderer, 'Send verification code');
  await pressBack(renderer);
  send.resolve(jsonResponse(200, sendBody()));
  await flush();

  expect(textsOf(renderer)).toContain(WELCOME_HEADLINE);
  expect(alertSpy).not.toHaveBeenCalled();
  expect(messageOf(renderer)).toBeNull();
});

test('submitting from the keyboard while a code is being sent does not send twice', async () => {
  const send = deferred<unknown>();
  mockBackend({ send: () => send.promise });
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressWithoutWaiting(renderer, 'Send verification code');
  await ReactTestRenderer.act(async () => {
    renderer.root.findByType(TextInput).props.onSubmitEditing();
  });
  send.resolve(jsonResponse(200, sendBody()));
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(textsOf(renderer)).toContain('Enter your code');
});

test('a failing request that outlives the screen does not alert either', async () => {
  const send = deferred<unknown>();
  mockBackend({
    send: () => send.promise,
  });
  const renderer = await renderApp();

  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressWithoutWaiting(renderer, 'Send verification code');
  await pressBack(renderer);
  send.resolve(
    apiError(429, {
      code: 'OTP_RATE_LIMITED',
      message: 'Please wait before requesting another code.',
      retry_after: 12,
    }),
  );
  await flush();

  expect(textsOf(renderer)).toContain(WELCOME_HEADLINE);
  expect(alertSpy).not.toHaveBeenCalled();
  expect(messageOf(renderer)).toBeNull();
});

test('tapping Change while verifying drops the pending verification', async () => {
  const verify = deferred<unknown>();
  mockBackend({
    send: () => jsonResponse(200, sendBody()),
    verify: () => verify.promise,
  });
  const renderer = await renderApp();

  await startVerify(renderer);

  await typeOtp(renderer, '123456');
  await pressWithoutWaiting(renderer, 'Verify and create account');
  expect(textsOf(renderer)).toContain('Verifying…');
  alertSpy.mockClear();
  await pressByText(renderer, 'Change');

  // A late "verified" must neither sign in nor alert.
  verify.resolve(jsonResponse(200, { verified: true, message: 'Verified.' }));
  await flush();

  expect(textsOf(renderer)).toContain('Send verification code');
  expect(alertSpy).not.toHaveBeenCalled();
  expect(messageOf(renderer)).toBeNull();
  expect(appStore.get().signedIn).toBe(false);
});

test('keyboard stays email-capable while typing a numeric-prefixed email', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');

  // At 7+ digits the input is indistinguishable from a phone number, but it
  // may still turn into an email, so the "@"-capable keyboard must remain.
  for (const value of ['9', '9876543', '9876543210', '9876543210@gmail.com']) {
    await typeIdentifier(renderer, value);
    expect(renderer.root.findByType(TextInput).props.keyboardType).toBe(
      'email-address',
    );
  }
});

test('a plain mobile number is still detected as a mobile number', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');

  await typeIdentifier(renderer, '+91 98765 43210');
  expect(textsOf(renderer)).toContain('Mobile');
});

test('a verified code lands on vehicle setup for a new account', async () => {
  const renderer = await renderApp();

  // Backend unreachable: the code is generated on the device and shown.
  await startVerify(renderer);
  const code = devCodeOf(renderer);
  expect(code).toMatch(/^\d{6}$/);

  await typeOtp(renderer, code!);
  await pressByText(renderer, 'Verify and create account');
  // Saved-state loading settles inside async act.
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => {});
  }

  // A new account has no vehicle yet, so sign-in lands on onboarding.
  expect(textsOf(renderer)).toContain('Vehicle setup');
});

test('a code sent by email shows no DEV banner, only how it was sent', async () => {
  mockBackend({ send: () => jsonResponse(200, sendBody({ resend_in: 45 })) });
  const renderer = await renderApp();

  await startVerify(renderer);

  const texts = textsOf(renderer);
  expect(texts).toContain('Enter your code');
  expect(texts).toContain('Sent by email');
  expect(texts).not.toContain('DEV MODE');
  expect(texts).toContain(' Resend in 45s');
  // No popup: the screen itself says where the code went and how.
  expect(alertSpy).not.toHaveBeenCalled();
  expect(texts).toContain('name@example.com');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/auth\/otp\/send$/);
  expect(init.method).toBe('POST');
  expect(bodyOfCall(0)).toEqual({ identifier: 'name@example.com' });
});

test('a code sent by SMS says so', async () => {
  mockBackend({
    send: () =>
      jsonResponse(200, sendBody({ channel: 'sms', identifier_type: 'phone' })),
  });
  const renderer = await renderApp();

  await startVerify(renderer, '+91 98765 43210');

  const texts = textsOf(renderer);
  expect(texts).toContain('Sent by SMS');
  expect(texts).not.toContain('DEV MODE');
  expect(bodyOfCall(0)).toEqual({ identifier: '+91 98765 43210' });
});

test('when the Backend cannot deliver, the code is shown on screen and can be filled in', async () => {
  mockBackend({
    send: () =>
      jsonResponse(
        200,
        sendBody({ channel: 'screen', delivered: false, dev_code: '654321' }),
      ),
  });
  const renderer = await renderApp();

  await startVerify(renderer);

  const texts = textsOf(renderer);
  expect(texts).toContain('DEV MODE');
  expect(texts).toContain('Your code is 654321');
  expect(texts).not.toContain('Sent by email');
  expect(texts).not.toContain(
    'Backend unreachable, code generated on this device',
  );
  expect(alertSpy).not.toHaveBeenCalled();

  expect(otpValueOf(renderer)).toBe('');
  await pressByText(renderer, 'Tap to fill');
  expect(otpValueOf(renderer)).toBe('654321');
});

test('the DEV banner stays readable in the light and the dark theme', async () => {
  const renderer = await renderApp();
  await startVerify(renderer);

  const readableBackground = () => {
    const banner = findText(renderer, 'DEV MODE').parent!;
    const background = StyleSheet.flatten(banner.props.style).backgroundColor;
    const lines = [
      'DEV MODE',
      `Your code is ${devCodeOf(renderer)}`,
      'Backend unreachable, code generated on this device',
      'Tap to fill',
    ];
    for (const line of lines) {
      const color = StyleSheet.flatten(findText(renderer, line).props.style).color;
      expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
    }
    return background;
  };

  const lightBackground = readableBackground();
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ accessibilityLabel: 'Toggle dark mode' })
      .props.onPress(),
  );
  expect(readableBackground()).not.toBe(lightBackground);
});

test('with no Backend the code is generated on the device and shown', async () => {
  const renderer = await renderApp();

  await startVerify(renderer);

  const texts = textsOf(renderer);
  expect(texts).toContain('Enter your code');
  expect(texts).toContain('DEV MODE');
  expect(texts).toContain('Backend unreachable, code generated on this device');
  const code = devCodeOf(renderer);
  expect(code).toMatch(/^\d{6}$/);
  expect(alertSpy).not.toHaveBeenCalled();

  await pressByText(renderer, 'Tap to fill');
  expect(otpValueOf(renderer)).toBe(code);
});

test('in a release build an unreachable Backend is reported, not faked', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');

  (globalThis as any).__DEV__ = false;
  await pressByText(renderer, 'Send verification code');

  expect(messageOf(renderer)).toBe(
    'Could not reach the server. Check your connection and try again.',
  );
  const texts = textsOf(renderer);
  expect(texts).toContain('Send verification code');
  expect(texts).not.toContain('DEV MODE');
  expect(texts).not.toContain('Enter your code');
});

test('a wrong code is explained inline, clears the boxes and stays on the verify step', async () => {
  mockBackend({
    send: () => jsonResponse(200, sendBody()),
    verify: () =>
      apiError(400, {
        code: 'OTP_INVALID',
        message: 'Incorrect code. 4 attempts left.',
        attempts_left: 4,
      }),
  });
  const renderer = await renderApp();
  await startVerify(renderer);

  await typeOtp(renderer, '000000');
  alertSpy.mockClear();
  await pressByText(renderer, 'Verify and create account');

  expect(messageOf(renderer)).toBe('Incorrect code. 4 attempts left.');
  const texts = textsOf(renderer);
  expect(texts).toContain('Enter your code');
  expect(texts).toContain('Verify and create account');
  expect(otpValueOf(renderer)).toBe('');
  expect(appStore.get().signedIn).toBe(false);
});

test('a wrong code against an on-device code is rejected too', async () => {
  const renderer = await renderApp();
  await startVerify(renderer);
  const code = devCodeOf(renderer)!;

  await typeOtp(renderer, code === '000000' ? '111111' : '000000');
  alertSpy.mockClear();
  await pressByText(renderer, 'Verify and create account');

  expect(messageOf(renderer)).toBe('Incorrect code. 4 attempts left.');
  expect(textsOf(renderer)).toContain('Enter your code');
  expect(appStore.get().signedIn).toBe(false);
});

test('a verification the server cannot answer says Verification Failed', async () => {
  mockBackend({
    send: () => jsonResponse(200, sendBody()),
    verify: () => Promise.reject(new TypeError('Network request failed')),
  });
  const renderer = await renderApp();
  await startVerify(renderer);

  await typeOtp(renderer, '123456');
  alertSpy.mockClear();
  await pressByText(renderer, 'Verify and create account');

  expect(messageOf(renderer)).toBe(
    'Verification failed. Could not reach the server. Check your connection and try again.',
  );
  expect(textsOf(renderer)).toContain('Verify and create account');
  expect(otpValueOf(renderer)).toBe('');
});

test('the Backend confirms the typed code and the user is signed in', async () => {
  mockBackend({
    send: () => jsonResponse(200, sendBody()),
    verify: () => jsonResponse(200, { verified: true, message: 'Verified.' }),
  });
  const renderer = await renderApp();
  await startVerify(renderer);

  await typeOtp(renderer, '123456');
  await pressByText(renderer, 'Verify and create account');
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => {});
  }

  expect(fetchMock.mock.calls[1][0]).toMatch(/\/auth\/otp\/verify$/);
  expect(bodyOfCall(1)).toEqual({
    identifier: 'name@example.com',
    code: '123456',
  });
  expect(appStore.get().signedIn).toBe(true);
  expect(textsOf(renderer)).toContain('Vehicle setup');
});

test('a rate-limited send shows the Backend message and stays on the identify step', async () => {
  mockBackend({
    send: () =>
      apiError(429, {
        code: 'OTP_RATE_LIMITED',
        message: 'Please wait 20 seconds before requesting another code.',
        retry_after: 20,
      }),
  });
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send verification code');

  expect(messageOf(renderer)).toBe(
    'Please wait 20 seconds before requesting another code.',
  );
  const texts = textsOf(renderer);
  expect(texts).toContain('Send verification code');
  expect(texts).not.toContain('Enter your code');
  // A structured answer never triggers the on-device fallback.
  expect(texts).not.toContain('DEV MODE');
});

test('a failed delivery from the Backend is reported, not replaced by a fake code', async () => {
  mockBackend({
    send: () =>
      apiError(503, {
        code: 'OTP_DELIVERY_FAILED',
        message: 'We could not send the code. Try again later.',
      }),
  });
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send verification code');

  expect(messageOf(renderer)).toBe(
    'We could not send the code. Try again later.',
  );
  expect(textsOf(renderer)).not.toContain('DEV MODE');
});

test('Resend becomes available after the countdown and sends a fresh code', async () => {
  let call = 0;
  mockBackend({
    send: () =>
      jsonResponse(
        200,
        call++ === 0
          ? sendBody()
          : sendBody({ channel: 'screen', delivered: false, dev_code: '111111' }),
      ),
  });
  const renderer = await renderApp();
  await startVerify(renderer);

  expect(textsOf(renderer)).toContain(' Resend in 30s');
  expect(textsOf(renderer)).not.toContain(' Resend code');
  await typeOtp(renderer, '123');

  for (let i = 0; i < 30; i++) {
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  expect(textsOf(renderer)).toContain(' Resend code');

  alertSpy.mockClear();
  await pressByText(renderer, ' Resend code');

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const texts = textsOf(renderer);
  expect(texts).toContain('Your code is 111111');
  expect(texts).not.toContain('Sent by email');
  expect(texts).toContain(' Resend in 30s');
  expect(otpValueOf(renderer)).toBe('');
  expect(alertSpy).not.toHaveBeenCalled();
});

test('a signed-in user with a vehicle goes straight to Home on launch', async () => {
  seedSignedIn();
  const { signedIn, vehicles, activeVehicleId, battery } = appStore.get();
  setStorage(
    createMemoryStorage({
      'plugorbit/app': JSON.stringify({
        v: STORE_VERSION,
        d: { signedIn, vehicles, activeVehicleId, battery },
      }),
    }),
  );
  resetAppStore();

  const renderer = await renderApp();
  expect(textsOf(renderer)).toContain('Find a Charger');
  expect(textsOf(renderer)).not.toContain(WELCOME_HEADLINE);
});

// ---------------------------------------------------------------------------
// Inline validation, duplicate-submit guards, honest sign-in options
// ---------------------------------------------------------------------------

test('an empty field is explained inline and nothing is sent', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  await pressByText(renderer, 'Send verification code');

  expect(messageOf(renderer)).toBe('Enter your mobile number or email address.');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(alertSpy).not.toHaveBeenCalled();
});

test('an invalid address is explained inline, and typing again clears the message', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  await typeIdentifier(renderer, 'not-an-email');
  await pressByText(renderer, 'Send verification code');

  expect(messageOf(renderer)).toBe(
    'That doesn’t look like a valid mobile number or email address.',
  );
  expect(fetchMock).not.toHaveBeenCalled();

  await typeIdentifier(renderer, 'name@example.com');
  expect(messageOf(renderer)).toBeNull();
});

test('an incomplete code is explained inline and not submitted', async () => {
  mockBackend({ send: () => jsonResponse(200, sendBody()) });
  const renderer = await renderApp();
  await startVerify(renderer);

  await typeOtp(renderer, '123');
  await pressByText(renderer, 'Verify and create account');

  expect(messageOf(renderer)).toBe('Enter the 6-digit code.');
  // Only the send request went out; nothing was spent on a verify attempt.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('submitting the code twice sends one verification request', async () => {
  const verify = deferred<unknown>();
  mockBackend({
    send: () => jsonResponse(200, sendBody()),
    verify: () => verify.promise,
  });
  const renderer = await renderApp();
  await startVerify(renderer);
  await typeOtp(renderer, '123456');

  await pressWithoutWaiting(renderer, 'Verify and create account');
  // The keyboard's own submit key is not disabled while the request is in flight.
  await ReactTestRenderer.act(async () => {
    renderer.root.findByType(TextInput).props.onSubmitEditing();
  });
  verify.resolve(jsonResponse(200, { verified: true, message: 'Verified.' }));
  await flush();

  const verifyCalls = fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/auth/otp/verify'),
  );
  expect(verifyCalls).toHaveLength(1);
});

test('only sign-in methods that work are offered', async () => {
  const renderer = await renderApp();
  const everyScreen: unknown[] = [...textsOf(renderer)];
  await pressByText(renderer, 'Get started');
  everyScreen.push(...textsOf(renderer));
  await pressByText(renderer, ' Log in');
  everyScreen.push(...textsOf(renderer));

  // The old "Sign In with Google" button only said "coming soon". Until it is
  // implemented it must not look like a way in.
  expect(everyScreen.filter(t => typeof t === 'string' && /google/i.test(t))).toEqual([]);
  expect(alertSpy).not.toHaveBeenCalled();
});

test('there is no password field: a one-time code is the only credential', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get started');
  const input = renderer.root.findByType(TextInput);
  expect(input.props.secureTextEntry).toBeFalsy();
  expect(textsOf(renderer).join(' ')).toMatch(/No password needed/);
});

// ---------------------------------------------------------------------------
// First-run introduction
// ---------------------------------------------------------------------------

describe('first-run introduction', () => {
  test('Get started shows three slides, the last of which leads to sign up', async () => {
    seenIntro = false;
    const renderer = await renderApp();
    await pressByText(renderer, 'Get started');

    expect(textsOf(renderer)).toContain('Find charging anywhere');
    expect(textsOf(renderer)).toContain('Skip');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Step 1 of 3' })).toBeTruthy();

    await pressByText(renderer, 'Next');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Step 2 of 3' })).toBeTruthy();
    await pressByText(renderer, 'Next');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Step 3 of 3' })).toBeTruthy();
    // The last slide has nothing left to skip.
    expect(textsOf(renderer)).not.toContain('Skip');
    expect(textsOf(renderer)).not.toContain('Next');
    expect(await hasSeenOnboarding()).toBe(false);

    // Both "Get started" labels (slide and, later, none) press the same primary button.
    await pressByText(renderer, 'Get started');
    expect(textsOf(renderer)).toContain('Create your account');
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(await hasSeenOnboarding()).toBe(true);
  });

  test('Skip goes to sign up and the introduction is never shown again', async () => {
    seenIntro = false;
    const first = await renderApp();
    await pressByText(first, 'Get started');
    await pressByText(first, 'Skip');
    expect(textsOf(first)).toContain('Create your account');
    expect(await hasSeenOnboarding()).toBe(true);

    // A later visit (for example after signing out) goes straight to sign up.
    await ReactTestRenderer.act(async () => first.unmount());
    mounted.length = 0;
    const second = await renderApp();
    await pressByText(second, 'Get started');
    expect(textsOf(second)).not.toContain('Find charging anywhere');
    expect(textsOf(second)).toContain('Create your account');
  });

  test('Log in never waits for the introduction', async () => {
    seenIntro = false;
    const renderer = await renderApp();
    await pressByText(renderer, 'I already have an account');

    expect(textsOf(renderer)).toContain('Welcome back');
    expect(textsOf(renderer)).not.toContain('Find charging anywhere');
    expect(await hasSeenOnboarding()).toBe(false);
  });

  test('Android back steps back through the slides, then to Welcome', async () => {
    seenIntro = false;
    // Capture the hardware-back handlers the screens register; the newest one wins.
    const handlers: Array<() => boolean | null | undefined> = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((
      _name: string,
      handler: () => boolean | null | undefined,
    ) => {
      handlers.push(handler);
      return {
        remove: () => {
          const i = handlers.indexOf(handler);
          if (i >= 0) {
            handlers.splice(i, 1);
          }
        },
      };
    }) as never);
    const back = () =>
      ReactTestRenderer.act(async () => {
        handlers[handlers.length - 1]?.();
      });
    const renderer = await renderApp();
    await pressByText(renderer, 'Get started');
    await pressByText(renderer, 'Next');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Step 2 of 3' })).toBeTruthy();

    await back();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Step 1 of 3' })).toBeTruthy();
    await back();
    expect(textsOf(renderer)).toContain(WELCOME_HEADLINE);
    spy.mockRestore();
  });
});
