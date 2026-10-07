/**
 * @format
 *
 * Google Places chargers (ids "g-…") in the station service: they can be opened
 * by id like any other, carry only what Google returned, and never read as
 * compatible or live on invented data.
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

import Geolocation from '@react-native-community/geolocation';
import {
  applyFilters,
  DEFAULT_FILTERS,
  hasUnconfirmedConnectors,
  isCompatible,
  isDemoFallback,
  waitLabel,
} from '../src/domain/rules';
import {dataTrust} from '../src/domain/trust';
import type {Vehicle} from '../src/domain/types';
import {
  clearDiscoverCache,
  loadDiscover,
  loadStationsById,
  resolveOrigin,
} from '../src/hooks/useDiscoverStations';
import {createMockServices} from '../src/services';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {clearPlacesCache} from '../src/services/mock/stationService';
import type {Charger} from '../src/services/places';
import {fetchNearbyChargers} from '../src/services/places';
import {StationNotFoundError} from '../src/services/types';
import {resetAppStore} from '../src/store/appStore';
import {resetDemo} from '../src/store/demoStore';
import {seedState} from '../src/store/seed';

const services = createMockServices();
const fetchMock = fetchNearbyChargers as jest.Mock;
const getCurrentPosition = Geolocation.getCurrentPosition as jest.Mock;

const nexon: Vehicle = {...VEHICLE_CATALOG[0], id: 'veh-1'}; // CCS2, Type2
const leaf: Vehicle = {...VEHICLE_CATALOG[9], id: 'veh-leaf'}; // CHAdeMO, Type2
const DELHI = {latitude: 28.6139, longitude: 77.209};
const MUMBAI = {latitude: 19.076, longitude: 72.8777};
const CALIFORNIA = {latitude: 37.42, longitude: -122.08};
const GOOGLE_STAMP = Date.now() - 7 * 60_000;

const charger = (over: Partial<Charger> = {}): Charger => ({
  id: 'ChIJabc',
  name: 'Mall EV Hub',
  address: '1 Mall Rd',
  latitude: MUMBAI.latitude + 0.01,
  longitude: MUMBAI.longitude,
  powerKw: 60,
  available: 1,
  total: 3,
  hours: 'Open now',
  pricePerKwh: null,
  availabilityUpdatedAt: GOOGLE_STAMP,
  connectors: [
    {type: 'CCS2', powerKw: 60, count: 2, available: 1, outOfService: 0},
    {type: 'CHAdeMO', powerKw: 50, count: 1, available: 0, outOfService: 1},
  ],
  ...over,
});

const chademoOnly = charger({
  id: 'ChIJchademo',
  name: 'CHAdeMO Only',
  connectors: [
    {type: 'CHAdeMO', powerKw: 50, count: 1, available: 1, outOfService: 0},
  ],
});
const noEvData = charger({
  id: 'ChIJnodata',
  name: 'No EV Data',
  available: null,
  total: null,
  availabilityUpdatedAt: null,
  connectors: [],
});

beforeEach(() => {
  resetAppStore({
    ...seedState(Date.now()),
    vehicles: [nexon],
    activeVehicleId: nexon.id,
  });
  resetDemo();
  clearPlacesCache();
  clearDiscoverCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue([]);
  getCurrentPosition.mockImplementation(success => success({coords: DELHI}));
});

const nearbyMumbai = (vehicle: Vehicle | null = nexon, all = false) =>
  services.station.nearby({
    origin: MUMBAI,
    vehicle,
    includeIncompatible: all,
  });

describe('a Google charger carries only what Google returned', () => {
  test('connectors come from Google’s types, powers and counts', async () => {
    fetchMock.mockResolvedValue([charger()]);
    const [s] = await nearbyMumbai();
    expect(s.id).toBe('g-ChIJabc');
    expect(
      s.connectors.map(c => [c.type, c.powerKw, c.status, c.pricePerKwh]),
    ).toEqual([
      ['CCS2', 60, 'available', null],
      ['CCS2', 60, 'occupied', null],
      ['CHAdeMO', 50, 'offline', null],
    ]);
  });

  test('no invented rating, reliability, price or connector', async () => {
    fetchMock.mockResolvedValue([noEvData]);
    const [s] = await nearbyMumbai(nexon, true);
    expect(s.rating).toBe(0);
    expect(s.reliabilityPct).toBe(0);
    expect(s.successfulSessionsPct).toBe(0);
    expect(s.connectors).toEqual([]);
    expect(s.priceFeed).toEqual({source: 'none', updatedAt: null});
    expect(s.integration).toBe('external');
  });

  test('status is Google’s estimate with Google’s own time, never live', async () => {
    fetchMock.mockResolvedValue([charger()]);
    const [s] = await nearbyMumbai();
    expect(s.statusFeed).toEqual({
      source: 'google_places',
      updatedAt: GOOGLE_STAMP,
    });
    expect(dataTrust(s.statusFeed, Date.now())).toBe('estimated');
  });

  test('without a Google timestamp it is stamped with the fetch time', async () => {
    const before = Date.now();
    fetchMock.mockResolvedValue([charger({availabilityUpdatedAt: null})]);
    const [s] = await nearbyMumbai();
    expect(s.statusFeed.source).toBe('google_places');
    expect(s.statusFeed.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test('with no availability at all the status is unknown, not "just now"', async () => {
    fetchMock.mockResolvedValue([
      charger({
        availabilityUpdatedAt: null,
        connectors: [
          {
            type: 'CCS2',
            powerKw: 60,
            count: 2,
            available: null,
            outOfService: null,
          },
        ],
      }),
    ]);
    const [s] = await nearbyMumbai();
    expect(s.connectors.map(c => c.status)).toEqual(['unknown', 'unknown']);
    expect(s.statusFeed).toEqual({source: 'none', updatedAt: null});
    expect(dataTrust(s.statusFeed, Date.now())).toBe('unknown');
  });
});

describe('compatibility follows Google’s connector types', () => {
  test('a CHAdeMO-only charger is hidden from a Nexon and shown to a Leaf', async () => {
    fetchMock.mockResolvedValue([chademoOnly]);
    expect(await nearbyMumbai(nexon)).toEqual([]);
    expect((await nearbyMumbai(leaf)).map(s => s.id)).toEqual([
      'g-ChIJchademo',
    ]);
  });

  test('a charger with no connector data is not confirmed compatible', async () => {
    fetchMock.mockResolvedValue([noEvData]);
    expect(await nearbyMumbai(nexon)).toEqual([]);
    const all = await nearbyMumbai(nexon, true);
    expect(all).toHaveLength(1);
    expect(hasUnconfirmedConnectors(all[0])).toBe(true);
    expect(isCompatible(all[0], nexon)).toBe(false);
    expect(applyFilters(all, DEFAULT_FILTERS, nexon)).toEqual([]);
    expect(
      applyFilters(all, {...DEFAULT_FILTERS, includeIncompatible: true}, nexon),
    ).toHaveLength(1);
  });
});

describe('a Google charger can be opened by id', () => {
  test('get, wait, forecast, queue all resolve it after it was listed', async () => {
    fetchMock.mockResolvedValue([charger()]);
    await nearbyMumbai();
    const got = await services.station.get('g-ChIJabc', MUMBAI);
    expect(got.name).toBe('Mall EV Hub');
    expect(got.distanceKm).toBeLessThan(5);

    const wait = await services.station.waitEstimate('g-ChIJabc', nexon);
    // A free bay on Google’s estimate is a low-confidence range, not "no wait".
    expect(wait.confidence).toBe('low');
    expect(waitLabel(wait)).not.toBe('No wait expected');

    const forecast = await services.station.forecast('g-ChIJabc');
    expect(forecast.total).toBe(3);
    expect(forecast.basis).toBe('none');

    await expect(
      services.station.joinQueue('g-ChIJabc'),
    ).resolves.toMatchObject({stationId: 'g-ChIJabc'});
  });

  test('reserving one is refused for the right reason, not "not found"', async () => {
    fetchMock.mockResolvedValue([charger()]);
    await nearbyMumbai();
    await expect(
      services.station.reserve('g-ChIJabc', Date.now() + 3_600_000, 10),
    ).rejects.toThrow(/partner chargers/);
  });

  test('a Google id that was never listed is "not available", not a crash', async () => {
    await expect(services.station.get('g-nope')).rejects.toBeInstanceOf(
      StationNotFoundError,
    );
    await expect(
      services.station.waitEstimate('g-nope'),
    ).rejects.toBeInstanceOf(StationNotFoundError);
    await expect(services.station.forecast('g-nope')).rejects.toBeInstanceOf(
      StationNotFoundError,
    );
  });

  test('saved and compared Google chargers load, or are reported missing', async () => {
    fetchMock.mockResolvedValue([charger(), chademoOnly]);
    await nearbyMumbai(nexon, true);
    const both = await loadStationsById(services.station, [
      'g-ChIJabc',
      'g-ChIJchademo',
    ]);
    expect(both.stations.map(s => s.id)).toEqual([
      'g-ChIJabc',
      'g-ChIJchademo',
    ]);
    expect(both.missing).toEqual([]);

    // After a restart the cache is empty: a graceful "missing", no throw.
    clearPlacesCache();
    const gone = await loadStationsById(services.station, [
      'g-ChIJabc',
      'st-chargezone-manesar',
    ]);
    expect(gone.stations.map(s => s.id)).toEqual(['st-chargezone-manesar']);
    expect(gone.missing).toEqual(['g-ChIJabc']);
    const onlyGone = await loadStationsById(services.station, ['g-ChIJabc']);
    expect(onlyGone).toEqual({
      stations: [],
      missing: ['g-ChIJabc'],
      fromCache: false,
    });
  });
});

describe('a phone far from the demo chargers still finds some', () => {
  test('Google found nothing there: the demo chargers around Delhi are used', async () => {
    const list = await services.station.nearby({
      origin: CALIFORNIA,
      vehicle: nexon,
    });
    expect(list.length).toBeGreaterThan(5);
    expect(isDemoFallback(CALIFORNIA, list)).toBe(true);
    // Distances are measured from the demo centre, not from California.
    expect(list[0].distanceKm).toBeLessThan(400);
    list.forEach(s => expect(Number.isFinite(s.distanceKm)).toBe(true));
  });

  test('Google found chargers there: only those are shown', async () => {
    fetchMock.mockResolvedValue([charger()]);
    const list = await nearbyMumbai();
    expect(list.map(s => s.id)).toEqual(['g-ChIJabc']);
    expect(isDemoFallback(MUMBAI, list)).toBe(false);
  });

  test('the discover list says so and measures from New Delhi', async () => {
    getCurrentPosition.mockImplementation(success =>
      success({coords: CALIFORNIA}),
    );
    const data = await loadDiscover(services.station, nexon, true);
    expect(data.demoArea).toBe(true);
    expect(data.userLocation).toBeNull();
    expect(data.origin).toEqual(DELHI);
    expect(data.stations.length).toBeGreaterThan(5);
    // A charger opened from the list agrees with the list.
    const where = await resolveOrigin();
    expect(where.origin).toEqual(DELHI);
    const one = await loadStationsById(services.station, [data.stations[0].id]);
    expect(one.stations[0].distanceKm).toBeCloseTo(
      data.stations[0].distanceKm,
      1,
    );
  });

  test('a phone near Delhi is searched from where it is', async () => {
    const data = await loadDiscover(services.station, nexon, true);
    expect(data.demoArea).toBe(false);
    expect(data.userLocation).toEqual(DELHI);
  });
});
