/**
 * @format
 */

// Same screen, but with a Google API key configured and Places mocked.
jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  googleApiKey: 'test-key',
  hasGoogleApiKey: true,
}));
jest.mock('../src/services/places', () => ({
  ...jest.requireActual('../src/services/places'),
  fetchNearbyChargers: jest.fn(),
}));
jest.mock('../src/services/directions', () => ({
  openDirections: jest.fn().mockResolvedValue(true),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Alert, Text} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import HomeScreen from '../src/screens/HomeScreen';
import {DEFAULT_CENTER} from '../src/config/google';
import type {Charger} from '../src/data/chargers';
import {openDirections} from '../src/services/directions';
import {PlacesError, fetchNearbyChargers} from '../src/services/places';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const fetchMock = fetchNearbyChargers as jest.Mock;
const getCurrentPosition = Geolocation.getCurrentPosition as jest.Mock;

const USER = {latitude: 12.9716, longitude: 77.5946};

const charger = (id: string, over: Partial<Charger> = {}): Charger => ({
  id,
  name: `Station ${id}`,
  address: `${id} Main Road`,
  latitude: USER.latitude + 0.01,
  longitude: USER.longitude,
  powerKw: 60,
  available: 2,
  total: 4,
  hours: 'Open now',
  pricePerKwh: null,
  ...over,
});

const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 4; i++) {
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

const markerLabels = (renderer: Renderer) => [
  ...new Set(
    pressables(renderer)
      .map(n => n.props.accessibilityLabel as string)
      .filter(label => label.includes('chargers available')),
  ),
];

const pan = async (renderer: Renderer, latitude: number, isGesture = true) => {
  const map = renderer.root.findByProps({testID: 'map'});
  await ReactTestRenderer.act(() =>
    map.props.onRegionChangeComplete(
      {
        latitude,
        longitude: USER.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      },
      {isGesture},
    ),
  );
};

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  fetchMock.mockReset();
  getCurrentPosition.mockReset();
  getCurrentPosition.mockImplementation(success =>
    success({coords: {latitude: USER.latitude, longitude: USER.longitude}}),
  );
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('searches around the device location and shows the results', async () => {
  fetchMock.mockResolvedValue([charger('1'), charger('2', {available: 0})]);
  const renderer = await renderHome();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(USER);
  expect(markerLabels(renderer)).toEqual([
    'Station 1, 2 of 4 chargers available',
    'Station 2, 0 of 4 chargers available',
  ]);
  // Real results, so no demo banner.
  expect(textsOf(renderer).join(' ')).not.toMatch(/demo/i);
  // Nearest charger is pre-selected; Google has no tariff, so no price shown.
  expect(textsOf(renderer)).toContain('Station 1');
  expect(textsOf(renderer).join(' ')).not.toContain('/kWh');
});

test('Directions hands the selected charger to Google Maps', async () => {
  fetchMock.mockResolvedValue([charger('1')]);
  const renderer = await renderHome();

  await pressLabel(renderer, 'Directions to Station 1');
  expect(openDirections).toHaveBeenCalledWith(
    expect.objectContaining({id: '1', name: 'Station 1'}),
  );
});

test('shows an alert if Google Maps cannot be opened', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (openDirections as jest.Mock).mockResolvedValueOnce(false);
  fetchMock.mockResolvedValue([charger('1')]);
  const renderer = await renderHome();

  await pressLabel(renderer, 'Directions to Station 1');
  expect(alertSpy).toHaveBeenCalledWith(
    'Directions',
    'Could not open Google Maps.',
  );
  alertSpy.mockRestore();
});

test('denied location still searches, around the default centre', async () => {
  getCurrentPosition.mockImplementation((_success, error) =>
    error({code: 1, message: 'denied'}),
  );
  fetchMock.mockResolvedValue([charger('1')]);
  const renderer = await renderHome();

  expect(fetchMock.mock.calls[0][0]).toEqual(DEFAULT_CENTER);
  expect(textsOf(renderer)).toContain(
    'Location is off. Showing chargers near New Delhi.',
  );
  expect(markerLabels(renderer)).toHaveLength(1);
});

test('a failed search keeps the screen usable and Retry recovers', async () => {
  fetchMock
    .mockRejectedValueOnce(new PlacesError('Places API (New) is disabled', 403))
    .mockResolvedValueOnce([charger('1')]);
  const renderer = await renderHome();

  expect(textsOf(renderer)).toContain('Places API (New) is disabled');
  expect(markerLabels(renderer)).toHaveLength(0);

  await pressLabel(renderer, 'Try again');
  await flush();
  expect(textsOf(renderer)).not.toContain('Places API (New) is disabled');
  expect(markerLabels(renderer)).toHaveLength(1);
});

test('"Search this area" appears after a real pan and searches there', async () => {
  fetchMock.mockResolvedValue([charger('1')]);
  const renderer = await renderHome();
  expect(textsOf(renderer)).not.toContain('Search this area');

  // Our own animations (isGesture false) and tiny pans must not offer it.
  await pan(renderer, USER.latitude + 0.5, false);
  await pan(renderer, USER.latitude + 0.001);
  expect(textsOf(renderer)).not.toContain('Search this area');

  // ~0.5 degrees of latitude is ~55 km away.
  await pan(renderer, USER.latitude + 0.5);
  expect(textsOf(renderer)).toContain('Search this area');

  fetchMock.mockResolvedValue([charger('9', {latitude: USER.latitude + 0.5})]);
  const searchHere = renderer.root
    .findAllByType(Text)
    .find(n => n.props.children === 'Search this area')!;
  let target: ReactTestRenderer.ReactTestInstance | null = searchHere;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  await ReactTestRenderer.act(async () => target!.props.onPress());
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toEqual({
    latitude: USER.latitude + 0.5,
    longitude: USER.longitude,
  });
  expect(markerLabels(renderer)).toEqual([
    'Station 9, 2 of 4 chargers available',
  ]);
  expect(textsOf(renderer)).not.toContain('Search this area');
});

test('a slow, superseded search cannot overwrite newer results', async () => {
  let resolveFirst!: (value: Charger[]) => void;
  fetchMock
    .mockImplementationOnce(
      () =>
        new Promise<Charger[]>(resolve => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce([charger('new')]);
  // Location is off at first, so the first search runs around the default.
  getCurrentPosition.mockImplementationOnce((_success, error) =>
    error({code: 1, message: 'denied'}),
  );
  const renderer = await renderHome();

  // The first search is still in flight when the user taps "my location",
  // which re-locates (now succeeding) and starts a second search.
  await pressLabel(renderer, 'Go to my location');
  await flush();
  expect(markerLabels(renderer)).toEqual([
    'Station new, 2 of 4 chargers available',
  ]);

  // Now the stale response lands; it must be ignored.
  await ReactTestRenderer.act(async () => {
    resolveFirst([charger('stale')]);
  });
  await flush();
  expect(markerLabels(renderer)).toEqual([
    'Station new, 2 of 4 chargers available',
  ]);
});
