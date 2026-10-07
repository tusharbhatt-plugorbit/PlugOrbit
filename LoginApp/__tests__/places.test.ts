/**
 * @format
 */

jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  googleApiKey: 'test-key',
  hasGoogleApiKey: true,
}));

import {
  PlacesError,
  fetchNearbyChargers,
  toCharger,
} from '../src/services/places';

const CENTER = {latitude: 28.6, longitude: 77.2};

const okResponse = (body: unknown) =>
  ({ok: true, status: 200, json: async () => body} as Response);

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

describe('toCharger', () => {
  const base = {
    id: 'abc',
    displayName: {text: 'Hub'},
    formattedAddress: '1 Main St',
    location: {latitude: 1, longitude: 2},
  };

  test('maps power, connector counts and availability across aggregations', () => {
    const charger = toCharger({
      ...base,
      evChargeOptions: {
        connectorCount: 6,
        connectorAggregation: [
          {
            type: 'EV_CONNECTOR_TYPE_CCS_COMBO_2',
            maxChargeRateKw: 150,
            count: 4,
            availableCount: 1,
          },
          {
            type: 'EV_CONNECTOR_TYPE_J1772',
            maxChargeRateKw: 22,
            count: 2,
            availableCount: 2,
          },
        ],
      },
      regularOpeningHours: {openNow: true, periods: [{open: {}, close: {}}]},
    });
    expect(charger).toMatchObject({
      id: 'abc',
      name: 'Hub',
      address: '1 Main St',
      latitude: 1,
      longitude: 2,
      powerKw: 150,
      available: 3,
      total: 6,
      hours: 'Open now',
      pricePerKwh: null,
    });
  });

  test('leaves availability null when Google does not report it', () => {
    const charger = toCharger({
      ...base,
      evChargeOptions: {
        connectorCount: 2,
        connectorAggregation: [{maxChargeRateKw: 7, count: 2}],
      },
    });
    expect(charger?.available).toBeNull();
    expect(charger?.total).toBe(2);
    expect(charger?.hours).toBeNull();
  });

  test('detects 24/7 and closed hours', () => {
    expect(
      toCharger({...base, regularOpeningHours: {periods: [{open: {}}]}})?.hours,
    ).toBe('Open 24/7');
    expect(
      toCharger({
        ...base,
        regularOpeningHours: {openNow: true, periods: [{open: {}, close: {}}]},
        currentOpeningHours: {openNow: false},
      })?.hours,
    ).toBe('Closed');
  });

  test('drops places without an id or coordinates', () => {
    expect(toCharger({...base, id: undefined})).toBeNull();
    expect(toCharger({...base, location: {latitude: 1}})).toBeNull();
  });

  test('falls back to a generic name', () => {
    expect(toCharger({...base, displayName: undefined})?.name).toBe(
      'EV charging station',
    );
  });
});

describe('fetchNearbyChargers', () => {
  test('sends a Nearby Search for EV stations with the key and field mask', async () => {
    fetchMock.mockResolvedValue(okResponse({places: []}));
    await fetchNearbyChargers(CENTER);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(init.headers['X-Goog-FieldMask']).toContain(
      'places.evChargeOptions',
    );
    expect(JSON.parse(init.body)).toEqual({
      includedTypes: ['electric_vehicle_charging_station'],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {circle: {center: CENTER, radius: 10000}},
    });
  });

  test('returns mapped chargers and skips unusable places', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        places: [
          {
            id: 'a',
            displayName: {text: 'A'},
            location: {latitude: 1, longitude: 2},
          },
          {id: 'b', displayName: {text: 'no location'}},
        ],
      }),
    );
    const chargers = await fetchNearbyChargers(CENTER);
    expect(chargers.map(c => c.id)).toEqual(['a']);
  });

  test('treats a response with no "places" key as no results', async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await expect(fetchNearbyChargers(CENTER)).resolves.toEqual([]);
  });

  test('surfaces the API error message and status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {message: 'Places API (New) has not been used'},
      }),
    });
    const error = await fetchNearbyChargers(CENTER).catch(e => e);
    expect(error).toBeInstanceOf(PlacesError);
    expect(error.status).toBe(403);
    expect(error.message).toBe('Places API (New) has not been used');
  });

  test('falls back to a generic message for a non-JSON error body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    const error = await fetchNearbyChargers(CENTER).catch(e => e);
    expect(error.message).toBe('Places request failed (502).');
  });

  test('reports network failures in plain words', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const error = await fetchNearbyChargers(CENTER).catch(e => e);
    expect(error).toBeInstanceOf(PlacesError);
    expect(error.message).toMatch(/Could not reach Google/);
  });

  test('rethrows the abort when the caller cancels', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const pending = fetchNearbyChargers(CENTER, controller.signal).catch(
      e => e,
    );
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(PlacesError);
  });
});
