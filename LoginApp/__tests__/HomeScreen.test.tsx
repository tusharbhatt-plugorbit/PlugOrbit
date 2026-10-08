/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {DEFAULT_CENTER} from '../src/config/google';
import {NEXON, TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {createStationService} from '../src/services/mock/stationService';
import type {Services} from '../src/services/types';
import {OfflineError} from '../src/services/types';
import {demoStore} from '../src/store/demoStore';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {appStore} from '../src/store/appStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const getCurrentPosition = Geolocation.getCurrentPosition as jest.Mock;
const USER = {latitude: 28.6139, longitude: 77.209};

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

const mounted: Renderer[] = [];

async function renderHome(services?: Partial<Services>): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TestApp tab="Home" services={services} />,
    );
  });
  mounted.push(renderer);
  await flush();
  return renderer;
}

const home = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID === 'screen-tab-Home',
  )[0];

const textsOf = (r: Renderer) =>
  home(r)
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const pressables = (r: Renderer) =>
  home(r).findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.initialRegion === undefined,
  );

const press = async (r: Renderer, label: string | RegExp) => {
  const node = pressables(r).find(n =>
    typeof label === 'string'
      ? n.props.accessibilityLabel === label
      : label.test(n.props.accessibilityLabel),
  );
  if (!node) {
    throw new Error(`No pressable labelled ${label}`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

const markerLabels = (r: Renderer) => [
  ...new Set(
    pressables(r)
      .map(n => n.props.accessibilityLabel as string)
      .filter(l => /chargers available$/.test(l)),
  ),
];

const pressText = async (r: Renderer, text: string) => {
  let target: ReactTestRenderer.ReactTestInstance | null =
    home(r)
      .findAllByType(Text)
      .find(n => n.props.children === text) ?? null;
  while (target && !target.props.onPress) {
    target = target.parent;
  }
  await act(async () => {
    target!.props.onPress();
  });
  await flush();
};

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  seedSignedIn();
  getCurrentPosition.mockReset();
  getCurrentPosition.mockImplementation(success => success({coords: USER}));
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('layout and data', () => {
  test('keeps the approved header, search and filter chips', async () => {
    const r = await renderHome();
    const t = textsOf(r);
    expect(t).toContain('Find a Charger');
    ['All', 'Fast', 'Available', 'Near me'].forEach(f =>
      expect(t).toContain(f),
    );
    expect(r.root.findAllByType(TextInput).length).toBeGreaterThan(0);
  });

  test('shows the vehicle chip with battery, and opens the best charger', async () => {
    const r = await renderHome();
    const t = textsOf(r);
    expect(t).toContain('Tata Nexon EV');
    expect(t).toContain('60%');
    expect(t).toContain('Best nearby');
    expect(markerLabels(r).length).toBeGreaterThan(3);
  });

  test('only shows chargers compatible with the active vehicle', async () => {
    const leaf = {...VEHICLE_CATALOG[9], id: 'veh-leaf'};
    appStore.set({vehicles: [leaf], activeVehicleId: leaf.id});
    const rLeaf = await renderHome();
    const leafMarkers = markerLabels(rLeaf);
    expect(leafMarkers.length).toBeGreaterThan(0);

    seedSignedIn();
    const rNexon = await renderHome();
    expect(markerLabels(rNexon)).not.toEqual(leafMarkers);
  });

  test('status is labelled with how trustworthy it is and when it updated', async () => {
    const r = await renderHome();
    const joined = textsOf(r).join(' ');
    expect(joined).toMatch(/(LIVE|Estimated|User-confirmed|Unknown)/);
    expect(joined).toMatch(/(sec ago|min ago|never updated|updated)/);
  });
});

describe('filters', () => {
  test('Available drops a charger with no free compatible bay', async () => {
    const r = await renderHome();
    const before = markerLabels(r);
    await pressText(r, 'Available');
    const after = markerLabels(r);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every(l => !/ 0 of \d+ chargers available$/.test(l))).toBe(
      true,
    );
  });

  test('Fast keeps only 50 kW and above, Near me keeps the close ones', async () => {
    const r = await renderHome();
    const all = markerLabels(r).length;
    await pressText(r, 'Fast');
    expect(markerLabels(r).length).toBeLessThan(all);
    await pressText(r, 'Near me');
    expect(markerLabels(r).length).toBeLessThan(all);
  });

  test('search narrows by name and address', async () => {
    const r = await renderHome();
    const input = home(r).findByType(TextInput);
    await act(async () => input.props.onChangeText('karol'));
    expect(markerLabels(r).length).toBeLessThanOrEqual(1);
    await act(async () => input.props.onChangeText('zzz'));
    expect(markerLabels(r)).toHaveLength(0);
    expect(textsOf(r)).toContain('No chargers match your filters');
  });

  test('presenter "no compatible" shows an honest empty state', async () => {
    demoStore.set({noCompatible: true});
    const r = await renderHome();
    expect(textsOf(r)).toContain('No compatible chargers found nearby');
  });
});

describe('navigation from Home', () => {
  test('Directions opens the navigation hand-off for that station', async () => {
    const r = await renderHome();
    await press(r, 'Directions');
    expect(probe.current).toBe('Navigation');
  });

  test('tapping the card opens station details', async () => {
    const r = await renderHome();
    await press(r, /^View /);
    expect(probe.current).toBe('StationDetail');
  });

  test('filters, notifications and list shortcuts', async () => {
    let r = await renderHome();
    await press(r, 'Filters');
    expect(probe.current).toBe('Filters');
    await act(async () => r.unmount());

    seedSignedIn();
    r = await renderHome();
    await press(r, /^Notifications/);
    expect(probe.current).toBe('Notifications');
    await act(async () => r.unmount());

    seedSignedIn();
    r = await renderHome();
    await press(r, 'Close details');
    await press(r, /View list of/);
    expect(probe.current).toBe('StationList');
  });
});

describe('location and search', () => {
  const stationService = createStationService();

  test('searches around the device location', async () => {
    const nearby = jest.fn(stationService.nearby);
    await renderHome({station: {...stationService, nearby}});
    expect(nearby.mock.calls[0][0].origin).toEqual(USER);
  });

  test('denied location still works, around the default centre, with a retry', async () => {
    getCurrentPosition.mockImplementationOnce((_ok, fail) =>
      fail({code: 1, message: 'denied'}),
    );
    const nearby = jest.fn(stationService.nearby);
    const r = await renderHome({station: {...stationService, nearby}});
    expect(nearby.mock.calls[0][0].origin).toEqual(DEFAULT_CENTER);
    expect(textsOf(r)).toContain(
      'Location is off. Showing chargers near New Delhi.',
    );

    await press(r, 'Try again');
    expect(textsOf(r)).not.toContain(
      'Location is off. Showing chargers near New Delhi.',
    );
  });

  test('presenter location-denied switch behaves the same', async () => {
    demoStore.set({locationDenied: true});
    const r = await renderHome();
    expect(textsOf(r)).toContain(
      'Location is off. Showing chargers near New Delhi.',
    );
  });

  test('a failed search keeps the screen usable and Retry recovers', async () => {
    const nearby = jest
      .fn(stationService.nearby)
      .mockRejectedValueOnce(new Error('Places API (New) is disabled'));
    const r = await renderHome({station: {...stationService, nearby}});
    expect(textsOf(r)).toContain('Places API (New) is disabled');
    await press(r, 'Try again');
    expect(textsOf(r)).not.toContain('Places API (New) is disabled');
    expect(markerLabels(r).length).toBeGreaterThan(0);
  });

  test('offline is explained in plain words', async () => {
    const nearby = jest.fn().mockRejectedValue(new OfflineError());
    const r = await renderHome({station: {...stationService, nearby}});
    expect(textsOf(r)).toContain(
      'You’re offline. Showing the last chargers we found.',
    );
  });

  test('"Search this area" appears after a real pan and searches there', async () => {
    const nearby = jest.fn(stationService.nearby);
    const r = await renderHome({station: {...stationService, nearby}});
    const map = home(r).find(
      n =>
        n.props.initialRegion !== undefined && n.props.onRegionChangeComplete,
    );
    const region = (lat: number) => ({
      latitude: lat,
      longitude: USER.longitude,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    });

    await act(async () =>
      map.props.onRegionChangeComplete(region(USER.latitude + 0.5), {
        isGesture: false,
      }),
    );
    await act(async () =>
      map.props.onRegionChangeComplete(region(USER.latitude + 0.001), {
        isGesture: true,
      }),
    );
    expect(textsOf(r)).not.toContain('Search this area');

    await act(async () =>
      map.props.onRegionChangeComplete(region(USER.latitude + 0.5), {
        isGesture: true,
      }),
    );
    expect(textsOf(r)).toContain('Search this area');
    await pressText(r, 'Search this area');
    expect(nearby).toHaveBeenCalledTimes(2);
    expect(nearby.mock.calls[1][0].origin.latitude).toBeCloseTo(
      USER.latitude + 0.5,
    );
  });

  test('a slow, superseded search cannot overwrite newer results', async () => {
    getCurrentPosition.mockImplementationOnce((_ok, fail) =>
      fail({code: 1, message: 'denied'}),
    );
    const pending = stationService.nearby({origin: USER, vehicle: NEXON});
    await flush();
    const all = await pending;
    let resolveFirst!: (v: typeof all) => void;
    const nearby = jest
      .fn()
      .mockImplementationOnce(() => new Promise(res => (resolveFirst = res)))
      .mockResolvedValueOnce(all.slice(0, 1));
    const r = await renderHome({station: {...stationService, nearby}});

    await press(r, 'Go to my location');
    expect(markerLabels(r)).toHaveLength(1);
    await act(async () => resolveFirst(all.slice(0, 5)));
    await flush();
    expect(markerLabels(r)).toHaveLength(1);
  });
});
