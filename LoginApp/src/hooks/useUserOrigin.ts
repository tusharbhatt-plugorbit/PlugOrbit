import {useEffect, useState} from 'react';
import {DEFAULT_CENTER} from '../config/google';
import {LocationError, getCurrentLocation} from '../services/location';
import {demoStore} from '../store/demoStore';
import type {Coords} from '../utils/geo';

/**
 * Where the driver is, falling back to the default centre when location is
 * off or denied. `known` says which one you got.
 */
export function useUserOrigin(): {
  origin: Coords;
  known: boolean;
  ready: boolean;
} {
  const [state, setState] = useState<{
    origin: Coords;
    known: boolean;
    ready: boolean;
  }>({
    origin: DEFAULT_CENTER,
    known: false,
    ready: false,
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (demoStore.get().locationDenied) {
          throw new LocationError('denied', 'Location permission was denied.');
        }
        const here = await getCurrentLocation();
        if (alive) {
          setState({origin: here, known: true, ready: true});
        }
      } catch {
        if (alive) {
          setState({origin: DEFAULT_CENTER, known: false, ready: true});
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
