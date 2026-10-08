/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import ChargerMap from '../src/components/ChargerMap';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

// Google config as an Android build with no Maps key would see it.
jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  mapsKeyMissing: true,
}));

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

const texts = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

describe('Home without a Maps key', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  async function openHome(): Promise<Renderer> {
    seedSignedIn();
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(<TestApp tab="Home" />);
    });
    mounted.push(r);
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(60);
      });
    }
    return r;
  }

  test('says the map is unavailable instead of drawing a blank one', async () => {
    const r = await openHome();
    expect(
      r.root.findAll(n => n.props.testID === 'map-unavailable').length,
    ).toBeGreaterThan(0);
    expect(texts(r)).toContain('Map isn’t available');
    // No native map is created at all.
    expect(r.root.findAll(n => n.props.testID === 'map')).toHaveLength(0);
    // Nothing to recentre, but the rest of the screen still works.
    expect(
      r.root.findAll(n => n.props.accessibilityLabel === 'Go to my location'),
    ).toHaveLength(0);
    expect(
      r.root.findAll(n => n.props.accessibilityLabel === 'Filters').length,
    ).toBeGreaterThan(0);
  });

  test('chargers stay reachable as a list', async () => {
    const r = await openHome();
    const button = r.root.find(
      n =>
        n.props.accessibilityLabel === 'View chargers as a list' &&
        typeof n.props.onPress === 'function',
    );
    await act(async () => button.props.onPress());
    expect(probe.current).toBe('StationList');
  });

  test('does not claim the map failed to load', async () => {
    const r = await openHome();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(texts(r).join(' ')).not.toContain('taking too long');
  });
});

describe('ChargerMap route', () => {
  const base = {
    initialCenter: {latitude: 28.6, longitude: 77.2},
    chargers: [],
    vehicle: null,
    selectedId: null,
    showUserLocation: false,
    onSelect: () => {},
    onDeselect: () => {},
    onCenterChange: () => {},
  };

  async function render(route?: {latitude: number; longitude: number}[]) {
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(<ChargerMap {...base} route={route} />);
    });
    mounted.push(r);
    return r;
  }

  test('draws a polyline once there are two points', async () => {
    const r = await render([
      {latitude: 28.6, longitude: 77.2},
      {latitude: 28.7, longitude: 77.3},
    ]);
    const line = r.root.findAll(n => n.props.testID === 'route')[0];
    expect(line.props.coordinates).toHaveLength(2);
  });

  test('draws nothing for no route or a single point', async () => {
    expect(
      (await render()).root.findAll(n => n.props.testID === 'route'),
    ).toHaveLength(0);
    expect(
      (await render([{latitude: 1, longitude: 2}])).root.findAll(
        n => n.props.testID === 'route',
      ),
    ).toHaveLength(0);
  });
});

describe('Maps key detection', () => {
  // The real values are inlined from .env at bundle time, so test the rules.
  const {hasMapsKey, isMapsKeyMissing} = jest.requireActual(
    '../src/config/google',
  );

  test('a platform key, or the shared dev key, counts as a key', () => {
    expect(hasMapsKey('AIza-android', undefined)).toBe(true);
    expect(hasMapsKey('', 'AIza-shared')).toBe(true);
    expect(hasMapsKey('  ', undefined)).toBe(false);
    expect(hasMapsKey(undefined, undefined)).toBe(false);
  });

  test('Android with no key cannot draw a map', () => {
    expect(isMapsKeyMissing('android', false)).toBe(true);
    expect(isMapsKeyMissing('android', true)).toBe(false);
  });

  test('iOS falls back to Apple Maps, so no key is not an error', () => {
    expect(isMapsKeyMissing('ios', false)).toBe(false);
  });
});
