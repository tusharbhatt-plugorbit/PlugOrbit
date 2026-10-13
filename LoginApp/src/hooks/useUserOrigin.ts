import {useEffect, useState} from 'react';
import {DEFAULT_CENTER} from '../config/google';
import type {Coords} from '../utils/geo';
import {getCurrentLocation} from '../services/location';
import {resolveOrigin} from './useDiscoverStations';

type UserOrigin = {
  origin: Coords;
  known: boolean;
  ready: boolean;
  /** The device is far from the demo chargers, so distances start in New Delhi. */
  demoArea: boolean;
};

/**
 * Where the driver is, falling back to the default centre when location is
 * off or denied, or when the phone is nowhere near the demo chargers (the same
 * rule the list uses, so a charger shows the same distance everywhere).
 * `known` says whether you got the device's own position.
 */
export function useUserOrigin(live = false): UserOrigin {
  const [state, setState] = useState<UserOrigin>({
    origin: DEFAULT_CENTER,
    known: false,
    ready: false,
    demoArea: false,
  });
  useEffect(() => {
    let alive = true;
    const request = live
      ? getCurrentLocation().then(origin => ({origin, userLocation: origin, demoArea: false}))
          .catch(() => ({origin: DEFAULT_CENTER, userLocation: null, demoArea: false}))
      : resolveOrigin(true);
    request.then(where => {
      if (alive) {
        setState({
          origin: where.origin,
          known: where.userLocation !== null,
          ready: true,
          demoArea: where.demoArea,
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [live]);
  return state;
}
