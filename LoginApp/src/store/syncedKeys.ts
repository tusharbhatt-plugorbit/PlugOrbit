import type {AppState} from './appStore';

/**
 * The part of the persisted store that is backed up to the user's PlugOrbit account
 * (Firestore, through the Backend). Must match SLICE_TYPES in
 * Backend/app/services/app_state.py: the Backend refuses any other name.
 *
 * Deliberately not synced: signedIn (derived), session / reservation / queue / chosen /
 * activeRoute / smartDrive / battery / vehicleLink (in-flight or tied to this phone),
 * paymentMethods (financial data: a decision to take explicitly).
 */
export const SYNCED_KEYS = [
  'vehicles',
  'activeVehicleId',
  'filters',
  'tripPrefs',
  'alertPrefs',
  'privacy',
  'language',
  'plus',
  'favouriteStationIds',
  'savedRoutes',
  'history',
  'tickets',
  'notifications',
  'feedbackDone',
] as const;

// Compile error if a name above is not a field of the store.
type MustBeStoreKey<T extends keyof AppState> = T;
export type SyncedKey = MustBeStoreKey<(typeof SYNCED_KEYS)[number]>;
