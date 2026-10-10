/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import ChargerMap from '../src/components/ChargerMap';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
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
