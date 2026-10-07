import {DEFAULT_CENTER} from '../config/google';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {LocationError, getCurrentLocation} from '../services/location';
import {useServices} from '../services';
import {OfflineError} from '../services/types';
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
};

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
}

const ORIGIN_FRESH_MS = 2 * 60 * 1000;
let lastOriginAt = 0;

/**
 * Where to measure distances from: the device when permitted, otherwise the
 * default centre (New Delhi) with the reason, so screens can explain it.
 */
export async function resolveOrigin(force = false): Promise<Origin> {
  if (!force && lastOrigin && Date.now() - lastOriginAt < ORIGIN_FRESH_MS) {
    return lastOrigin;
  }
  let result: Origin;
  try {
    if (demoStore.get().locationDenied) {
      throw new LocationError('denied', 'Location permission was denied.');
    }
    const here = await getCurrentLocation();
    result = {origin: here, userLocation: here, locationIssue: null};
  } catch (e) {
    result = {
      origin: DEFAULT_CENTER,
      userLocation: null,
      locationIssue:
        e instanceof LocationError && e.code === 'denied'
          ? 'denied'
          : 'unavailable',
    };
  }
  lastOrigin = result;
  lastOriginAt = Date.now();
  return result;
}

export async function loadDiscover(
  stationService: StationService,
  vehicle: Vehicle | null,
  forceLocate = false,
): Promise<DiscoverData> {
  const where = await resolveOrigin(forceLocate);
  try {
    const stations = await stationService.nearby({
      origin: where.origin,
      vehicle,
      // Always load everything: hiding is a view concern (applyFilters), which
      // lets "Show them" reveal incompatible chargers without another request.
      includeIncompatible: true,
    });
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

export type ByIdResult = {
  stations: StationWithDistance[];
  /** Ids that no longer resolve (removed or unknown). */
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
