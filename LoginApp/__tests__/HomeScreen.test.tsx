/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import HomeScreen from '../src/screens/HomeScreen';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];

const renderHome = async (): Promise<Renderer> => {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<HomeScreen />);
  });
  mounted.push(renderer);
  return renderer;
};

const textsOf = (renderer: Renderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

// Pressable is a memo wrapper, so match on props instead of element type.
const pressables = (renderer: Renderer) =>
  renderer.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string',
  );

const pressLabel = async (renderer: Renderer, label: string) => {
  const node = pressables(renderer).find(
    n => n.props.accessibilityLabel === label,
  );
  await ReactTestRenderer.act(() => node!.props.onPress());
};

const pressText = async (renderer: Renderer, label: string) => {
  const textNode = renderer.root
    .findAllByType(Text)
    .find(n => n.props.children === label);
  let target: ReactTestRenderer.ReactTestInstance | null = textNode ?? null;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  await ReactTestRenderer.act(() => target!.props.onPress());
};

beforeAll(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('shows the title, filters and the first charger selected', async () => {
  const renderer = await renderHome();
  const texts = textsOf(renderer);
  expect(texts).toContain('Find a Charger');
  for (const f of ['All', 'Fast', 'Available', 'Near me']) {
    expect(texts).toContain(f);
  }
  expect(texts).toContain('PlugOrbit Charge Hub');
});

test('Available filter hides the busy charger and its pin', async () => {
  const renderer = await renderHome();
  const busyPin = 'Green Park Chargers, 0 of 4 chargers available';
  const pinLabels = () =>
    pressables(renderer).map(n => n.props.accessibilityLabel);

  expect(pinLabels()).toContain(busyPin);
  await pressText(renderer, 'Available');
  expect(pinLabels()).not.toContain(busyPin);
});

test('search filters pins and shows the empty state', async () => {
  const renderer = await renderHome();
  const input = renderer.root.findByType(TextInput);

  await ReactTestRenderer.act(() => input.props.onChangeText('zzz'));
  expect(textsOf(renderer)).toContain('No chargers match your search');
  // Card disappears with its pin.
  expect(textsOf(renderer)).not.toContain('PlugOrbit Charge Hub');
});

test('closing the card hides it and tapping a pin shows another', async () => {
  const renderer = await renderHome();

  await pressLabel(renderer, 'Close details');
  expect(textsOf(renderer)).not.toContain('PlugOrbit Charge Hub');

  await pressLabel(renderer, 'Orbit Metro Station, 2 of 4 chargers available');
  expect(textsOf(renderer)).toContain('Orbit Metro Station');
});
