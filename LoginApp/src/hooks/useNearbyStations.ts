import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DEFAULT_CENTER} from '../config/google';
import {estimateDetourMin} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {LocationError, getCurrentLocation} from '../services/location';
import {useServices} from '../services';
import {OfflineError} from '../services/types';
import {demoStore} from '../store/demoStore';
import {distanceKm, Coords} from '../utils/geo';

export type Phase = 'locating' | 'loading' | 'ready';

export type Notice = {
  kind:
    | 'location-denied'
    | 'location-unavailable'
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
    async (origin: Coords, signal: AbortSignal, carry: Notice | null) => {
      setState(s => ({...s, phase: 'loading', origin, notice: carry}));
      try {
        const stations = await stationService.nearby({
          origin,
          vehicle: vehicleRef.current,
        });
        if (signal.aborted) {
          return;
        }
        setState(s => ({...s, phase: 'ready', stations, notice: carry}));
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
      origin = here;
      setState(s => ({...s, userLocation: here}));
    } catch (e) {
      if (signal.aborted) {
        return;
      }
      carry = locationNotice(e);
      setState(s => ({...s, userLocation: null}));
    }
    await search(origin, signal, carry);
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
      searchAt(state.origin);
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
