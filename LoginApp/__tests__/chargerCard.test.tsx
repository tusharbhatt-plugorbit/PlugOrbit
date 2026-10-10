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
    // Collapsed: what you need to decide, including how fresh the status is.
    let t = texts(r);
    expect(t).toContain('Best nearby');
    expect(t).toContain('2.3 km');
    expect(t).toContain('Directions');
    expect(t.some(x => /LIVE|Estimated|User-confirmed|Unknown/.test(x))).toBe(
      true,
    );
    expect(t).not.toContain('Reliable');
    // Expanded: the figures behind it.
    await act(async () =>
      r.root
        .find(
          n =>
            n.props.accessibilityLabel === 'Show more details' &&
            typeof n.props.onPress === 'function',
        )
        .props.onPress(),
    );
    t = texts(r);
    expect(t).toContain('Reliable');
    expect(t).toContain('View full details');
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

  test('unknown availability is never printed as "0 free"', async () => {
    const station = await aStation();
    const unknown = {
      ...station,
      connectors: station.connectors.map(c => ({
        ...c,
        status: 'unknown' as const,
      })),
    };
    for (const node of [
      <ChargerCard station={unknown} vehicle={NEXON} now={NOW} />,
      <MapChargerCard
        station={unknown}
        vehicle={NEXON}
        now={NOW}
        bottom={16}
        onClose={() => {}}
        onDetails={() => {}}
        onDirections={() => {}}
      />,
    ]) {
      const r = await render(node);
      expect(texts(r).some(x => /\bfree$/.test(x))).toBe(false);
      expect(texts(r)).toContain('UNKNOWN');
    }
    const label = (
      await render(<ChargerCard station={unknown} vehicle={NEXON} now={NOW} />)
    ).root.find(
      n =>
        typeof n.props.accessibilityLabel === 'string' &&
        /kilometres/.test(n.props.accessibilityLabel),
    ).props.accessibilityLabel;
    expect(label).toContain('availability unknown');
    expect(label).not.toMatch(/0 bays free/);
  });

  test('a charger with no plug this car can use says nothing about free bays', async () => {
    const station = await aStation();
    const incompatible = {
      ...station,
      connectors: station.connectors.map(c => ({
        ...c,
        type: 'CHAdeMO' as const,
      })),
    };
    const r = await render(
      <ChargerCard station={incompatible} vehicle={NEXON} now={NOW} />,
    );
    expect(texts(r).some(x => /free$/.test(x))).toBe(false);
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
  // Buttons set minHeight, not height, so larger system text can grow them
  // instead of clipping the label (see Buttons.tsx).
  const heightOf = (r: Renderer) =>
    StyleSheet.flatten(
      r.root.findAll(
        n =>
          n.props.accessibilityRole === 'button' &&
          n.type === ('View' as never),
      )[0].props.style,
    ).minHeight;

  test('large is 64 high, default 54, compact 44', async () => {
    expect(heightOf(await render(<PrimaryButton label="Go" large />))).toBe(64);
    expect(heightOf(await render(<PrimaryButton label="Go" />))).toBe(54);
    expect(heightOf(await render(<PrimaryButton label="Go" compact />))).toBe(
      44,
    );
  });

  const composite = (r: Renderer) =>
    r.root.find(
      n =>
        n.props.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function',
    );

  test('an enabled button fires, a disabled or loading one does not', async () => {
    const onPress = jest.fn();
    const enabled = await render(
      <PrimaryButton label="Go" onPress={onPress} />,
    );
    await act(async () => composite(enabled).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);

    for (const props of [{disabled: true}, {loading: true}]) {
      onPress.mockClear();
      const r = await render(
        <PrimaryButton label="Go" onPress={onPress} {...props} />,
      );
      const node = r.root.find(n => n.props.accessibilityRole === 'button');
      expect(node.props.onPress).toBeUndefined();
      expect(onPress).not.toHaveBeenCalled();
    }
  });

  test('disabled looks disabled', async () => {
    const r = await render(<PrimaryButton label="Go" disabled />);
    const host = r.root.findAll(
      n =>
        n.props.accessibilityRole === 'button' && n.type === ('View' as never),
    )[0];
    expect(StyleSheet.flatten(host.props.style).opacity).toBeLessThan(0.6);
    expect(host.props.accessibilityState).toMatchObject({disabled: true});
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
    expect(style.minHeight).toBeGreaterThanOrEqual(64);
  });
});
