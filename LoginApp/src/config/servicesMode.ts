import {SERVICES_MODE} from '@env';
import {hasGoogleApiKey} from './google';

/**
 * `live`: chargers come from Google Places, journeys follow real roads and support
 * tickets go to the Backend. `demo`: the built-in sample chargers, a straight-line
 * planner and local tickets, labelled as sample data in the UI.
 */
export type ServicesMode = 'live' | 'demo';

/**
 * `SERVICES_MODE=live|demo` in .env decides. Left empty, the app goes live as soon as a
 * Places key is configured (live chargers cannot work without one) and otherwise stays
 * on the labelled demo data, so a fresh checkout still shows a working app.
 */
export function resolveServicesMode(
  setting: string | undefined,
  hasPlacesKey: boolean,
): ServicesMode {
  const wanted = (setting ?? '').trim().toLowerCase();
  if (wanted === 'live' || wanted === 'demo') {
    return wanted;
  }
  return hasPlacesKey ? 'live' : 'demo';
}

export const servicesMode: ServicesMode = resolveServicesMode(
  SERVICES_MODE,
  hasGoogleApiKey,
);
export const LIVE_SERVICES = servicesMode === 'live';
