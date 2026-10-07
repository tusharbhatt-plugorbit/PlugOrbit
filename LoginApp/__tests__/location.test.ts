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
