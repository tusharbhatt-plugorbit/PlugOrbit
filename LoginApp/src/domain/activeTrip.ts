import type {CoDriverEventKind, NotificationLevel} from './coDriver';
import type {TripImpact} from './tripImpact';
import type {Confidence, Route, Vehicle} from './types';

/**
 * The whole journey as one object. PlugOrbit thinks in trips, not in chargers:
 * where the car is, what battery it will have, which stop comes next, what the
 * backup is, and whether the plan still holds. Everything here is plain data so
 * it persists and survives an app restart (see `store/appStore`).
 */

export type TripPhase =
  /** On the road; PlugOrbit is watching the next charging stop. */
  | 'driving'
  /** Arrived at the planned charger; waiting for the driver to plug in. */
  | 'at_charger'
  /** A charging session is running for this stop. */
  | 'charging'
  /** At the destination. */
  | 'arrived'
  /** Finished or cancelled; kept briefly for the summary. */
  | 'ended';

export type MonitoringStatus =
  /** Watching the planned stop; nothing to report. */
  | 'monitoring'
  /** A better stop is waiting for the driver's OK. */
  | 'switch_available'
  /** No signal: running on the plan saved on this phone. */
  | 'offline'
  /** Nothing to watch right now (charging, arrived, or no stop needed). */
  | 'idle';

export type BackupPlan = {
  stationId: string;
  stationName: string;
  operator: string;
  latitude: number;
  longitude: number;
  /** Km from the trip start along the route. */
  alongKm: number;
  /**
   * Extra minutes versus the primary stop if the driver only finds out on
   * arrival (the planner's worst case). The live cost of switching from where
   * the car is NOW is worked out by `switchCostMin`.
   */
  extraMin: number;
  /** Extra minutes the backup's own turn-off adds. */
  detourMin: number;
  connectorLabel: string;
};

/** One planned charging stop, with numbers projected from where the car is. */
export type StopPlan = {
  stopIndex: number;
  stationId: string;
  stationName: string;
  operator: string;
  latitude: number;
  longitude: number;
  connectorId: string;
  /** "C2 • CCS2". */
  connectorLabel: string;
  alongKm: number;
  /** Projected battery on arrival, whole percent. */
  arriveSoc: number;
  chargeToSoc: number;
  chargeMin: number;
  costInr: number | null;
  detourMin: number;
  impact: TripImpact;
  confidence: Confidence;
  backup: BackupPlan | null;
  backupNote: string | null;
};

export type PendingSwitch = {
  fromStationId: string;
  fromName: string;
  toStationId: string;
  toName: string;
  reason: 'occupied' | 'offline' | 'unreliable' | 'better';
  /** How far ahead on the route the new stop is, km. */
  aheadKm: number | null;
  /** Minutes saved against waiting, when we can say. */
  savedMin: number | null;
  createdAt: number;
};

export type TripLogEntry = {
  id: string;
  at: number;
  kind: CoDriverEventKind;
  level: NotificationLevel;
  title: string;
  body: string;
};

export type TripStats = {
  stopsCompleted: number;
  energyKwh: number;
  costInr: number;
  chargeMin: number;
};

export type ActiveTrip = {
  tripId: string;
  /** Snapshot of the car, so mid-trip maths never shifts if the active car does. */
  vehicle: Vehicle;
  startedAt: number;
  startingSoc: number;
  /** Battery now, as last computed. */
  currentSoc: number;
  origin: string;
  destination: string;
  route: Route;
  totalKm: number;
  /** Km driven from the start: the source of truth for where the car is. */
  km: number;
  /** A known (km, battery) pair; the battery is projected forward from it. */
  anchor: {km: number; soc: number};
  speedKmh: number;
  /** Epoch ms the driver is expected at the destination. */
  etaAt: number;
  expectedArrivalSoc: number;
  chargingRequired: boolean;
  /** The next stop to charge at; equals route.stops.length when none is left. */
  stopIndex: number;
  primaryStop: StopPlan | null;
  backupStop: BackupPlan | null;
  /** Plain-language "why this charger". */
  recommendationReason: string;
  dataConfidence: Confidence | null;
  chargingTargetSoc: number | null;
  estimatedChargeMin: number | null;
  estimatedCostInr: number | null;
  totalTripImpact: TripImpact | null;
  /** Route confidence level: how comfortable the whole trip is. */
  tripRisk: Confidence;
  smartDriveEnabled: boolean;
  monitoringStatus: MonitoringStatus;
  lastCheckedAt: number | null;
  /** When the phone lost signal, if it did. */
  offlineSince: number | null;
  phase: TripPhase;
  pendingSwitch: PendingSwitch | null;
  /** "from:to" suggestions the driver declined; not offered again. */
  dismissedSwitches: string[];
  /** Free bays seen at the primary stop last time, to notice it filling up. */
  lastFreeBays: number | null;
  /** What PlugOrbit did, oldest first. */
  log: TripLogEntry[];
  /** Event keys already raised, so each moment is raised once. */
  emitted: string[];
  lastCriticalAt: number | null;
  stats: TripStats;
  endedAt: number | null;
};

/** The saved copy of a trip's charging plan for weak-signal stretches. */
export type OfflineStop = {
  role: 'primary' | 'backup';
  stopIndex: number;
  stationId: string;
  name: string;
  operator: string;
  address: string;
  latitude: number;
  longitude: number;
  connectorId: string;
  connectorLabel: string;
  connectorType: string;
  powerKw: number;
  /** Last-known status, with who vouched for it and when. */
  statusSource: string;
  statusUpdatedAt: number | null;
  freeBays: number | null;
  totalBays: number;
  pricePerKwh: number | null;
  priceUpdatedAt: number | null;
  /** How to start: the operator's own words, or PlugOrbit's QR flow. */
  accessInstructions: string;
  /** Who to contact when something is wrong. */
  help: string;
  /** Km from the driver's position when saved, for "follow the saved route". */
  kmAhead: number;
};

export type OfflineTripSnapshot = {
  tripId: string;
  savedAt: number;
  origin: string;
  destination: string;
  vehicleName: string;
  totalKm: number;
  km: number;
  route: Route;
  stops: OfflineStop[];
};
