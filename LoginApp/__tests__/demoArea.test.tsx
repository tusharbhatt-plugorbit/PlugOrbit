/**
 * @format
 *
 * A phone far from the demo chargers (all around New Delhi) must still find
 * chargers, and the screens must say why, in the same notice pattern as a
 * denied location.
 */

jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  googleApiKey: '',
  hasGoogleApiKey: false,
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {DEFAULT_CENTER} from '../src/config/google';
import {NEXON, TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {
  clearDiscoverCache,
  loadDiscover,
  originFromDevice,
} from '../src/hooks/useDiscoverStations';
import {createStationService} from '../src/services/mock/stationService';
import type {Services} from '../src/services/types';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const getCurrentPosition = Geolocation.getCurrentPosition as jest.Mock;
const CALIFORNIA = {latitude: 37.42, longitude: -122.08};
const MUMBAI = {latitude: 19.076, longitude: 72.8777};
const NOTICE = 'No chargers near you. Showing demo chargers around New Delhi.';

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

const mounted: Renderer[] = [];

async function renderTab(
  tab: 'Home' | 'Charge',
  services?: Partial<Services>,
): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TestApp tab={tab} services={services} />,
    );
  });
  mounted.push(renderer);
  await flush();
  return renderer;
}

const textsOf = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const markerLabels = (r: Renderer) => [
  ...new Set(
    r.root
      .findAll(
        n =>
          typeof n.props.onPress === 'function' &&
          typeof n.props.accessibilityLabel === 'string',
      )
      .map(n => n.props.accessibilityLabel as string)
      .filter(l => /chargers available$/.test(l)),
  ),
];

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  seedSignedIn();
  clearDiscoverCache();
  getCurrentPosition.mockReset();
  getCurrentPosition.mockImplementation(success =>
    success({coords: CALIFORNIA}),
  );
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('without Google results a far-away phone is placed in New Delhi', () => {
  expect(originFromDevice(CALIFORNIA)).toMatchObject({
    origin: DEFAULT_CENTER,
    userLocation: null,
    locationIssue: null,
    demoArea: true,
  });
  expect(originFromDevice(MUMBAI).demoArea).toBe(true);
  const near = {latitude: 28.5, longitude: 77.1};
  expect(originFromDevice(near)).toMatchObject({
    origin: near,
    userLocation: near,
    demoArea: false,
  });
});

test('the nearby list has chargers and explains the demo area', async () => {
  jest.useRealTimers(); // the mock service waits on a (zero) timer
  try {
    const data = await loadDiscover(createStationService(), NEXON, true);
    expect(data.demoArea).toBe(true);
    expect(data.stations.length).toBeGreaterThan(5);
    // Measured from New Delhi, not 12,000 km away.
    expect(Math.max(...data.stations.map(s => s.distanceKm))).toBeLessThan(400);
  } finally {
    jest.useFakeTimers();
  }
});

test('Home shows demo chargers around New Delhi with an honest notice', async () => {
  const stationService = createStationService();
  const nearby = jest.fn(stationService.nearby);
  const r = await renderTab('Home', {station: {...stationService, nearby}});
  expect(nearby.mock.calls[0][0].origin).toEqual(DEFAULT_CENTER);
  expect(textsOf(r)).toContain(NOTICE);
  expect(textsOf(r)).not.toContain('No compatible chargers found nearby');
  expect(markerLabels(r).length).toBeGreaterThan(3);
});

test('the Charge tab lists chargers and says so too', async () => {
  const r = await renderTab('Charge');
  expect(textsOf(r)).toContain(NOTICE);
  expect(textsOf(r)).toContain('Best nearby');
  expect(textsOf(r)).not.toContain('No compatible chargers nearby');
});

test('Scan QR finds a charger to scan instead of "none found"', async () => {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<TestApp stack={[{name: 'ScanQr'}]} />);
  });
  mounted.push(r);
  await flush();
  const scan = r.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === 'Simulate scan',
  )[0];
  await act(async () => {
    scan.props.onPress();
  });
  await flush();
  expect(probe.current).toBe('StartCharging');
});
