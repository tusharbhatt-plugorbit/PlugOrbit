import {Platform} from 'react-native';
import {
  GOOGLE_MAPS_ANDROID_KEY,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_IOS_KEY,
  GOOGLE_PLACES_API_KEY,
} from '@env';

const clean = (v: string | undefined) => (v ?? '').trim();

/** A platform key counts when set, else the shared dev key (same as Gradle/Podfile). */
export const hasMapsKey = (
  platformKey: string | undefined,
  sharedKey: string | undefined,
): boolean => (clean(platformKey) || clean(sharedKey)).length > 0;

/** Android draws a blank grey map without a key; iOS falls back to Apple Maps. */
export const isMapsKeyMissing = (os: string, hasKey: boolean): boolean =>
  os === 'android' && !hasKey;

// Inlined from .env at bundle time. Empty means "not configured": the app then
// uses the demo data instead of calling Google.

/** Key for Places API (New) REST calls (falls back to the shared dev key). */
export const googleApiKey: string =
  clean(GOOGLE_PLACES_API_KEY) || clean(GOOGLE_MAPS_API_KEY);
export const hasGoogleApiKey = googleApiKey.length > 0;

/**
 * Whether the iOS build was given a Maps SDK key. Without one the Google SDK
 * throws at map creation, so iOS falls back to Apple Maps. (Android always
 * uses Google Maps.) The key itself is injected natively, see ios/Podfile.
 */
export const hasIosMapsKey: boolean = hasMapsKey(
  GOOGLE_MAPS_IOS_KEY,
  GOOGLE_MAPS_API_KEY,
);

/**
 * Whether the Android build was given a Maps SDK key (the same fallback the
 * Gradle build uses: GOOGLE_MAPS_ANDROID_KEY, else GOOGLE_MAPS_API_KEY). The
 * Google SDK draws a blank grey map without one and gives the app no error, so
 * we check up front and say so instead of showing a map that cannot work.
 */
export const hasAndroidMapsKey: boolean = hasMapsKey(
  GOOGLE_MAPS_ANDROID_KEY,
  GOOGLE_MAPS_API_KEY,
);

/**
 * True when a map cannot be drawn on this device because its key is missing.
 * Android only: iOS uses Apple Maps when it has no Google key, which works.
 */
export const mapsKeyMissing: boolean = isMapsKeyMissing(
  Platform.OS,
  hasAndroidMapsKey,
);

// Search area for "near me": Places API (New) allows up to 50 km.
export const SEARCH_RADIUS_M = 10_000;
export const MAX_RESULTS = 20;

// Shown when location is unavailable, and used by demo data (New Delhi).
export const DEFAULT_CENTER = {latitude: 28.6139, longitude: 77.209} as const;
