/**
 * @format
 *
 * Navigation hand-off and the Backup alert, end to end: the alert is about the
 * charger you are heading to, "Switch to backup" lands on the backup shown, and
 * the presenter's "occupied" switch doesn't trap you in a loop.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {TestApp, probe, seedSignedIn, NEXON} from '../src/dev/testHarness';
import {createMockServices} from '../src/services';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';
import {cacheRoute} from '../src/store/tripActions';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      jest.advanceTimersByTime(80);
    });
  }
};

const mounted: Renderer[] = [];

async function open(
  stack: React.ComponentProps<typeof TestApp>['stack'],
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<TestApp stack={stack} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

function focusedHost(r: Renderer) {
  return r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];
}

const texts = (r: Renderer) =>
  focusedHost(r)
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const labels = (r: Renderer) =>
  focusedHost(r)
    .findAll(n => typeof n.props.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

/** Plans a Nexon trip; the mock's latency timer needs the fake clock nudged. */
async function planTrip(fromLabel: string, toLabel: string, startSoc: number) {
  const pending = createMockServices().route.plan({
    fromLabel,
    toLabel,
    startSoc,
    strategy: 'reliable',
    vehicle: NEXON,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });
  await settle();
  return pending;
}

async function press(r: Renderer, label: string) {
  const node = focusedHost(r)
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityLabel === label,
    )
    .pop();
  if (!node) {
    throw new Error(`No pressable "${label}" on ${probe.current}`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await settle();
}

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  seedSignedIn();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('Directions to an unknown-status charger says Status unknown, and offers a backup', async () => {
  const r = await open([
    {name: 'Navigation', params: {stationId: 'st-zeon-karolbagh'}},
  ]);
  expect(probe.current).toBe('Navigation');
  const all = texts(r).join(' | ');
  expect(all).toMatch(/Status unknown \(never updated\)/);
  expect(all).not.toMatch(/occupied/i);
  // Not opened from a route stop, yet the nearest compatible alternative shows.
  expect(labels(r).some(l => /^Backup: .+, plus \d+ minutes$/.test(l))).toBe(
    true,
  );
});

test('Directions to a busy charger opens an alert about THAT charger, and switches to its own alternative', async () => {
  const r = await open([
    {name: 'Navigation', params: {stationId: 'st-tata-citymall'}},
  ]);
  expect(probe.current).toBe('BackupAlert');
  const all = texts(r).join(' | ');
  expect(all).toMatch(/Tata Power • City Mall/);
  expect(all).not.toMatch(/Neemrana/);
  expect(all).not.toMatch(/just filled up/);
  expect(
    labels(r).some(l => l.startsWith('Switch to: Tata Power • Gurgaon')),
  ).toBe(true);

  await press(r, 'Switch to backup');
  expect(probe.current).toBe('Navigation');
  expect(texts(r).join(' | ')).toMatch(/Tata Power • Gurgaon/);
  // The user's saved trip was not touched by an unrelated busy station.
  expect(appStore.get().activeRoute).toBeNull();
});

test('presenter "occupied" then Switch to backup lands on the backup and stays there', async () => {
  const route = await planTrip('Delhi', 'Jaipur', 60);
  cacheRoute(route, 0);
  const shown = route.stops[0].backup;
  expect(shown?.name).toBe('Statiq • Highway Hub');
  demoStore.set({stationOccupied: true});

  const r = await open([{name: 'BackupAlert'}]);
  expect(probe.current).toBe('BackupAlert');
  expect(texts(r).join(' | ')).toMatch(/ChargeZone • Neemrana/);
  expect(
    labels(r).some(l => l.startsWith('Switch to: Statiq • Highway Hub')),
  ).toBe(true);

  await press(r, 'Switch to backup');
  // Exactly the backup that was shown, and no bounce back to the alert.
  expect(probe.current).toBe('Navigation');
  expect(appStore.get().chosen?.stationId).toBe(shown?.id);
  expect(appStore.get().activeRoute?.stops[0].station.id).toBe(shown?.id);
  await settle();
  expect(probe.current).toBe('Navigation');
  expect(texts(r).join(' | ')).toMatch(/Statiq • Highway Hub/);
  // The new stop has its own backup.
  expect(labels(r).some(l => /^Backup: .+, plus \d+ minutes$/.test(l))).toBe(
    true,
  );
});

test('a route stop with no backup shows an explicit warning on the route result', async () => {
  const route = await planTrip('Jaipur', 'Delhi', 42);
  expect(route.stops.some(s => !s.backup)).toBe(true);
  cacheRoute(route, 0);
  const r = await open([{name: 'RouteResult'}]);
  expect(texts(r).join(' | ')).toMatch(/No backup for this stop/);
});
