import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DEFAULT_CENTER, hasGoogleApiKey} from '../config/google';
import {
  Charger,
  ChargerWithDistance,
  DEMO_CHARGERS,
  withDistance,
} from '../data/chargers';
import {LocationError, getCurrentLocation} from '../services/location';
import {fetchNearbyChargers} from '../services/places';
import type {Coords} from '../utils/geo';

export type Status = 'locating' | 'loading' | 'ready';

export type Notice = {
  kind: 'location-denied' | 'location-unavailable' | 'search-failed' | 'demo';
  message: string;
};

type State = {
  status: Status;
  chargers: readonly Charger[];
  // Where the device is, if known.
  userLocation: Coords | null;
  // Centre of the last search (the user, the map centre, or the default).
  origin: Coords;
  notice: Notice | null;
};

const INITIAL: State = {
  status: 'locating',
  chargers: [],
  userLocation: null,
  origin: DEFAULT_CENTER,
  notice: null,
};

const DEMO_NOTICE: Notice = {
  kind: 'demo',
  message: 'Showing demo chargers. Add GOOGLE_MAPS_API_KEY to see real ones.',
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

export function useNearbyChargers() {
  const [state, setState] = useState<State>(INITIAL);
  // Only the latest request may write state; older ones are aborted.
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (origin: Coords, signal: AbortSignal, carry: Notice | null) => {
      setState(s => ({...s, status: 'loading', origin, notice: carry}));

      if (!hasGoogleApiKey) {
        setState(s => ({
          ...s,
          status: 'ready',
          chargers: DEMO_CHARGERS,
          notice: carry ?? DEMO_NOTICE,
        }));
        return;
      }

      try {
        const chargers = await fetchNearbyChargers(origin, signal);
        if (signal.aborted) {
          return;
        }
        setState(s => ({...s, status: 'ready', chargers, notice: carry}));
      } catch (e) {
        if (signal.aborted) {
          return;
        }
        setState(s => ({
          ...s,
          status: 'ready',
          notice: {
            kind: 'search-failed',
            message:
              e instanceof Error ? e.message : 'Could not load chargers.',
          },
        }));
      }
    },
    [],
  );

  const begin = useCallback((): AbortSignal => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }, []);

  // Re-locate the device, then search around it.
  const refresh = useCallback(async () => {
    const signal = begin();
    setState(s => ({...s, status: 'locating', notice: null}));

    let origin: Coords = DEFAULT_CENTER;
    let carry: Notice | null = null;
    try {
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

  // Search around an arbitrary point (the "Search this area" action).
  const searchAt = useCallback(
    (center: Coords) => search(center, begin(), null),
    [begin, search],
  );

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const chargers: ChargerWithDistance[] = useMemo(
    () => withDistance(state.chargers, state.userLocation ?? state.origin),
    [state.chargers, state.userLocation, state.origin],
  );

  return {
    status: state.status,
    chargers,
    userLocation: state.userLocation,
    origin: state.origin,
    notice: state.notice,
    refresh,
    searchAt,
  };
}
