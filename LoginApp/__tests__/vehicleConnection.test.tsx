/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {describeSocSource} from '../src/domain/socEstimate';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {createVehicleService} from '../src/services/mock/miscServices';
import {IntegrationUnavailableError} from '../src/services/types';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
  }
};

async function open(route: 'AutoSoc' | 'Home'): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      route === 'Home' ? (
        <TestApp tab="Home" />
      ) : (
        <TestApp tab="Profile" stack={[{name: 'AutoSoc'}]} />
      ),
    );
  });
  mounted.push(r);
  await flush();
  return r;
}

const texts = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const press = async (r: Renderer, label: string | RegExp) => {
  const node = r.root.find(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (typeof label === 'string'
        ? n.props.accessibilityLabel === label
        : label.test(n.props.accessibilityLabel)),
  );
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
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('the vehicle service', () => {
  test('without the demo switch it reports the integration is not available, and invents nothing', async () => {
    const before = appStore.get().battery;
    const service = createVehicleService();
    // Capture the outcome first: the rejection lands while the timers advance.
    const outcome = service.connectVehicle('oem').then(
      () => null,
      (e: unknown) => e,
    );
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(await outcome).toBeInstanceOf(IntegrationUnavailableError);
    expect(appStore.get().battery).toEqual(before);
    expect(appStore.get().vehicleLink.connected).toBe(false);
  });

  test('with the demo switch on, the link is flagged as simulated', async () => {
    demoStore.set({simulateVehicle: true});
    const service = createVehicleService();
    const attempt = service.connectVehicle('obd');
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await attempt;
    expect(appStore.get().vehicleLink).toEqual({
      connected: true,
      method: 'obd',
      simulated: true,
    });
  });
});

describe('how a reading is described', () => {
  const reading = {percent: 58, source: 'vehicle' as const, updatedAt: 0};

  test('a simulated link is never "from your car"', () => {
    const v = describeSocSource(
      {connected: true, simulated: true},
      reading,
      1000,
    );
    expect(v?.fromCar).toBe(false);
    expect(v?.label).toBe('Demo reading');
    expect(v?.detail).toMatch(/isn’t from a real car/);
  });

  test('a real connection still is', () => {
    expect(describeSocSource({connected: true}, reading, 1000)?.fromCar).toBe(
      true,
    );
  });
});

describe('the Connect your vehicle screen', () => {
  test('says it is not available yet and makes manual entry the way forward', async () => {
    const r = await open('AutoSoc');
    expect(texts(r)).toContain('Not available yet');
    expect(texts(r).some(t => /^Connect with /.test(t))).toBe(false);
    await press(r, 'Enter battery by hand');
    expect(probe.current).toBe('ManualSoc');
  });

  test('no connection method looks chosen while connecting is not possible', async () => {
    const r = await open('AutoSoc');
    const radios = r.root.findAll(n => n.props.accessibilityRole === 'radio');
    expect(radios.length).toBeGreaterThan(0);
    radios.forEach(n =>
      expect(n.props.accessibilityState).toMatchObject({selected: false}),
    );
  });

  test('with the demo on, connecting works and the reading is labelled a demo', async () => {
    demoStore.set({simulateVehicle: true});
    const r = await open('AutoSoc');
    expect(texts(r)).not.toContain('Not available yet');
    await press(r, /^Connect with /);
    expect(appStore.get().vehicleLink.simulated).toBe(true);
    expect(texts(r)).toContain('Demo reading');
    expect(texts(r)).not.toContain('Read from your car');
  });
});

describe('Home', () => {
  test('never calls a demo connection a car reading', async () => {
    appStore.set({
      battery: {percent: 58, source: 'vehicle', updatedAt: Date.now()},
      vehicleLink: {connected: true, method: 'oem', simulated: true},
    });
    const r = await open('Home');
    expect(texts(r)).toContain('Demo reading');
    expect(texts(r)).not.toContain('Read from your car');
  });
});
