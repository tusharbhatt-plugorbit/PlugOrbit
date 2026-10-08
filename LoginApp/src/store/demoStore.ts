import {createStore, persist, useStore} from './createStore';
import {getStorage} from './storage';

export type PaymentFailMode = 'off' | 'next' | 'always';

/**
 * Presenter controls for the showcase. They only change what the MOCK services
 * return; they never exist in a real backend.
 */
export type DemoState = {
  /** Simulated network loss: every service call throws OfflineError. */
  offline: boolean;
  /** Next service calls throw ApiError. */
  apiError: boolean;
  paymentFail: PaymentFailMode;
  /** The recommended/chosen charger flips to occupied (Backup alert). */
  stationOccupied: boolean;
  /** Remote start unavailable even on integrated chargers. */
  integrationDown: boolean;
  /** Pretend location permission is denied. */
  locationDenied: boolean;
  /** Pretend camera permission is denied (QR scan). */
  cameraDenied: boolean;
  /** Pretend no compatible chargers exist nearby. */
  noCompatible: boolean;
  /** Simulated drive: a trip advances by itself (a GPS feed replaces this). */
  autoDrive: boolean;
};

export const DEMO_DEFAULTS: DemoState = {
  offline: false,
  apiError: false,
  paymentFail: 'off',
  stationOccupied: false,
  integrationDown: false,
  locationDenied: false,
  cameraDenied: false,
  noCompatible: false,
  autoDrive: false,
};

export const demoStore = createStore<DemoState>(DEMO_DEFAULTS);

let started = false;
export function startDemoPersistence() {
  if (started) {
    return;
  }
  started = true;
  persist(demoStore, {
    key: 'plugorbit/demo',
    version: 1,
    storage: getStorage(),
    pick: Object.keys(DEMO_DEFAULTS) as Array<keyof DemoState>,
  });
}

export function resetDemo(patch: Partial<DemoState> = {}) {
  demoStore.replace({...DEMO_DEFAULTS, ...patch});
}

export function useDemo<S>(selector: (s: DemoState) => S): S {
  return useStore(demoStore, selector);
}
