import {Platform} from 'react-native';
import Geolocation, {
  GeolocationError,
} from '@react-native-community/geolocation';
import type {Coords} from '../utils/geo';

export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  code: LocationErrorCode;

  constructor(code: LocationErrorCode, message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

let configured = false;

function configure() {
  if (configured) {
    return;
  }
  configured = true;
  Geolocation.setRNConfiguration({
    // The library shows the OS permission prompt itself on first use.
    skipPermissionRequests: false,
    authorizationLevel: 'whenInUse',
    enableBackgroundLocationUpdates: false,
    // Android: Google's Fused Location Provider (Play Services).
    locationProvider: Platform.OS === 'android' ? 'playServices' : 'auto',
  });
}

// GeolocationError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE,
// 3 TIMEOUT, 4 PLAY_SERVICE_NOT_AVAILABLE, 5 SETTINGS_NOT_SATISFIED.
function toLocationError(error: GeolocationError): LocationError {
  switch (error.code) {
    case 1:
      return new LocationError('denied', 'Location permission was denied.');
    case 3:
      return new LocationError('timeout', 'Finding your location timed out.');
    default:
      return new LocationError(
        'unavailable',
        'Your location is unavailable. Turn on location services.',
      );
  }
}

export function getCurrentLocation(): Promise<Coords> {
  configure();
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      ({coords}) =>
        resolve({latitude: coords.latitude, longitude: coords.longitude}),
      error => reject(toLocationError(error)),
      {enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000},
    );
  });
}
