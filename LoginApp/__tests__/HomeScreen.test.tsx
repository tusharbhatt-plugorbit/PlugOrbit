/**
 * @format
 */

// No API key in this file: the screen runs on the built-in demo chargers.
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import HomeScreen from '../src/screens/HomeScreen';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => {});
  }
};

const renderHome = async (): Promise<Renderer> => {
  let renderer!: Renderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<HomeScreen />);
  });
  mounted.push(renderer);
  await flush();
  return renderer;
};

const textsOf = (renderer: Renderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

// Pressable and Marker are wrappers, so match on props instead of element type.
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
  await ReactTestRenderer.act(async () => node!.props.onPress());
};

const pressText = async (renderer: Renderer, label: string) => {
  const textNode = renderer.root
    .findAllByType(Text)
    .find(n => n.props.children === label);
  let target: ReactTestRenderer.ReactTestInstance | null = textNode ?? null;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  await ReactTestRenderer.act(async () => target!.props.onPress());
};

// findAll also returns the wrapper layers of each element; dedupe by label.
const markerLabels = (renderer: Renderer) => [
  ...new Set(
    pressables(renderer)
      .map(n => n.props.accessibilityLabel as string)
      .filter(label => label.includes('chargers available')),
  ),
];

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

test('shows the title, filters and opens the nearest demo charger', async () => {
  const renderer = await renderHome();
  const texts = textsOf(renderer);
  expect(texts).toContain('Find a Charger');
  for (const f of ['All', 'Fast', 'Available', 'Near me']) {
    expect(texts).toContain(f);
  }
  // Nearest to the (mocked) device location is Orbit Metro Station.
  expect(texts).toContain('Orbit Metro Station');
  expect(markerLabels(renderer)).toHaveLength(5);
});

test('tells the user they are looking at demo data when no key is set', async () => {
  const renderer = await renderHome();
  expect(textsOf(renderer)).toContain(
    'Showing demo chargers. Add GOOGLE_MAPS_API_KEY to see real ones.',
  );
});

test('Available filter drops the busy charger marker', async () => {
  const renderer = await renderHome();
  const busy = 'Green Park Chargers, 0 of 4 chargers available';

  expect(markerLabels(renderer)).toContain(busy);
  await pressText(renderer, 'Available');
  expect(markerLabels(renderer)).not.toContain(busy);
});

test('Fast filter keeps only 50 kW and above', async () => {
  const renderer = await renderHome();
  await pressText(renderer, 'Fast');
  // PlugOrbit Charge Hub (250), Orbit Metro Station (60), Lakeside (120).
  expect(markerLabels(renderer)).toHaveLength(3);
});

test('search matches name or address and shows the empty state', async () => {
  const renderer = await renderHome();
  const input = renderer.root.findByType(TextInput);

  await ReactTestRenderer.act(() => input.props.onChangeText('karol bagh'));
  expect(markerLabels(renderer)).toEqual([
    'City Mall Charging, 1 of 2 chargers available',
  ]);

  await ReactTestRenderer.act(() => input.props.onChangeText('zzz'));
  expect(markerLabels(renderer)).toHaveLength(0);
});

test('closing the card hides it and tapping a marker shows another', async () => {
  const renderer = await renderHome();

  await pressLabel(renderer, 'Close details');
  expect(textsOf(renderer)).not.toContain('Orbit Metro Station');

  await pressLabel(renderer, 'PlugOrbit Charge Hub, 4 of 6 chargers available');
  expect(textsOf(renderer)).toContain('PlugOrbit Charge Hub');
});

test('when location is denied it explains and offers a retry', async () => {
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
    (_success, error) => error({code: 1, message: 'denied'}),
  );
  const renderer = await renderHome();
  expect(textsOf(renderer)).toContain(
    'Location is off. Showing chargers near New Delhi.',
  );

  // Retry re-asks for the location, which now succeeds.
  await pressLabel(renderer, 'Try again');
  await flush();
  expect(textsOf(renderer)).not.toContain(
    'Location is off. Showing chargers near New Delhi.',
  );
});
