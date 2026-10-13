jest.mock('../src/config/google', () => ({googleApiKey: 'test-key'}));
import {searchAddresses} from '../src/services/addressSearch';
import {createRouteService} from '../src/services/mock/routeService';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {setFastMocks} from '../src/services/mock/runtime';
import {resetDemo} from '../src/store/demoStore';
const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});
test('search returns actual address coordinates and rejects invalid results', async () => {
  const request = jest.fn().mockResolvedValue({ok: true, json: async () => ({places: [
    {id: 'a', formattedAddress: 'Kalkaji, New Delhi', location: {latitude: 28.54, longitude: 77.26}},
    {id: 'bad', formattedAddress: 'Invalid', location: {latitude: 999, longitude: 77}},
  ]})});
  globalThis.fetch = request;
  expect(await searchAddresses('Kalkaji')).toEqual([{id: 'a', label: 'Kalkaji, New Delhi', coords: {latitude: 28.54, longitude: 77.26}}]);
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({textQuery: 'Kalkaji', pageSize: 5});
});
test('provider rejection does not fabricate a location', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({ok: false, status: 403});
  await expect(searchAddresses('Kalkaji')).rejects.toThrow('Address search is unavailable');
});
test('custom addresses route between selected coordinates and preserve them', async () => {
  setFastMocks(true); resetDemo();
  const fromCoords = {latitude: 28.6139, longitude: 77.209};
  const toCoords = {latitude: 28.60, longitude: 77.20};
  const route = await createRouteService().plan({fromLabel: 'My starting address', toLabel: 'My destination',
    fromCoords, toCoords, startSoc: 100, strategy: 'reliable',
    vehicle: {...VEHICLE_CATALOG[0], id: 'test-car'}, safetyReservePct: 12, avoidPaidParking: false});
  expect(route.fromCoords).toEqual(fromCoords); expect(route.toCoords).toEqual(toCoords);
  expect(route.polyline[0]).toEqual(fromCoords);
  expect(route.polyline[route.polyline.length - 1]).toEqual(toCoords);
});
