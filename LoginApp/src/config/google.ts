import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_IOS_KEY,
  GOOGLE_PLACES_API_KEY,
} from '@env';

const clean = (v: string | undefined) => (v ?? '').trim();

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
export const hasIosMapsKey: boolean =
  (clean(GOOGLE_MAPS_IOS_KEY) || clean(GOOGLE_MAPS_API_KEY)).length > 0;

// Search area for "near me": Places API (New) allows up to 50 km.
export const SEARCH_RADIUS_M = 10_000;
export const MAX_RESULTS = 20;

// Shown when location is unavailable, and used by demo data (New Delhi).
export const DEFAULT_CENTER = {latitude: 28.6139, longitude: 77.209} as const;
