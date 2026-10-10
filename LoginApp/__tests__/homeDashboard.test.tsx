/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {NEXON, TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {createStationService} from '../src/services/mock/stationService';
import type {Services} from '../src/services/types';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const USER = {latitude: 28.6139, longitude: 77.209};
const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

async function renderHome(services?: Partial<Services>): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<TestApp tab="Home" services={services} />);
  });
  mounted.push(r);
  await flush();
  return r;
}

const texts = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const pressable = (r: Renderer, label: string | RegExp) =>
  r.root.find(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (typeof label === 'string'
        ? n.props.accessibilityLabel === label
        : label.test(n.props.accessibilityLabel)),
  );

const press = async (r: Renderer, label: string | RegExp) => {
  const node = pressable(r, label);
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

beforeAll(() => {
  jest.useFakeTimers();
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  seedSignedIn();
  (Geolocation.getCurrentPosition as jest.Mock).mockReset();
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success =>
    success({coords: USER}),
  );
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('the car', () => {
  test('shows the vehicle, the battery and a range worked out from both', async () => {
    const r = await renderHome();
    const t = texts(r);
    expect(t).toContain('Tata Nexon EV');
    expect(
      r.root.findByProps({accessibilityLabel: 'Battery 60 percent'}),
    ).toBeTruthy();
    const range60 = t.find(x => /^~\d+ km$/.test(x))!;

    // Not a constant: a different battery gives a different range.
    appStore.set({
      battery: {percent: 30, source: 'manual', updatedAt: Date.now()},
    });
    await flush();
    const range30 = texts(r).find(x => /^~\d+ km$/.test(x))!;
    expect(parseInt(range30.slice(1), 10)).toBeLessThan(
      parseInt(range60.slice(1), 10),
    );
    expect(texts(r)).toContain('est. range');
  });

  test('says where the battery number came from and how old it is', async () => {
    const r = await renderHome();
    expect(texts(r)).toContain('Manual reading');
    expect(texts(r).some(x => /^Updated /.test(x))).toBe(true);
    expect(texts(r)).toContain('Car not connected');
  });

  test('only a connected car is called "Read from your car"', async () => {
    appStore.set({
      battery: {percent: 55, source: 'vehicle', updatedAt: Date.now()},
      vehicleLink: {connected: true, method: 'oem'},
    });
    const r = await renderHome();
    expect(texts(r)).toContain('Read from your car');
    expect(texts(r)).toContain('Car connected');

    // The same reading with the link down is not live any more.
    appStore.set({vehicleLink: {connected: false, method: null}});
    await flush();
    expect(texts(r)).not.toContain('Read from your car');
    expect(texts(r)).toContain('Last read from your car');
  });

  test('a trip estimate is not presented as a car or manual reading', async () => {
    appStore.set({
      battery: {percent: 48, source: 'trip_estimate', updatedAt: Date.now()},
    });
    const r = await renderHome();
    expect(texts(r)).toContain('Estimated on your trip');
  });

  test('with no car it asks for one, and that opens vehicle setup', async () => {
    appStore.set({vehicles: [], activeVehicleId: null, battery: null});
    const r = await renderHome();
    expect(texts(r)).toContain('Add your EV');
    await press(r, 'Add your EV');
    expect(probe.current).toBe('VehicleSetup');
  });

  test('with a car but no battery it asks for the level', async () => {
    appStore.set({battery: null});
    const r = await renderHome();
    expect(texts(r)).toContain('Set battery level');
    expect(texts(r).some(x => /^~\d+ km$/.test(x))).toBe(false);
    await press(r, 'Set battery level');
    expect(probe.current).toBe('ManualSoc');
  });

  test('Set battery and Connect car lead to their screens', async () => {
    let r = await renderHome();
    await press(r, 'Set battery');
    expect(probe.current).toBe('ManualSoc');
    await act(async () => r.unmount());
    seedSignedIn();
    r = await renderHome();
    await press(r, 'Connect car');
    expect(probe.current).toBe('AutoSoc');
  });

  test('a charging session shows on the car card and resumes from it', async () => {
    seedSignedIn({session: 'active'});
    const r = await renderHome();
    expect(texts(r)).toContain('Charging');
    await press(r, /^Charging at /);
    expect(probe.current).toBe('ActiveSession');
  });
});

describe('everything is one tap away', () => {
  const TILES: ReadonlyArray<[string, string]> = [
    ['Find chargers', 'Map'],
    ['Plan trip', 'RoutePlanner'],
    ['My vehicle', 'Vehicles'],
    ['Charging history', 'Activity'],
    ['Saved stations', 'Saved'],
    ['Orbit Assist', 'SmartDrive'],
  ];

  test.each(TILES)('"%s" opens %s', async (label, route) => {
    const r = await renderHome();
    await press(r, label);
    expect(probe.current).toBe(route);
  });

  test('the header reaches notifications, the profile and the map', async () => {
    let r = await renderHome();
    await press(r, /^Notifications/);
    expect(probe.current).toBe('Notifications');
    await act(async () => r.unmount());

    seedSignedIn();
    r = await renderHome();
    await press(r, 'Profile');
    expect(probe.current).toBe('Profile');
    await act(async () => r.unmount());

    seedSignedIn();
    r = await renderHome();
    await press(r, /^Location: /);
    expect(probe.current).toBe('Map');
  });

  test('"Plan my journey" hands the destination to Orbit Assist', async () => {
    const r = await renderHome();
    await press(r, 'Plan my journey');
    expect(probe.current).toBe('SmartDrive');
  });
});

describe('nearby charger', () => {
  test('shows the closest compatible charger and opens it', async () => {
    const r = await renderHome();
    expect(texts(r)).toContain('Nearby charger');
    await press(r, /kilometres/);
    expect(probe.current).toBe('StationDetail');
  });

  test('with location off it says so instead of guessing', async () => {
    demoStore.set({locationDenied: true});
    const r = await renderHome();
    expect(texts(r)).toContain('Location off');
    expect(texts(r)).toContain('Location is off');
    await press(r, 'Open the map');
    expect(probe.current).toBe('Map');
  });

  test('opening the map from Home reuses the chargers already found', async () => {
    const stationService = createStationService();
    const nearby = jest.fn(stationService.nearby);
    const r = await renderHome({station: {...stationService, nearby}});
    expect(nearby).toHaveBeenCalledTimes(1);
    await press(r, 'Find chargers');
    expect(probe.current).toBe('Map');
    // One search, not a second location fix and a second Places request.
    expect(nearby).toHaveBeenCalledTimes(1);
  });
});

describe('Orbit Assist and recent trips', () => {
  test('a finished trip can be planned again', async () => {
    appStore.set(s => ({
      smartDrive: {
        ...s.smartDrive,
        outcomes: [
          {
            tripId: 't1',
            endedAt: Date.now() - 3_600_000,
            vehicleId: NEXON.id,
            from: 'Delhi',
            to: 'Jaipur',
            plannedStationId: null,
            actualStationId: null,
            followedPlan: true,
            predicted: {
              arriveSoc: null,
              waitMinutes: null,
              chargeMinutes: null,
              targetSoc: null,
              costInr: null,
            },
            actual: {
              arriveSoc: null,
              waitMinutes: null,
              chargeMinutes: null,
              endSoc: null,
              costInr: null,
              startedOk: null,
            },
          } as never,
        ],
      },
    }));
    const r = await renderHome();
    expect(texts(r)).toContain('Recent trip');
    expect(texts(r)).toContain('Delhi → Jaipur');
    await press(r, /Plan this trip again/);
    expect(probe.current).toBe('SmartDrive');
  });

  test('Orbit Assist reports being off when it is switched off', async () => {
    appStore.set(s => ({
      smartDrive: {
        ...s.smartDrive,
        prefs: {...s.smartDrive.prefs, enabled: false},
      },
    }));
    const r = await renderHome();
    expect(texts(r)).toContain('Off');
    await press(r, 'Turn on');
    expect(probe.current).toBe('TripPreferences');
  });
});
