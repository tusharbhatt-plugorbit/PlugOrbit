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

const DEMO_AREA_NOTICE: Notice = {
  kind: 'demo-area',
  message: DEMO_AREA_MESSAGE,
};

function locationNotice(error: unknown): Notice {
  const denied = error instanceof LocationError && error.code === 'denied';
  return {
    kind: denied ? 'location-denied' : 'location-unavailable',
    message: denied
      ? 'Location is off. Showing chargers near New Delhi.'
      : 'Could not get your location. Showing chargers near New Delhi.',
  };
}

/**
 * Finds the device location, then loads compatible chargers around it through
 * the station service. Safe against overlapping requests and unmounting.
 */
export function useNearbyStations(vehicle: Vehicle | null) {
  const {station: stationService} = useServices();
  const [state, setState] = useState<State>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const vehicleRef = useRef(vehicle);
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
        // Nothing near here, so the service looked around New Delhi instead:
        // move the search centre there and say so, as for a denied location.
        const fellBack = isDemoFallback(origin, stations);
        if (fromDevice) {
          noteDemoArea(fellBack || carry?.kind === 'demo-area');
        }
        setState(s => ({
          ...s,
          phase: 'ready',
          stations,
          ...(fellBack ? {origin: DEFAULT_CENTER, userLocation: null} : {}),
          notice: fellBack ? DEMO_AREA_NOTICE : carry,
        }));
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
  }, [begin, search]);

  /** Search around an arbitrary point ("Search this area"). */
  const searchAt = useCallback(
    (center: Coords) => search(center, begin(), null),
    [begin, search],
  );

  const vehicleId = vehicle?.id ?? null;
  const first = useRef(true);
  useEffect(() => {
    // First mount locates; a vehicle switch re-searches in place.
    if (first.current) {
      first.current = false;
      refresh();
    } else {
      // Keep the reason the search is centred where it is (e.g. the demo area).
      const kind = state.notice?.kind;
      const keep =
        kind === 'location-denied' ||
        kind === 'location-unavailable' ||
        kind === 'demo-area';
      search(state.origin, begin(), keep ? state.notice : null);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

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
