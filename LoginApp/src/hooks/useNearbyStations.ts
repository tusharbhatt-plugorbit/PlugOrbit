import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DEFAULT_CENTER} from '../config/google';
import {estimateDetourMin, isDemoFallback} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {LocationError, getCurrentLocation} from '../services/location';
import {useServices} from '../services';
import {OfflineError} from '../services/types';
import {demoStore} from '../store/demoStore';
import {distanceKm, Coords} from '../utils/geo';
import {
  DEMO_AREA_MESSAGE,
  noteDemoArea,
  originFromDevice,
} from './useDiscoverStations';

export type Phase = 'locating' | 'loading' | 'ready';

export type Notice = {
  kind:
    | 'location-denied'
    | 'location-unavailable'
    | 'location-no-fix'
    | 'demo-area'
    | 'search-failed'
    | 'offline';
  message: string;
};

type State = {
  phase: Phase;
  stations: readonly StationWithDistance[];
  /** Where the device is, if known. */
  userLocation: Coords | null;
  /** Centre of the last search (the user, the map centre, or the default). */
  origin: Coords;
  notice: Notice | null;
};

const INITIAL: State = {
  phase: 'locating',
  stations: [],
  userLocation: null,
  origin: DEFAULT_CENTER,
  notice: null,
};

// The last good search around the device, shared by every screen that asks
// (Home's preview, the map, the Charge tab) so opening the map from Home does
// not locate and call Places a second time. Only a search centred on the device
// is kept, never "search this area" and never a failure; it expires quickly, and
// each station's own status feed still says how old its data is.
const CACHE_TTL_MS = 90_000;
let cache: {vehicleId: string | null; at: number; state: State} | null = null;

/** Forget the shared result (tests, sign-out, a changed demo setting). */
export function resetNearbyCache() {
  cache = null;
}

function freshCache(vehicleId: string | null): State | null {
  return cache &&
    cache.vehicleId === vehicleId &&
    Date.now() - cache.at < CACHE_TTL_MS
    ? cache.state
    : null;
}

const DEMO_AREA_NOTICE: Notice = {
  kind: 'demo-area',
  message: DEMO_AREA_MESSAGE,
};

function locationNotice(error: unknown): Notice {
  const code = error instanceof LocationError ? error.code : null;
  if (code === 'denied') {
    return {
      kind: 'location-denied',
      message: 'Location is off. Showing chargers near New Delhi.',
    };
  }
  // Services are on but no position arrived in time (indoors, weak signal).
  if (code === 'timeout') {
    return {
      kind: 'location-no-fix',
      message: 'Could not find your location. Showing chargers near New Delhi.',
    };
  }
  return {
    kind: 'location-unavailable',
    message: 'Could not get your location. Showing chargers near New Delhi.',
  };
}

/**
 * Finds the device location, then loads compatible chargers around it through
 * the station service. Safe against overlapping requests and unmounting.
 *
 * `enabled` is false while the screen is mounted but hidden (a tab behind the
 * current one): it neither locates nor searches then, and when it turns true again it
 * only searches if what this screen last loaded has expired or the vehicle changed.
 */
export function useNearbyStations(vehicle: Vehicle | null, enabled = true) {
  const {station: stationService} = useServices();
  const vehicleKey = vehicle?.id ?? null;
  // Start from the shared result when there is a fresh one (and then skip the first refresh).
  const seeded = useRef<State | null>(null);
  const [state, setState] = useState<State>(() => {
    seeded.current = freshCache(vehicleKey);
    return seeded.current ?? INITIAL;
  });
  const abortRef = useRef<AbortController | null>(null);
  const vehicleRef = useRef(vehicle);
  // What this screen itself last loaded (including a "Search this area" result, which
  // the shared cache deliberately never keeps), so returning to it does not refetch.
  const lastLoaded = useRef<{at: number; vehicleId: string | null} | null>(
    cache && seeded.current
      ? {at: cache.at, vehicleId: cache.vehicleId}
      : null,
  );
  vehicleRef.current = vehicle;

  const begin = useCallback((): AbortSignal => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }, []);

  const search = useCallback(
    async (
      origin: Coords,
      signal: AbortSignal,
      carry: Notice | null,
      fromDevice = false,
    ) => {
      setState(s => ({...s, phase: 'loading', origin, notice: carry}));
      try {
        const stations = await stationService.nearby({
          origin,
          vehicle: vehicleRef.current,
        });
        if (signal.aborted) {
          return;
        }
        lastLoaded.current = {
          at: Date.now(),
          vehicleId: vehicleRef.current?.id ?? null,
        };
        // Nothing near here, so the service looked around New Delhi instead:
        // move the search centre there and say so, as for a denied location.
        const fellBack = isDemoFallback(origin, stations);
        if (fromDevice) {
          noteDemoArea(fellBack || carry?.kind === 'demo-area');
        }
        setState(s => {
          const next: State = {
            ...s,
            phase: 'ready',
            stations,
            ...(fellBack ? {origin: DEFAULT_CENTER, userLocation: null} : {}),
            notice: fellBack ? DEMO_AREA_NOTICE : carry,
          };
          if (fromDevice) {
            cache = {
              vehicleId: vehicleRef.current?.id ?? null,
              at: Date.now(),
              state: next,
            };
          }
          return next;
        });
      } catch (e) {
        if (signal.aborted) {
          return;
        }
        const offline = e instanceof OfflineError;
        setState(s => ({
          ...s,
          phase: 'ready',
          notice: {
            kind: offline ? 'offline' : 'search-failed',
            message: offline
              ? 'You’re offline. Showing the last chargers we found.'
              : e instanceof Error
              ? e.message
              : 'Could not load chargers.',
          },
        }));
      }
    },
    [stationService],
  );

  /** Re-locate the device, then search around it. */
  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const signal = begin();
    setState(s => ({...s, phase: 'locating', notice: null}));

    let origin: Coords = DEFAULT_CENTER;
    let carry: Notice | null = null;
    try {
      if (demoStore.get().locationDenied) {
        throw new LocationError('denied', 'Location permission was denied.');
      }
      const here = await getCurrentLocation();
      if (signal.aborted) {
        return;
      }
      const where = originFromDevice(here);
      origin = where.origin;
      if (where.demoArea) {
        carry = DEMO_AREA_NOTICE;
      }
      setState(s => ({...s, userLocation: where.userLocation}));
    } catch (e) {
      if (signal.aborted) {
        return;
      }
      carry = locationNotice(e);
      setState(s => ({...s, userLocation: null}));
    }
    await search(origin, signal, carry, true);
  }, [begin, search, enabled]);

  /** Search around an arbitrary point ("Search this area"). */
  const searchAt = useCallback(
    (center: Coords) =>
      enabled ? search(center, begin(), null) : Promise.resolve(),
    [begin, search, enabled],
  );

  const vehicleId = vehicle?.id ?? null;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const loaded = lastLoaded.current;
    if (!loaded) {
      // Nothing loaded yet: the first time shown, or hidden before its first search
      // finished (that search was cancelled). Locate the device, then search around it.
      refresh();
    } else if (
      loaded.vehicleId === vehicleId &&
      Date.now() - loaded.at < CACHE_TTL_MS
    ) {
      // Back on a screen that loaded recently for this vehicle: nothing to fetch.
    } else {
      // A vehicle switch, or an expired result: search again in place.
      // Keep the reason the search is centred where it is (e.g. the demo area).
      const kind = state.notice?.kind;
      const keep =
        kind === 'location-denied' ||
        kind === 'location-unavailable' ||
        kind === 'location-no-fix' ||
        kind === 'demo-area';
      search(state.origin, begin(), keep ? state.notice : null);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, enabled]);

  // Distances are measured from the device when known, else the search centre.
  const reference = state.userLocation ?? state.origin;
  const stations = useMemo(
    () =>
      state.stations
        .map(s => {
          const d = distanceKm(reference, s);
          return {...s, distanceKm: d, detourMin: estimateDetourMin(d)};
        })
        .sort((a, b) => a.distanceKm - b.distanceKm),
    [state.stations, reference],
  );

  return {
    phase: state.phase,
    stations,
    userLocation: state.userLocation,
    origin: state.origin,
    notice: state.notice,
    refresh,
    searchAt,
  };
}
