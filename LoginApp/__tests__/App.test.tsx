/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';
import App from '../App';

test('renders correctly', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const texts = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children);
  expect(texts).toContain('Welcome to PlugOrbit');
});

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

test('sign up uses a single mobile/email field followed by an OTP step', async () => {
  jest.useFakeTimers();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const pressByText = async (label: string) => {
    const node = renderer.root
      .findAllByType(Text)
      .find(n => n.props.children === label);
    let target: ReactTestRenderer.ReactTestInstance | null = node ?? null;
    while (target && !target.props.onPress) {
      target = target.parent;
    }
    await ReactTestRenderer.act(() => target!.props.onPress());
  };

  await pressByText('Get Started');

  // No name or password fields any more: just one identifier input.
  const inputs = renderer.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(1);

  await ReactTestRenderer.act(() =>
    inputs[0].props.onChangeText('name@example.com'),
  );
  await pressByText('Send Verification Code  →');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1000);
  });

  const texts = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children);
  expect(texts).toContain('Verify Code');
  expect(texts).toContain('Verify & Create Account  →');
  jest.useRealTimers();
});
