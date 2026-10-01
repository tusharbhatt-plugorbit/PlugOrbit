/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';
import App from '../App';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];

const renderApp = async (): Promise<Renderer> => {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  mounted.push(renderer);
  return renderer;
};

const textsOf = (renderer: Renderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

const pressByText = async (renderer: Renderer, label: string) => {
  const node = renderer.root
    .findAllByType(Text)
    .find(n => n.props.children === label);
  let target: ReactTestRenderer.ReactTestInstance | null = node ?? null;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  await ReactTestRenderer.act(() => target!.props.onPress());
};

const typeIdentifier = async (renderer: Renderer, value: string) => {
  const input = renderer.root.findByType(TextInput);
  await ReactTestRenderer.act(() => input.props.onChangeText(value));
};

// Fake timers for the whole file. Swapping fake -> real timers between tests
// leaves Jest spinning on setImmediate after the last test (the run never
// exits), so install them once and restore only after the final test.
beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  alertSpy.mockClear();
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('renders correctly', async () => {
  const renderer = await renderApp();
  expect(textsOf(renderer)).toContain('Welcome to PlugOrbit');
});

test('sign up uses a single mobile/email field followed by an OTP step', async () => {
  const renderer = await renderApp();

  await pressByText(renderer, 'Get Started');

  // No name or password fields any more: just one identifier input.
  const inputs = renderer.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(1);

  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send Verification Code  →');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  const texts = textsOf(renderer);
  expect(texts).toContain('Verify Code');
  expect(texts).toContain('Verify & Create Account  →');
});

test('switching Sign Up / Sign In while a code is being sent drops the request', async () => {
  const renderer = await renderApp();

  await pressByText(renderer, 'Get Started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send Verification Code  →');
  await pressByText(renderer, ' Sign In');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  const texts = textsOf(renderer);
  expect(texts).toContain('Welcome Back');
  expect(texts).not.toContain('Verify Code');
  expect(alertSpy).not.toHaveBeenCalled();
});

test('going Back while a code is being sent does not alert over the welcome screen', async () => {
  const renderer = await renderApp();

  await pressByText(renderer, 'Get Started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send Verification Code  →');
  await pressByText(renderer, '← Back');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  expect(textsOf(renderer)).toContain('Welcome to PlugOrbit');
  expect(alertSpy).not.toHaveBeenCalled();
});

test('tapping Change while verifying drops the pending verification', async () => {
  const renderer = await renderApp();

  await pressByText(renderer, 'Get Started');
  await typeIdentifier(renderer, 'name@example.com');
  await pressByText(renderer, 'Send Verification Code  →');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  const otpInput = renderer.root.findByType(TextInput);
  await ReactTestRenderer.act(() => otpInput.props.onChangeText('123456'));
  await pressByText(renderer, 'Verify & Create Account  →');
  alertSpy.mockClear();
  await pressByText(renderer, '  Change');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  expect(textsOf(renderer)).toContain('Send Verification Code  →');
  expect(alertSpy).not.toHaveBeenCalled();
});

test('keyboard stays email-capable while typing a numeric-prefixed email', async () => {
  const renderer = await renderApp();
  await pressByText(renderer, 'Get Started');

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
  await pressByText(renderer, 'Get Started');

  await typeIdentifier(renderer, '+91 98765 43210');
  expect(textsOf(renderer)).toContain('📱 Mobile');
});
