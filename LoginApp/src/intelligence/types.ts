import type {
  Confidence,
  ConnectorType,
  Station,
  TrustLevel,
  Vehicle,
  WaitEstimate,
} from '../domain/types';
import type {Coords} from '../utils/geo';

/**
 * Vocabulary shared by every Smart Drive engine. Nothing here touches React,
 * the store or a service, so the same modules can run on a server.
 */

/** Two separate ideas, deliberately: see docs/SMART_DRIVE.md "Two confidences". */
export type DataConfidence = TrustLevel;
export type ChargeConfidence = 'high' | 'medium' | 'low';

export type Range = {min: number; max: number};

/** A battery level as a band, never a falsely precise single number. */
export type SocRange = {expected: number; low: number; high: number};

export type DriveMode = 'normal' | 'battery_critical';

/** Conditions that change how much battery a kilometre costs. All optional. */
export type DriveConditions = {
  /** Average road speed. Default 66 km/h. */
  speedKmh?: number;
  /** >= 1. Traffic stretches the time, not the energy. */
  trafficDelayFactor?: number;
  temperatureC?: number;
  hvacOn?: boolean;
  /** Total climb on the remaining route. */
  elevationGainM?: number;
};

// ------------------------------------------------------------------ safety --

/** A hard "no": a candidate with any of these is never recommended. */
export type SafetyViolationCode =
  | 'CONNECTOR_UNCONFIRMED'
  | 'INCOMPATIBLE_CONNECTOR'
  | 'UNREACHABLE'
  | 'BELOW_RESERVE'
  | 'CHARGER_OFFLINE'
  | 'CLOSED_AT_ARRIVAL';

/** A caveat that lowers confidence but does not forbid the stop. */
export type SafetyWarningCode =
  | 'HOURS_UNKNOWN'
  | 'STATUS_UNKNOWN'
  | 'STATUS_STALE'
  | 'PRICE_UNKNOWN'
  | 'OPERATOR_APP_REQUIRED'
  | 'RESERVE_BREACH_ACCEPTED';

export type SafetyViolation = {code: SafetyViolationCode; detail: string};

// -------------------------------------------------------- recommendation ----

/** Machine-readable "why", translated to words by `reasonLabel`. */
export type ReasonCode =
  | 'REASON_COMPATIBLE'
  | 'REASON_REACHABLE_SAFELY'
  | 'REASON_SAFEST_REACHABLE'
  | 'REASON_LOW_DETOUR'
  | 'REASON_HIGH_RELIABILITY'
  | 'REASON_LIVE_AVAILABILITY'
  | 'REASON_FASTER_TRIP'
  | 'REASON_FAST_FOR_YOUR_CAR'
  | 'REASON_LOWER_COST'
  | 'REASON_AMENITIES'
  | 'REASON_OPEN_24_7'
  | 'REASON_STRONG_BACKUP'
  | 'REASON_FEWER_STOPS';

export type ScoreComponent =
  | 'compatibility'
  | 'reachability'
  | 'reliability'
  | 'availability'
  | 'freshness'
  | 'routeFit'
  | 'stopTime'
  | 'speed'
  | 'cost'
  | 'backup'
  | 'amenities'
  | 'timing'
  | 'proximity'
  | 'continuation';

export type Weights = Record<ScoreComponent, number>;

/**
 * How the driver likes to be served. `balanced` is the default. A profile only
 * reshapes the weights between SAFE candidates; it can never make an unsafe one
 * eligible, and it is ignored entirely in battery-critical mode.
 */
export type PreferenceProfile =
  | 'balanced'
  | 'fastest'
  | 'cheapest'
  | 'reliable'
  | 'comfort';

// ----------------------------------------------------------- stop metrics --

export type StopCost = {
  /** null when the operator has not published a price. */
  energyInr: number | null;
  /** null: parking fees are not published for any charger yet. */
  parkingInr: number | null;
  /** Expected idle fee if you leave on time: zero. Exposure is shown in the UI. */
  idleInr: number;
  platformInr: number;
  taxInr: number | null;
  /** null when the energy price is unknown: never a partial sum as the bill. */
  totalInr: number | null;
};

export type StopMetrics = {
  connectorId: string;
  connectorLabel: string;
  connectorType: ConnectorType;
  /** What the charger advertises. */
  chargerKw: number;
  /** The average this car will really draw over the session. */
  expectedKw: number;
  arriveSoc: SocRange;
  targetSoc: number;
  /** Why the target is what it is, for the "charge just enough" explanation. */
  targetReason: 'finish_trip' | 'reach_next_stop' | 'best_effort';
  /** Minutes saved versus charging to the 80% comfort cap; null when none. */
  savedVsCapMin: number | null;
  chargeMinutes: Range;
  detourMin: number;
  rejoinMin: number;
  wait: WaitEstimate;
  totalStopMin: Range;
  cost: StopCost;
  etaAt: number;
  etaMin: number;
  /** Road km from the driver to the stop, including the side road. */
  distanceFromDriverKm: number;
};

export type ScoredStop = {
  station: Station;
  alongKm: number;
  lateralKm: number;
  metrics: StopMetrics;
  /** 0-100. Explainable and comparable only within one plan. */
  score: number;
  components: Record<ScoreComponent, number>;
  reasons: ReasonCode[];
  warnings: SafetyWarningCode[];
  dataConfidence: DataConfidence;
  chargeConfidence: ChargeConfidence;
  continuation: {
    stopsAfter: number;
    feasible: boolean;
    /** True when only charging past the comfort cap makes the trip possible. */
    beyondCap?: boolean;
  };
};

export type BackupStop = ScoredStop & {
  /** Extra minutes of total stop time versus the primary (>= 0). */
  extraMin: number;
  /** 0-1: how good a Plan B this is, not how good a charger it is. */
  strength: number;
  /** A different operator and site, so one outage cannot take out both. */
  independent: boolean;
  /** Battery left on arriving at the backup from the primary. */
  fromPrimarySoc: SocRange;
};

export type RuledOut = {
  stationId: string;
  stationName: string;
  codes: SafetyViolationCode[];
};

export type SwitchInfo = {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  reason: 'safety' | 'time_saved' | 'better_score';
  /** Minutes saved by switching; 0 for a safety switch. */
  minutesSaved: number;
};

export type Readiness = 'good_to_drive' | 'charge_first' | 'limited_options';

export type RouteRisk = 'low' | 'medium' | 'high';

export type ChargingPlan = {
  computedAt: number;
  mode: DriveMode;
  /** Why the mode is critical, when it is. */
  modeReason: 'low_battery' | 'no_safe_option_with_reserve' | null;
  progressKm: number;
  socNow: number;
  remainingKm: number;
  readiness: Readiness;
  /** True when the battery cannot finish this trip without a stop. */
  chargingRequired: boolean;
  destination: {
    etaAt: number;
    socWithoutCharging: SocRange;
    /**
     * Battery on arrival if the plan is followed. Null when the trip needs
     * more than one stop (or cannot be finished), where one number would
     * pretend to a precision we do not have.
     */
    socWithPlan: SocRange | null;
  };
  primary: ScoredStop | null;
  backup: BackupStop | null;
  /** Other safe options, best first (feeds "Find me something cheaper"). */
  alternatives: ScoredStop[];
  /** Safe options still ahead and within reach: the safety net. */
  safetyNet: number;
  stopsAfterPrimary: number;
  considered: number;
  ruledOut: RuledOut[];
  /** Safe but pointless yet: stops that would add almost nothing this early. */
  tooEarly: string[];
  routeRisk: RouteRisk;
  /** The honest "reliable charging options are limited here" flag. */
  limitedOptions: boolean;
  /** Present when this plan changed the primary from the previous one. */
  switched: SwitchInfo | null;
  /** A better stop existed but not by enough to justify changing the plan. */
  held: {stationId: string; stationName: string; minutesSaved: number} | null;
};

// ------------------------------------------------------------------- trip ---

export type PlaceRef = {label: string; coords: Coords};

export type TripPhase =
  | 'ready'
  | 'driving'
  | 'approaching_stop'
  | 'at_stop'
  | 'charging'
  | 'continuing'
  | 'arrived';

export type MonitoringState = 'monitoring' | 'paused_offline' | 'ended';

export type LogKind = 'checked' | 'silent' | 'notified' | 'replanned';

/** One line of the co-pilot's ledger: what it saw and what it chose to do. */
export type LogEntry = {
  at: number;
  kind: LogKind;
  text: string;
};

export type ChargingSessionMirror = {
  stationId: string;
  startedAt: number;
  startSoc: number;
  targetSoc: number;
  reachedTargetAt: number | null;
};

/** What we predicted at the charger, kept to compare against reality. */
export type StopPrediction = {
  stationId: string;
  at: number;
  arriveSocExpected: number;
  waitMinutes: Range;
  chargeMinutes: Range;
  targetSoc: number;
  costInr: number | null;
};

export type TripActuals = {
  stationId: string | null;
  arriveSoc: number | null;
  waitMin: number | null;
  chargeMin: number | null;
  endSoc: number | null;
  startedOk: boolean | null;
  paymentOk: boolean | null;
};

export const EMPTY_ACTUALS: TripActuals = {
  stationId: null,
  arriveSoc: null,
  waitMin: null,
  chargeMin: null,
  endSoc: null,
  startedOk: null,
  paymentOk: null,
};

export type ActiveTrip = {
  tripId: string;
  /** TODO(integration): the signed-in account id once the backend has one. */
  userId: string;
  vehicleId: string;
  origin: PlaceRef;
  destination: PlaceRef;
  polyline: Coords[];
  totalKm: number;
  startedAt: number;
  startSoC: number;
  currentSoC: number;
  progressKm: number;
  position: {coords: Coords; source: 'simulated' | 'device'; at: number};
  distanceRemainingKm: number;
  eta: number;
  expectedDestinationSoC: SocRange;
  chargingRequired: boolean;
  primaryStop: ScoredStop | null;
  backupStop: BackupStop | null;
  expectedPrimaryArrival: number | null;
  expectedPrimaryArrivalSoC: SocRange | null;
  recommendedTargetSoC: number | null;
  estimatedChargingDuration: Range | null;
  estimatedWait: WaitEstimate | null;
  estimatedTotalStopTime: Range | null;
  estimatedCost: StopCost | null;
  chargeConfidence: ChargeConfidence | null;
  dataConfidence: DataConfidence | null;
  smartDriveEnabled: boolean;
  monitoringState: MonitoringState;
  routeRisk: RouteRisk;
  lastRecalculatedAt: number;

  // --- internal bookkeeping (still plain data, so it persists) ---
  plan: ChargingPlan;
  phase: TripPhase;
  network: 'online' | 'offline';
  lastOnlineAt: number;
  conditions: DriveConditions;
  profile: PreferenceProfile;
  preferAmenities: boolean;
  reservePct: number;
  /** Station the driver told us to keep, so we stop second-guessing it. */
  pinnedPrimaryId: string | null;
  /** Stops already used, so they are never planned again. */
  visitedStopIds: string[];
  /** The previous primary, kept so a switch can be undone. */
  lastChange: (SwitchInfo & {at: number; acknowledged: boolean}) | null;
  session: ChargingSessionMirror | null;
  arrivedAtStopAt: number | null;
  prediction: StopPrediction | null;
  /** What actually happened at the stop, to compare with `prediction`. */
  actuals: TripActuals;
  /** Notification dedupe: key to the epoch it last fired. */
  notified: Record<string, number>;
  log: LogEntry[];
  counters: {checks: number; told: number; silent: number; critical: number};
  simulated: boolean;
  /**
   * Trip time minus wall-clock time. Zero for a real drive; a simulated drive
   * runs ahead of the wall clock as the car "covers" distance.
   */
  clockOffsetMs: number;
  endedAt: number | null;
};

// ------------------------------------------------------------------ events --

export type TripEvent =
  | {type: 'TRIP_STARTED'; at: number}
  | {type: 'TICK'; at: number}
  | {type: 'BATTERY_UPDATED'; at: number; soc: number}
  | {type: 'LOCATION_UPDATED'; at: number; progressKm: number; soc?: number}
  | {
      type: 'CHARGER_STATUS_CHANGED';
      at: number;
      stationId: string;
      from: StationState;
      to: StationState;
    }
  | {type: 'CHARGER_BECAME_OFFLINE'; at: number; stationId: string}
  | {type: 'PRIMARY_CHARGER_OCCUPIED'; at: number; stationId: string}
  | {
      type: 'BACKUP_BECAME_BETTER';
      at: number;
      fromStationId: string;
      toStationId: string;
    }
  | {type: 'ROUTE_CHANGED'; at: number; conditions: DriveConditions}
  | {
      type: 'USER_NEAR_CHARGER';
      at: number;
      stationId: string;
      minutesAway: number;
    }
  | {
      type: 'SESSION_STARTED';
      at: number;
      stationId: string;
      startSoc: number;
      targetSoc: number;
    }
  | {type: 'TARGET_SOC_REACHED'; at: number; soc: number}
  | {type: 'SESSION_ENDED'; at: number; soc: number}
  | {type: 'PAYMENT_FAILED'; at: number}
  | {type: 'NETWORK_LOST'; at: number}
  | {type: 'NETWORK_RESTORED'; at: number}
  | {type: 'USER_SWITCHED_CHARGER'; at: number; stationId: string}
  | {type: 'USER_KEPT_ORIGINAL'; at: number}
  | {type: 'DESTINATION_REACHED'; at: number};

export type TripEventType = TripEvent['type'];

/** Coarse state of a station for this vehicle, used to detect changes. */
export type StationState = 'available' | 'busy' | 'offline' | 'unknown';

// ----------------------------------------------------------- notifications --

export type NotificationLevel = 'info' | 'action' | 'important' | 'critical';

export type NotificationKind =
  | 'ready_to_drive'
  | 'no_charge_needed_yet'
  | 'stop_approaching'
  | 'stop_imminent'
  | 'near_charger'
  | 'charger_getting_busy'
  | 'better_charger'
  | 'charger_unavailable'
  | 'backup_lost'
  | 'battery_critical'
  | 'limited_options'
  | 'charging_started'
  | 'enough_charge'
  | 'ready_to_continue'
  | 'payment_failed'
  | 'offline'
  | 'back_online'
  | 'arrived';

export type NotificationAction =
  | 'open_trip'
  | 'switch_route'
  | 'start_charging'
  | 'continue_trip'
  | 'charge_nearby';

export type NotificationDraft = {
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  cta: {label: string; action: NotificationAction} | null;
  dedupeKey: string;
  stationId: string | null;
  at: number;
};

export type Decision = {
  at: number;
  /** What was noticed, in plain words. */
  noticed: string;
  notify: boolean;
  /** Why we spoke up, or why we stayed quiet. */
  why: string;
  draft: NotificationDraft | null;
  /** Bookkeeping silence (duplicate, merged): not worth showing in the ledger. */
  noise?: boolean;
};

export type TripUpdate = {
  trip: ActiveTrip;
  /** At most one per event: the most important thing the driver should hear. */
  notifications: NotificationDraft[];
  decisions: Decision[];
  /** The event plus any the monitor derived from it, in order. */
  events: TripEvent[];
};

// --------------------------------------------------------------- injection --

/** The world the monitor sees. Supplied by a service, never fetched here. */
export type World = {
  now: number;
  stations: readonly Station[];
};

export type PlanVehicle = Pick<
  Vehicle,
  'id' | 'batteryKwh' | 'connectors' | 'maxDcKw' | 'maxAcKw' | 'rangeKm100'
>;

export type AvailabilityOutlook = {
  currentAvailability: 'available' | 'occupied' | 'offline' | 'unknown';
  /** null until a real model exists, or when asked too far ahead to say. */
  predictedAvailabilityAtArrival:
    | 'likely_available'
    | 'uncertain'
    | 'likely_busy'
    | null;
  predictionConfidence: Confidence | null;
  expectedArrivalTime: number;
  basis: 'rules' | 'model' | 'none';
};

// -------------------------------------------------- learning & persistence --

/** What a driver's pick said about them, relative to what we recommended. */
export type ChoiceLean = 'faster' | 'cheaper' | 'reliable' | 'amenities';

export type ChoiceSignal = {
  at: number;
  tripId: string;
  chosenId: string;
  recommendedId: string;
  leans: ChoiceLean[];
};

/** Prediction versus reality for one finished trip: the feedback loop's unit. */
export type TripOutcome = {
  tripId: string;
  endedAt: number;
  vehicleId: string;
  from: string;
  to: string;
  plannedStationId: string | null;
  actualStationId: string | null;
  followedPlan: boolean;
  predicted: {
    arriveSoc: number | null;
    waitMinutes: Range | null;
    chargeMinutes: Range | null;
    targetSoc: number | null;
    costInr: number | null;
  };
  actual: {
    arriveSoc: number | null;
    waitMinutes: number | null;
    chargeMinutes: number | null;
    endSoc: number | null;
    costInr: number | null;
    startedOk: boolean | null;
    paymentOk: boolean | null;
    rating: number | null;
  };
  error: {
    arriveSocPts: number | null;
    waitInRange: boolean | null;
    chargeInRange: boolean | null;
    costInr: number | null;
  };
  copilot: {checks: number; told: number; silent: number; switched: number};
};

export type SmartDrivePrefs = {
  /** Start trips with Smart Drive on. */
  enabled: boolean;
  /** `minimal` lets only plan changes and safety alerts through. */
  verbosity: 'calm' | 'minimal';
};

/** Everything Smart Drive persists. One slice of the app store. */
export type SmartDriveState = {
  trip: ActiveTrip | null;
  outcomes: TripOutcome[];
  signals: ChoiceSignal[];
  /** Ids of preference suggestions the driver dismissed. */
  dismissed: string[];
  prefs: SmartDrivePrefs;
};

export const INITIAL_SMART_DRIVE: SmartDriveState = {
  trip: null,
  outcomes: [],
  signals: [],
  dismissed: [],
  prefs: {enabled: true, verbosity: 'calm'},
};
