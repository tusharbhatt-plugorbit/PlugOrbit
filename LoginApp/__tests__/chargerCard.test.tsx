/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {StyleSheet, Text} from 'react-native';
import {DEFAULT_CENTER} from '../src/config/google';
import type {StationWithDistance} from '../src/domain/types';
import {NEXON, TestApp, seedSignedIn} from '../src/dev/testHarness';
import {createMockServices} from '../src/services';
import {createStationService} from '../src/services/mock/stationService';
import {cacheRoute} from '../src/store/tripActions';
import {ChargerCard, MapChargerCard, PrimaryButton} from '../src/ui';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

async function render(node: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r);
  return r;
}

// Text with nested <Text> (a value and its unit) reads as one string.
const flat = (node: ReactTestRenderer.ReactTestInstance): string =>
  node.children.map(c => (typeof c === 'string' ? c : flat(c))).join('');

const texts = (r: Renderer) => r.root.findAllByType(Text).map(flat);

async function aStation(): Promise<StationWithDistance> {
  const [first] = await createStationService().nearby({
    origin: DEFAULT_CENTER,
    vehicle: NEXON,
  });
  return {...first, distanceKm: 2.3, detourMin: 4, reliabilityPct: 86};
}

const NOW = Date.now();

describe('charger card shows what a driver scans', () => {
  test('list card: name, availability, distance, speed, price, reliability', async () => {
    const station = await aStation();
    const r = await render(
      <ChargerCard station={station} vehicle={NEXON} now={NOW} />,
    );
    const t = texts(r);
    expect(t).toContain(station.name);
    expect(t).toContain('2.3 km');
    expect(t.some(x => /^\d+ of \d+ free$/.test(x))).toBe(true);
    expect(t.some(x => /^\d+ kW$/.test(x))).toBe(true);
    expect(t.some(x => /^₹[\d.]+\/kWh$/.test(x))).toBe(true);
    expect(t).toContain('86%');
    expect(t).toContain('Reliable');
    // The plug the speed is on, e.g. "CCS2 / Type2".
    expect(t.some(x => /CCS2/.test(x))).toBe(true);
  });

  test('map card has the same facts and one clear action', async () => {
    const station = await aStation();
    const onDirections = jest.fn();
    const r = await render(
      <MapChargerCard
        station={station}
        vehicle={NEXON}
        now={NOW}
        bottom={16}
        best
        onClose={() => {}}
        onDetails={() => {}}
        onDirections={onDirections}
      />,
    );
    const t = texts(r);
    expect(t).toContain('Best nearby');
    expect(t).toContain('2.3 km');
    expect(t).toContain('Reliable');
    expect(t).toContain('Directions');
    await act(async () =>
      r.root
        .find(
          n =>
            n.props.accessibilityLabel === 'Directions' &&
            typeof n.props.onPress === 'function',
        )
        .props.onPress(),
    );
    expect(onDirections).toHaveBeenCalledTimes(1);
  });

  test('reliability is left out when nobody has measured it', async () => {
    const station = {...(await aStation()), reliabilityPct: 0};
    const r = await render(
      <ChargerCard station={station} vehicle={NEXON} now={NOW} />,
    );
    expect(texts(r)).not.toContain('Reliable');
    expect(texts(r).some(x => /^0%$/.test(x))).toBe(false);
  });

  test('a charger with unconfirmed plugs shows no invented numbers', async () => {
    const station = {
      ...(await aStation()),
      connectors: [],
      reliabilityPct: 0,
    };
    const r = await render(
      <ChargerCard station={station} vehicle={NEXON} now={NOW} />,
    );
    const t = texts(r);
    expect(t).toContain('Connector type unconfirmed');
    expect(t.some(x => /kW$/.test(x))).toBe(false);
    expect(t.some(x => /free$/.test(x))).toBe(false);
  });

  test('data quality is spelled out, never passed off as live', async () => {
    const station = await aStation();
    const estimated = {
      ...station,
      statusFeed: {
        source: 'google_places' as const,
        updatedAt: NOW - 3_600_000,
      },
    };
    const r = await render(
      <ChargerCard station={estimated} vehicle={NEXON} now={NOW} />,
    );
    const t = texts(r).join(' ');
    expect(t).toContain('Estimated');
    expect(t).not.toMatch(/LIVE/);
  });
});

describe('PrimaryButton sizes', () => {
  const heightOf = (r: Renderer) =>
    StyleSheet.flatten(
      r.root.findAll(
        n =>
          n.props.accessibilityRole === 'button' &&
          n.type === ('View' as never),
      )[0].props.style,
    ).height;

  test('large is 64 high, default 54, compact 44', async () => {
    expect(heightOf(await render(<PrimaryButton label="Go" large />))).toBe(64);
    expect(heightOf(await render(<PrimaryButton label="Go" />))).toBe(54);
    expect(heightOf(await render(<PrimaryButton label="Go" compact />))).toBe(
      44,
    );
  });

  test('disabled looks disabled and ignores taps', async () => {
    const onPress = jest.fn();
    const r = await render(
      <PrimaryButton label="Go" disabled onPress={onPress} />,
    );
    const node = r.root.findAll(
      n =>
        n.props.accessibilityRole === 'button' && n.type === ('View' as never),
    )[0];
    expect(StyleSheet.flatten(node.props.style).opacity).toBeLessThan(0.6);
    expect(node.props.accessibilityState).toMatchObject({disabled: true});
    expect(node.props.onPress).toBeUndefined();
  });
});

describe('Energy plan main action', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  test('"Use this plan" is the large primary button', async () => {
    seedSignedIn();
    const pending = createMockServices().route.plan({
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
      startSoc: 60,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    cacheRoute(await pending);

    const r = await render(<TestApp stack={[{name: 'EnergyPlanner'}]} />);
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        jest.advanceTimersByTime(60);
      });
    }
    const button = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Use this plan' &&
        n.type === ('View' as never),
    )[0];
    const style = StyleSheet.flatten(button.props.style);
    expect(style.height).toBeGreaterThanOrEqual(64);
  });
});
