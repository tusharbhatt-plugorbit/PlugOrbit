import {GOOGLE_MAPS_API_KEY} from '@env';

// Inlined from .env at bundle time. Empty means "not configured": the app then
// falls back to demo chargers instead of calling Google.
export const googleApiKey: string = (GOOGLE_MAPS_API_KEY ?? '').trim();
export const hasGoogleApiKey = googleApiKey.length > 0;

// Search area for "near me": Places API (New) allows up to 50 km.
export const SEARCH_RADIUS_M = 10_000;
export const MAX_RESULTS = 20;

// Shown when location is unavailable, and used by demo data (New Delhi).
export const DEFAULT_CENTER = {latitude: 28.6139, longitude: 77.209} as const;
