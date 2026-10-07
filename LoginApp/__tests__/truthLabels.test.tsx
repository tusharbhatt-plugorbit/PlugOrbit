/**
 * @format
 *
 * What the screens print about trust: LIVE only for a live feed, a confidence
 * label on every wait, an age on every price, and Google chargers that open.
 */

jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  googleApiKey: 'test-key',
  hasGoogleApiKey: true,
}));
jest.mock('../src/services/places', () => ({
  ...jest.requireActual('../src/services/places'),
  fetchNearbyChargers: jest.fn(),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {NEXON, TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import type {Route} from '../src/domain/types';
import {createMockServices} from '../src/services';
import {
  loadStations,
  withDistanceTo,
} from '../src/services/mock/stationService';
import {clearPlacesCache} from '../src/services/mock/stationService';
import type {Charger} from '../src/services/places';
import {fetchNearbyChargers} from '../src/services/places';
import {appStore} from '../src/store/appStore';
import {BackupChargerCard} from '../src/ui';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const DELHI = {latitude: 28.6139, longitude: 77.209};
const fetchMock = fetchNearbyChargers as jest.Mock;

const hub: Charger = {
  id: 'ChIJabc',
  name: 'Mall EV Hub',
  address: '1 Mall Rd',
  latitude: DELHI.latitude + 0.01,
  longitude: DELHI.longitude,
  powerKw: 60,
  available: 1,
  total: 2,
  hours: 'Open now',
  pricePerKwh: null,
  availabilityUpdatedAt: Date.now() - 4 * 60_000,
  connectors: [
    {type: 'CCS2', powerKw: 60, count: 2, available: 1, outOfService: 0},
  ],
};
const noData: Charger = {
  ...hub,
  id: 'ChIJnodata',
  name: 'No Data Point',
  available: null,
  total: null,
  availabilityUpdatedAt: null,
  connectors: [],
};

let plan: Route;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(80);
    });
  }
};

const mounted: Renderer[] = [];

async function open(
  name: string,
  params?: unknown,
  seed: () => void = () => undefined,
): Promise<Renderer> {
  seedSignedIn();
  seed();
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <TestApp stack={[{name: name as never, params}]} services={undefined} />,
    );
  });
  mounted.push(r);
  await settle();
  return r;
}

const focusedHost = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];

/** The text on the screen in front (kept-alive screens underneath are hidden). */
const texts = (r: Renderer) =>
  (focusedHost(r) ?? r.root)
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

async function press(r: Renderer, label: string) {
  const node = (focusedHost(r) ?? r.root).findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === label,
  )[0];
  if (!node) {
    throw new Error(`No pressable "${label}" on ${probe.current}`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await settle();
}

beforeAll(async () => {
  plan = await createMockServices().route.plan({
    fromLabel: 'Delhi',
    toLabel: 'Jaipur',
    startSoc: 60,
    strategy: 'reliable',
    vehicle: NEXON,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });
  jest.useFakeTimers();
});

beforeEach(() => {
  clearPlacesCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('Expected availability only says "Live now" for a live feed', () => {
  test('a live operator feed', async () => {
    const r = await open('Forecast', {stationId: 'st-chargezone-manesar'});
    expect(texts(r).join('|')).toMatch(/Live now: \d of \d free/);
  });

  test('a driver report says when it was reported, not "live"', async () => {
    const r = await open('Forecast', {stationId: 'st-eesl-greenpark'});
    const t = texts(r).join('|');
    expect(t).not.toMatch(/Live now/);
    expect(t).toMatch(/Last reported 18 min ago: 1 of 2 free/);
  });

  test('Google’s estimate is not live either', async () => {
    const r = await open('Forecast', {stationId: 'st-jiobp-lodhi'});
    const t = texts(r).join('|');
    expect(t).not.toMatch(/Live now/);
    expect(t).toMatch(/Last reported/);
  });

  test('no status at all is "unknown", never "0 free"', async () => {
    const r = await open('Forecast', {stationId: 'st-zeon-karolbagh'});
    const t = texts(r).join('|');
    expect(t).toContain('Status unknown');
    expect(t).not.toMatch(/0 of 2 free|Live now/);
  });
});

describe('the route result', () => {
  const seed = () => appStore.set({activeRoute: plan});

  test('every stop shows its wait as a range with a confidence label', async () => {
    const r = await open('RouteResult', undefined, seed);
    const t = texts(r);
    expect(plan.stops.length).toBeGreaterThan(0);
    const confidence = t.filter(x => /^(Low|Medium|High) confidence$/.test(x));
    expect(confidence.length).toBeGreaterThanOrEqual(plan.stops.length);
    // "No wait expected" only ever sits beside a live status badge.
    if (t.some(x => /No wait expected/.test(x))) {
      expect(t.some(x => x.startsWith('LIVE'))).toBe(true);
    }
  });

  test('stop costs and backups say how old their price is', async () => {
    const r = await open('RouteResult', undefined, seed);
    const ages = texts(r).filter(x =>
      /^Price( \(.+\))?,? ?(updated|never)|^Price not published/.test(x),
    );
    // One line per priced stop, one per backup.
    expect(ages.length).toBeGreaterThanOrEqual(plan.stops.length);
  });
});

describe('a backup charger card dates its price', () => {
  test('a price from a feed an hour old is estimated, not fresh', async () => {
    const station = withDistanceTo(
      loadStations().find(s => s.id === 'st-tata-cp')!,
      DELHI,
    );
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <BackupChargerCard
          station={station}
          vehicle={NEXON}
          now={Date.now()}
          extraMin={6}
        />,
      );
    });
    const t = r.root
      .findAllByType(Text)
      .map(n => ([] as unknown[]).concat(n.props.children).join(''))
      .join('|');
    // The status is live, the price is not: the card says so for each.
    expect(t).toMatch(/LIVE/);
    expect(t).toMatch(/Price \(estimated\), updated 1 h ago/);
    await act(async () => r.unmount());
  });
});

describe('Google chargers open like any other', () => {
  // The mock service waits on a (zero) timer, which fake timers would hold.
  const list = async () => {
    jest.useRealTimers();
    try {
      await createMockServices().station.nearby({
        origin: DELHI,
        vehicle: NEXON,
        includeIncompatible: true,
      });
    } finally {
      jest.useFakeTimers();
    }
  };

  test('Details shows the charger Google returned, with no invented rating', async () => {
    fetchMock.mockResolvedValue([hub]);
    await list();
    const r = await open('StationDetail', {stationId: 'g-ChIJabc'});
    const t = texts(r).join('|');
    expect(t).toContain('Mall EV Hub');
    expect(t).not.toContain('Couldn’t load this charger');
    expect(t).toContain('Not rated');
    expect(t).not.toContain('★');
    // Google's own time, labelled as an estimate (the backup below is separate).
    expect(t).toContain('Estimated • 4 min ago');
  });

  test('Directions opens too', async () => {
    fetchMock.mockResolvedValue([hub]);
    await list();
    const r = await open('Navigation', {stationId: 'g-ChIJabc'});
    const t = texts(r).join('|');
    expect(t).toContain('Mall EV Hub');
    expect(t).not.toContain('Couldn’t load this charger');
  });

  test('unknown connectors are labelled, not called compatible or unusable', async () => {
    fetchMock.mockResolvedValue([noData]);
    await list();
    const r = await open('StationDetail', {stationId: 'g-ChIJnodata'});
    const t = texts(r).join('|');
    expect(t).toContain('Connector type unconfirmed');
    expect(t).not.toContain('Not compatible');
    expect(t).not.toMatch(/Can’t charge your/);
    expect(t).toContain('We have no status for this charger yet.');
  });

  test('a Google charger that is no longer listed is "not available", with a way forward', async () => {
    const r = await open('StationDetail', {stationId: 'g-gone'});
    const t = texts(r).join('|');
    expect(t).toContain('This charger isn’t available right now');
    expect(t).not.toMatch(/check your connection/i);
    await press(r, 'Find chargers');
    expect(probe.current).toBe('StationList');
  });

  test('Saved keeps the rest and explains the one that is missing', async () => {
    const r = await open('Saved', undefined, () =>
      appStore.set({favouriteStationIds: ['g-gone', 'st-chargezone-manesar']}),
    );
    const t = texts(r).join('|');
    expect(t).toContain('1 saved charger isn’t available right now');
    expect(t).toContain('ChargeZone • Manesar');
  });

  test('Saved with only a missing Google charger offers to find chargers', async () => {
    const r = await open('Saved', undefined, () =>
      appStore.set({favouriteStationIds: ['g-gone']}),
    );
    expect(texts(r).join('|')).toContain('0 saved chargers');
    await press(r, 'Find chargers');
    expect(probe.current).toBe('StationList');
  });

  test('Compare lines a Google charger up with a demo one, each with a confidence label', async () => {
    fetchMock.mockResolvedValue([hub]);
    await list();
    const r = await open('Compare', {
      stationIds: ['g-ChIJabc', 'st-chargezone-manesar'],
    });
    const t = texts(r);
    expect(t).toContain('Expected wait');
    expect(
      t.filter(x => /^(Low|Medium|High) confidence$/.test(x)),
    ).toHaveLength(2);
    expect(t.join('|')).not.toContain('couldn’t be loaded');
  });
});

describe('the queue screen', () => {
  test('claims a free bay only from a live feed, and then offers to go there', async () => {
    const r = await open('Queue', {stationId: 'st-chargezone-sec16'});
    const t = texts(r);
    expect(t).toContain('A bay is free right now');
    await press(r, 'Go to this charger');
    expect(probe.current).toBe('Navigation');
  });

  test('an estimated free bay is not called free: join the queue as usual', async () => {
    const r = await open('Queue', {stationId: 'st-jiobp-lodhi'});
    const t = texts(r);
    expect(t).not.toContain('A bay is free right now');
    expect(t).toContain('You’ll keep your place');
  });
});
