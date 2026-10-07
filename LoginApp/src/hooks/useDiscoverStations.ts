import {DEFAULT_CENTER, hasGoogleApiKey} from '../config/google';
import {isDemoFallback, isOutsideDemoArea} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {LocationError, getCurrentLocation} from '../services/location';
import {useServices} from '../services';
import {OfflineError, StationNotFoundError} from '../services/types';
import type {StationService} from '../services/types';
import {demoStore} from '../store/demoStore';
import {Coords} from '../utils/geo';
import {useResource} from '../ui/useResource';
import type {Resource} from '../ui/useResource';

export type LocationIssue = 'denied' | 'unavailable';

export type Origin = {
  origin: Coords;
  /** Where the device is, or null when we fell back to the default centre. */
  userLocation: Coords | null;
  locationIssue: LocationIssue | null;
  /**
   * True when the device is nowhere near the demo chargers (all around New
   * Delhi), so distances are measured from there and the screen must say so.
   */
  demoArea: boolean;
};

/** The existing "location is off" notice pattern, for the demo-area case. */
export const DEMO_AREA_TITLE = 'No chargers near you';
export const DEMO_AREA_BODY = 'Showing demo chargers around New Delhi.';
export const DEMO_AREA_MESSAGE = `${DEMO_AREA_TITLE}. ${DEMO_AREA_BODY}`;

const DEMO_ORIGIN: Origin = {
  origin: DEFAULT_CENTER,
  userLocation: null,
  locationIssue: null,
  demoArea: true,
};

// Set when a search had to fall back to the demo centre, cleared when a search
// around the device finds chargers again. Screens that only measure distance
// (Saved, Details, Navigation) follow it so they agree with the list.
let demoAreaSeen = false;

export function noteDemoArea(seen: boolean): void {
  demoAreaSeen = seen;
}

/**
 * Where the device is, as an origin. Without a Google key the demo chargers
 * are the only ones there are, so a phone more than a search radius from them
 * is treated as being in New Delhi (with a notice) instead of finding nothing.
 */
export function originFromDevice(here: Coords): Origin {
  if (!hasGoogleApiKey && isOutsideDemoArea(here, DEFAULT_CENTER)) {
    return DEMO_ORIGIN;
  }
  return {
    origin: here,
    userLocation: here,
    locationIssue: null,
    demoArea: false,
  };
}

export type DiscoverData = Origin & {
  /** Every known charger near the origin, including ones the car can't use. */
  stations: StationWithDistance[];
  /** True when the connection was down and these are the last results we saw. */
  fromCache: boolean;
  loadedAt: number;
};

// The last good results, so a dropped connection shows something useful (with
// honest ages) instead of an empty screen.
let cache: DiscoverData | null = null;
let lastOrigin: Origin | null = null;

export function readDiscoverCache(): DiscoverData | null {
  return cache;
}

/** Test helper. */
export function clearDiscoverCache(): void {
  cache = null;
  lastOrigin = null;
  demoAreaSeen = false;
}

const ORIGIN_FRESH_MS = 2 * 60 * 1000;
let lastOriginAt = 0;

/**
 * Where to search from: the device when permitted, otherwise the default
 * centre (New Delhi) with the reason, so screens can explain it.
 */
async function locate(force: boolean): Promise<Origin> {
  if (!force && lastOrigin && Date.now() - lastOriginAt < ORIGIN_FRESH_MS) {
    return lastOrigin;
  }
  let result: Origin;
  try {
    if (demoStore.get().locationDenied) {
      throw new LocationError('denied', 'Location permission was denied.');
    }
    result = originFromDevice(await getCurrentLocation());
  } catch (e) {
    result = {
      origin: DEFAULT_CENTER,
      userLocation: null,
      locationIssue:
        e instanceof LocationError && e.code === 'denied'
          ? 'denied'
          : 'unavailable',
      demoArea: false,
    };
  }
  lastOrigin = result;
  lastOriginAt = Date.now();
  return result;
}

/**
 * Where to measure distances from. Like a search origin, but it also follows a
 * demo-area fallback the last search had to make, so a charger opened from the
 * list shows the same distance as the list did.
 */
export async function resolveOrigin(force = false): Promise<Origin> {
  const where = await locate(force);
  return demoAreaSeen && where.userLocation ? DEMO_ORIGIN : where;
}

export async function loadDiscover(
  stationService: StationService,
  vehicle: Vehicle | null,
  forceLocate = false,
): Promise<DiscoverData> {
  const searchFrom = await locate(forceLocate);
  try {
    const stations = await stationService.nearby({
      origin: searchFrom.origin,
      vehicle,
      // Always load everything: hiding is a view concern (applyFilters), which
      // lets "Show them" reveal incompatible chargers without another request.
      includeIncompatible: true,
    });
    // Nothing near the device, so the service looked around New Delhi instead.
    const fellBack = isDemoFallback(searchFrom.origin, stations);
    noteDemoArea(fellBack || searchFrom.demoArea);
    const where = fellBack ? DEMO_ORIGIN : searchFrom;
    cache = {...where, stations, fromCache: false, loadedAt: Date.now()};
    return cache;
  } catch (e) {
    if (e instanceof OfflineError && cache) {
      return {...cache, fromCache: true};
    }
    throw e;
  }
}

/** Nearby chargers around the device, shared by the list and the filters. */
export function useDiscoverStations(
  vehicle: Vehicle | null,
): Resource<DiscoverData> {
  const {station} = useServices();
  return useResource(
    () => loadDiscover(station, vehicle, true),
    [station, vehicle?.id ?? null],
  );
}

/**
 * AsyncView copy for a charger that failed to load. A charger that simply
 * isn't available right now (removed, or a Google Maps one that isn't near
 * you) is not a connection problem, so it doesn't say "check your connection".
 */
export function stationErrorProps(
  error: Error | null,
  title: string,
  body?: string,
): {errorTitle: string; errorBody?: string} {
  if (error instanceof StationNotFoundError) {
    return {
      errorTitle: 'This charger isn’t available right now',
      errorBody:
        'It may have been removed, or it’s a Google Maps charger that isn’t near you at the moment. Find it again in Nearby chargers.',
    };
  }
  return {errorTitle: title, errorBody: body};
}

export type ByIdResult = {
  stations: StationWithDistance[];
  /**
   * Ids that don't resolve right now: removed, or a Google Maps charger that
   * isn't among the results we last loaded. Not an error, so a screen can say
   * so and offer a way forward instead of "check your connection".
   */
  missing: string[];
  fromCache: boolean;
};

/**
 * Loads specific chargers (Saved, Compare). Falls back to the last results we
 * saw when offline, and tolerates individual ids that no longer exist.
 */
export async function loadStationsById(
  stationService: StationService,
  ids: readonly string[],
): Promise<ByIdResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return {stations: [], missing: [], fromCache: false};
  }
  const where = await resolveOrigin();
  const settled = await Promise.allSettled(
    unique.map(id => stationService.get(id, where.origin)),
  );
  const stations: StationWithDistance[] = [];
  const missing: string[] = [];
  let offline = false;
  let firstError: unknown = null;
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      stations.push(r.value);
      return;
    }
    if (r.reason instanceof StationNotFoundError) {
      missing.push(unique[i]);
      return;
    }
    firstError = firstError ?? r.reason;
    if (r.reason instanceof OfflineError) {
      offline = true;
      const cached = cache?.stations.find(s => s.id === unique[i]);
      if (cached) {
        stations.push(cached);
      }
    } else {
      missing.push(unique[i]);
    }
  });
  if (stations.length === 0 && firstError) {
    throw firstError;
  }
  // Keep the order the caller asked for.
  stations.sort((a, b) => unique.indexOf(a.id) - unique.indexOf(b.id));
  return {stations, missing, fromCache: offline};
}
