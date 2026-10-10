import {heldReservation} from '../domain/reservation';
import {INITIAL_SMART_DRIVE} from '../intelligence/types';
import type {SmartDriveState} from '../intelligence/types';
import {DEFAULT_FILTERS} from '../domain/rules';
import type {
  AlertPreferences,
  AppNotification,
  BatteryReading,
  ChargingSession,
  PaymentMethod,
  PrivacyPreferences,
  QueueTicket,
  Reservation,
  Route,
  SavedRoute,
  SessionSummary,
  StationFilters,
  Ticket,
  TripPreferences,
  Vehicle,
} from '../domain/types';
import {createStore, persist, Persisted, useStore} from './createStore';
import {getStorage} from './storage';
import {seedState} from './seed';
import {sigOf} from './signature';
import {SYNCED_KEYS} from './syncedKeys';

export type ChosenStop = {
  stationId: string;
  connectorId: string | null;
  backupStationId: string | null;
  /** Epoch ms the choice was made (shown as cache age when offline). */
  at: number;
};

export type AppState = {
  hydrated: boolean;
  /** Account is signed in (set by the OTP flow). */
  signedIn: boolean;
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  battery: BatteryReading | null;
  vehicleLink: {connected: boolean; method: 'oem' | 'obd' | null};
  filters: StationFilters;
  tripPrefs: TripPreferences;
  alertPrefs: AlertPreferences;
  privacy: PrivacyPreferences;
  language: 'en' | 'hi';
  plus: {active: boolean; since: number | null};
  favouriteStationIds: string[];
  savedRoutes: SavedRoute[];
  /** Cached so a weak highway signal never loses the plan. */
  activeRoute: Route | null;
  chosen: ChosenStop | null;
  /** The in-flight session (active, payment due/failed). Survives restarts. */
  session: ChargingSession | null;
  history: SessionSummary[];
  tickets: Ticket[];
  notifications: AppNotification[];
  reservation: Reservation | null;
  queue: QueueTicket | null;
  paymentMethods: PaymentMethod[];
  /** Feedback already given, so the prompt isn't shown twice. */
  feedbackDone: string[];
  /** Smart Drive: the trip being watched, what it learned, how to talk to you. */
  smartDrive: SmartDriveState;
  /** Whose data this phone holds once cloud backup is linked (null = never linked). */
  accountUid: string | null;
  /**
   * Fingerprints of the sample content seeded on first launch, per backed-up field. A field
   * that still matches is demo data: cloud backup never uploads it (see store/cloudSync.ts).
   */
  demoSeed: Record<string, string>;
};

export const INITIAL_STATE: AppState = {
  hydrated: false,
  signedIn: false,
  vehicles: [],
  activeVehicleId: null,
  battery: null,
  vehicleLink: {connected: false, method: null},
  filters: DEFAULT_FILTERS,
  tripPrefs: {
    minArrivalSocPct: 12,
    strategy: 'reliable',
    avoidPaidParking: false,
    preferAmenities: true,
  },
  alertPrefs: {
    started: true,
    reached80: true,
    ended: true,
    paymentDone: false,
    idleFeeWarning: false,
  },
  privacy: {
    preciseLocation: true,
    vehicleBatteryData: true,
    history: true,
    personalisedOffers: false,
  },
  language: 'en',
  plus: {active: false, since: null},
  favouriteStationIds: [],
  savedRoutes: [],
  activeRoute: null,
  chosen: null,
  session: null,
  history: [],
  tickets: [],
  notifications: [],
  reservation: null,
  queue: null,
  paymentMethods: [],
  feedbackDone: [],
  smartDrive: INITIAL_SMART_DRIVE,
  accountUid: null,
  demoSeed: {},
};

export const appStore = createStore<AppState>(INITIAL_STATE);

const PERSISTED_KEYS: ReadonlyArray<keyof AppState> = [
  'signedIn',
  'vehicles',
  'activeVehicleId',
  'battery',
  'vehicleLink',
  'filters',
  'tripPrefs',
  'alertPrefs',
  'privacy',
  'language',
  'plus',
  'favouriteStationIds',
  'savedRoutes',
  'activeRoute',
  'chosen',
  'session',
  'history',
  'tickets',
  'notifications',
  'reservation',
  'queue',
  'paymentMethods',
  'feedbackDone',
  'smartDrive',
  'accountUid',
  'demoSeed',
];

// Bump when the persisted shape changes; old blobs are then ignored safely.
export const STORE_VERSION = 1;

let persisted: Persisted | null = null;

/** The first-launch sample content, with the fingerprints that mark it as demo data. */
export function demoState(now: number): Partial<AppState> {
  const seed = seedState(now);
  const demoSeed: Record<string, string> = {};
  for (const key of SYNCED_KEYS) {
    if (key in seed) {
      demoSeed[key] = sigOf(seed[key]);
    }
  }
  return {...seed, demoSeed};
}

/**
 * Load saved state, seed demo data on first launch, mark hydrated. Safe to
 * call more than once.
 */
export async function hydrateAppStore(): Promise<void> {
  if (!persisted) {
    persisted = persist(appStore, {
      key: 'plugorbit/app',
      version: STORE_VERSION,
      storage: getStorage(),
      pick: PERSISTED_KEYS,
    });
  }
  await persisted.hydrated;
  const s = appStore.get();
  if (
    // A phone linked to a cloud account shows that account's data, never sample content.
    s.accountUid === null &&
    s.history.length === 0 &&
    s.tickets.length === 0 &&
    s.paymentMethods.length === 0
  ) {
    appStore.set(demoState(Date.now()));
  }
  if (s.reservation && !heldReservation(s.reservation, Date.now())) {
    // The hold ran out while the app was closed: the bay is already released.
    appStore.set({reservation: null});
  }
  appStore.set({hydrated: true});
}

export function flushAppStore(): Promise<void> {
  return persisted ? persisted.flush() : Promise.resolve();
}

/**
 * Production reset (Presenter tools): swap in a clean state but keep
 * persistence running, and write it through now, so later changes are still
 * saved and a restart does not bring the old data back.
 */
export async function resetAppData(
  patch: Partial<AppState> = {},
): Promise<void> {
  appStore.replace({...INITIAL_STATE, ...patch});
  await persisted?.flush();
}

/** Test helper: back to a clean slate without touching storage. */
export function resetAppStore(patch: Partial<AppState> = {}) {
  persisted?.stop();
  persisted = null;
  appStore.replace({...INITIAL_STATE, ...patch});
}

export function useApp<S>(selector: (s: AppState) => S): S {
  return useStore(appStore, selector);
}

// --------------------------------------------------------------- selectors --

export const selectActiveVehicle = (s: AppState): Vehicle | null =>
  s.vehicles.find(v => v.id === s.activeVehicleId) ?? null;

export const selectTrip = (s: AppState) => s.smartDrive.trip;

export function getActiveVehicle(): Vehicle | null {
  return selectActiveVehicle(appStore.get());
}
