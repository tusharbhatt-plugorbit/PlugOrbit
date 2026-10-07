/**
 * @format
 */

import Geolocation from '@react-native-community/geolocation';
import {LocationError, getCurrentLocation} from '../src/services/location';

const getCurrentPosition = Geolocation.getCurrentPosition as jest.Mock;

afterEach(() => {
  getCurrentPosition.mockReset();
});

test('resolves with the device coordinates', async () => {
  getCurrentPosition.mockImplementation(success =>
    success({coords: {latitude: 12.97, longitude: 77.59, accuracy: 5}}),
  );
  await expect(getCurrentLocation()).resolves.toEqual({
    latitude: 12.97,
    longitude: 77.59,
  });
});

test('configures the Google Play Services provider once', async () => {
  getCurrentPosition.mockImplementation(success =>
    success({coords: {latitude: 1, longitude: 2}}),
  );
  await getCurrentLocation();
  await getCurrentLocation();
  expect(Geolocation.setRNConfiguration).toHaveBeenCalledTimes(1);
  expect(Geolocation.setRNConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({
      authorizationLevel: 'whenInUse',
      enableBackgroundLocationUpdates: false,
    }),
  );
});

test.each([
  [1, 'denied'],
  [2, 'unavailable'],
  [3, 'timeout'],
  [5, 'unavailable'],
])('maps native error code %i to "%s"', async (nativeCode, code) => {
  getCurrentPosition.mockImplementation((_success, error) =>
    error({code: nativeCode, message: 'x'}),
  );
  const error = await getCurrentLocation().catch(e => e);
  expect(error).toBeInstanceOf(LocationError);
  expect(error.code).toBe(code);
});

describe('one request at a time, with a JS timeout', () => {
  afterEach(() => jest.useRealTimers());

  test('overlapping callers share a single native request', async () => {
    let succeed!: (p: unknown) => void;
    getCurrentPosition.mockImplementation(success => {
      succeed = success;
    });
    const a = getCurrentLocation();
    const b = getCurrentLocation();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    succeed({coords: {latitude: 3, longitude: 4}});
    await expect(a).resolves.toEqual({latitude: 3, longitude: 4});
    await expect(b).resolves.toEqual({latitude: 3, longitude: 4});
    // Settled: the next call is a fresh native request.
    getCurrentPosition.mockImplementation(success =>
      success({coords: {latitude: 5, longitude: 6}}),
    );
    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 5,
      longitude: 6,
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  test('a native call that never answers still ends in a timeout', async () => {
    jest.useFakeTimers();
    getCurrentPosition.mockImplementation(() => {});
    const pending = getCurrentLocation().catch(e => e);
    jest.advanceTimersByTime(17_500);
    const error = await pending;
    expect(error).toBeInstanceOf(LocationError);
    expect(error.code).toBe('timeout');
    // ...and the app is not stuck: a new request can be made afterwards.
    getCurrentPosition.mockImplementation(success =>
      success({coords: {latitude: 7, longitude: 8}}),
    );
    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 7,
      longitude: 8,
    });
  });
});
