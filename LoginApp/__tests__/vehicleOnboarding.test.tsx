/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {appStore} from '../src/store/appStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  }
};

async function openBattery(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <TestApp stack={[{name: 'ManualSoc', params: {onboarding: true}}]} />,
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
  appStore.set({battery: null});
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('setting up a new car', () => {
  test('the battery step is step 2 of 3 and leads to an optional third step', async () => {
    const r = await openBattery();
    expect(texts(r).some(t => /^Step 2 of 3/.test(t))).toBe(true);
    await press(r, 'Continue');
    expect(probe.current).toBe('TripPreferences');
    expect(texts(r).some(t => /^Step 3 of 3, optional/.test(t))).toBe(true);
    // The battery from step 2 was kept.
    expect(appStore.get().battery).not.toBeNull();
  });

  test('skipping the third step goes to Home and changes nothing', async () => {
    const r = await openBattery();
    const before = appStore.get().tripPrefs;
    await press(r, 'Continue');
    await press(r, 'Skip for now');
    expect(probe.current).toBe('Home');
    expect(appStore.get().tripPrefs).toEqual(before);
  });

  test('finishing without changes goes to Home', async () => {
    const r = await openBattery();
    await press(r, 'Continue');
    await press(r, 'Finish');
    expect(probe.current).toBe('Home');
  });

  test('a changed preference is really saved by Save and finish', async () => {
    const r = await openBattery();
    await press(r, 'Continue');
    const reserve = appStore.get().tripPrefs.minArrivalSocPct;
    await press(r, /^Increase minimum arrival battery/);
    await press(r, 'Save and finish');
    expect(probe.current).toBe('Home');
    expect(appStore.get().tripPrefs.minArrivalSocPct).toBeGreaterThan(reserve);
  });

  test('connecting the car is shown as not available, not offered as if it works', async () => {
    const r = await openBattery();
    await press(r, 'Continue');
    expect(
      texts(r).some(t => /^Not available yet\. For now you enter/.test(t)),
    ).toBe(true);
    await press(r, /^Connect your car/);
    expect(probe.current).toBe('AutoSoc');
  });

  test('outside setup, Trip preferences is unchanged: no steps, no skip', async () => {
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <TestApp stack={[{name: 'TripPreferences'}]} />,
      );
    });
    mounted.push(r);
    await flush();
    expect(texts(r).some(t => /Step 3 of 3/.test(t))).toBe(false);
    expect(texts(r)).not.toContain('Skip for now');
    expect(texts(r)).toContain('Done');
  });
});
