/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState, Linking, Platform, Text, TextInput} from 'react-native';
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
const LOCATION_BODY =
  'Enable location permission to find EV chargers near you.';

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

const mounted: Renderer[] = [];

// The map used to be Home; it is now its own screen, opened from Home.
async function renderHome(services?: Partial<Services>): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TestApp stack={[{name: 'Map'}]} services={services} />,
    );
  });
  mounted.push(renderer);
  await flush();
  return renderer;
}

const home = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' && n.props.testID === 'screen-Map-1',
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
  (globalThis as unknown as {__MAP_NEVER_READY?: boolean}).__MAP_NEVER_READY =
    false;
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
    expect(textsOf(r)).toContain('Location access needed');
    expect(textsOf(r)).toContain(LOCATION_BODY);

    await press(r, 'Allow location');
    expect(textsOf(r)).not.toContain('Location access needed');
    expect(nearby.mock.calls.at(-1)?.[0].origin).toEqual(USER);
  });

  test('presenter location-denied switch behaves the same', async () => {
    demoStore.set({locationDenied: true});
    const r = await renderHome();
    expect(textsOf(r)).toContain('Location access needed');
    // Still usable: chargers around the default centre are on the map.
    expect(markerLabels(r).length).toBeGreaterThan(0);
  });

  test('denied location offers Settings, and the card can be set aside', async () => {
    demoStore.set({locationDenied: true});
    const openSettings = jest.spyOn(Linking, 'openSettings');
    openSettings.mockResolvedValue(undefined);
    const r = await renderHome();

    // Jest runs as iOS, which never asks twice: Settings leads.
    await press(r, 'Open settings');
    expect(openSettings).toHaveBeenCalledTimes(1);

    await press(r, 'Dismiss');
    expect(textsOf(r)).not.toContain('Location access needed');
    // The short notice stays, with its own retry.
    expect(textsOf(r)).toContain(
      'Location is off. Showing chargers near New Delhi.',
    );
    expect(textsOf(r)).toContain('Retry');
    openSettings.mockRestore();
  });

  test('location services being off gets its own wording', async () => {
    getCurrentPosition.mockImplementation((_ok, fail) =>
      fail({code: 2, message: 'unavailable'}),
    );
    const r = await renderHome();
    expect(textsOf(r)).toContain('Location is turned off');
    expect(textsOf(r)).toContain('Try again');
    expect(textsOf(r)).not.toContain('Allow location');
  });

  test('no position in time is not called "turned off", and Settings is not offered', async () => {
    getCurrentPosition.mockImplementation((_ok, fail) =>
      fail({code: 3, message: 'timeout'}),
    );
    const r = await renderHome();
    expect(textsOf(r)).toContain('Couldn’t find your location');
    expect(textsOf(r)).not.toContain('Location is turned off');
    expect(
      pressables(r).some(n => n.props.accessibilityLabel === 'Settings'),
    ).toBe(false);
    expect(textsOf(r)).toContain('Try again');
  });

  test('services off puts Settings first, and returning from Settings looks again', async () => {
    getCurrentPosition.mockImplementation((_ok, fail) =>
      fail({code: 2, message: 'unavailable'}),
    );
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);
    let appStateListener: ((s: string) => void) | undefined;
    const sub = {remove: jest.fn()};
    const addListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_: string, cb: (s: string) => void) => {
        appStateListener = cb;
        return sub;
      }) as never);
    const r = await renderHome();
    expect(textsOf(r)).toContain('Open settings');

    const callsBefore = getCurrentPosition.mock.calls.length;
    // Coming back without having gone to Settings does nothing (no prompt loop).
    await act(async () => appStateListener?.('active'));
    expect(getCurrentPosition.mock.calls.length).toBe(callsBefore);

    await press(r, 'Open settings');
    expect(openSettings).toHaveBeenCalledTimes(1);
    getCurrentPosition.mockImplementation(success => success({coords: USER}));
    await act(async () => appStateListener?.('active'));
    await flush();
    expect(getCurrentPosition.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(textsOf(r)).not.toContain('Location is turned off');

    // Hand back the shared stub (jest.setup.js) for the tests that follow.
    addListener.mockImplementation((() => ({remove: jest.fn()})) as never);
    openSettings.mockRestore();
  });

  test('on Android the first refusal can still be retried; after one, Settings leads', async () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    demoStore.set({locationDenied: true});
    const r = await renderHome();
    expect(textsOf(r)).toContain('Allow location');
    expect(textsOf(r)).not.toContain('Open settings');

    await press(r, 'Allow location');
    expect(textsOf(r)).toContain('Open settings');
    Platform.OS = os;
  });

  test('the list shortcut and charger card step aside while the location card is up', async () => {
    demoStore.set({locationDenied: true});
    const r = await renderHome();
    const hasPill = () =>
      pressables(r).some(n => /View list of/.test(n.props.accessibilityLabel));
    expect(hasPill()).toBe(false);
    expect(textsOf(r)).not.toContain('Directions');

    await press(r, 'Dismiss');
    expect(textsOf(r)).toContain('Directions');
    await press(r, 'Close details');
    expect(hasPill()).toBe(true);
  });

  test('a map that never starts is reported, and Reload remounts and re-arms it', async () => {
    const g = globalThis as unknown as {
      __MAP_NEVER_READY?: boolean;
      __MAP_MOUNTS?: number;
    };
    g.__MAP_NEVER_READY = true;
    g.__MAP_MOUNTS = 0;
    const r = await renderHome();
    expect(textsOf(r).join(' ')).not.toContain('taking too long');
    expect(g.__MAP_MOUNTS).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(textsOf(r).join(' ')).toContain('The map is taking too long');

    // Reload while the map still cannot start: a fresh map is mounted, the
    // warning goes away, and it comes back after another 15 seconds.
    await press(r, 'Reload map');
    expect(g.__MAP_MOUNTS).toBe(2);
    expect(textsOf(r).join(' ')).not.toContain('taking too long');
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(textsOf(r).join(' ')).toContain('The map is taking too long');

    // Reload when it can start: it is ready, and the warning stays away.
    g.__MAP_NEVER_READY = false;
    await press(r, 'Reload map');
    expect(g.__MAP_MOUNTS).toBe(3);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(textsOf(r).join(' ')).not.toContain('taking too long');
  });

  test('a healthy map never shows the load warning', async () => {
    const r = await renderHome();
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(textsOf(r).join(' ')).not.toContain('taking too long');
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
