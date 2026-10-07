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

const NATIVE_TIMEOUT_MS = 15_000;

// The Android Play Services provider ignores `timeout`, never reports a missing
// fix, and keeps ONE native callback slot that a second request overwrites. So
// we (a) only ever have one request in flight and (b) enforce the timeout here.
let inflight: Promise<Coords> | null = null;

export function getCurrentLocation(): Promise<Coords> {
  if (inflight) {
    return inflight;
  }
  configure();
  const request = new Promise<Coords>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        settle();
      }
    };
    // A little after the native timeout, so the native one wins when it works.
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new LocationError('timeout', 'Finding your location timed out.'),
          ),
        ),
      NATIVE_TIMEOUT_MS + 2_000,
    );
    Geolocation.getCurrentPosition(
      ({coords}) =>
        finish(() =>
          resolve({latitude: coords.latitude, longitude: coords.longitude}),
        ),
      error => finish(() => reject(toLocationError(error))),
      {enableHighAccuracy: true, timeout: NATIVE_TIMEOUT_MS, maximumAge: 60_000},
    );
  });
  const release = () => {
    if (inflight === request) {
      inflight = null;
    }
  };
  inflight = request;
  request.then(release, release);
  return request;
}
