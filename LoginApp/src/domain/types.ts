import type {Coords} from '../utils/geo';

// ---------------------------------------------------------------- vehicles --

export type ConnectorType = 'CCS2' | 'Type2' | 'CHAdeMO' | 'GBT' | 'LECCS';

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  variant: string;
  batteryKwh: number;
  /** Connectors the car can physically use. Drives the compatibility filter. */
  connectors: readonly ConnectorType[];
  maxDcKw: number;
  maxAcKw: number;
  /** Real-world range at 100% in km (used for estimates, never for guarantees). */
  rangeKm100: number;
};

export type SocSource = 'manual' | 'vehicle';

export type BatteryReading = {
  /** 0-100. */
  percent: number;
  source: SocSource;
  updatedAt: number;
};

// ---------------------------------------------------------------- stations --

export type ConnectorStatus =
  | 'available'
  | 'occupied'
  | 'offline'
  | 'reserved'
  | 'unknown';

export type StationConnector = {
  id: string;
  label: string;
  type: ConnectorType;
  powerKw: number;
  status: ConnectorStatus;
  pricePerKwh: number | null;
  idleFeePerMin: number | null;
};

/**
 * Where a status/price came from. "LIVE" may only ever be shown for
 * `operator_feed` data that is still fresh (see `dataTrust`).
 */
export type FeedSource =
  | 'operator_feed'
  | 'google_places'
  | 'user_report'
  | 'estimate'
  | 'none';

export type FeedInfo = {
  source: FeedSource;
  /** Epoch ms of the last update, or null when unknown. */
  updatedAt: number | null;
};

export type TrustLevel = 'live' | 'estimated' | 'user' | 'unknown';

export type Amenity =
  | 'restroom'
  | 'cafe'
  | 'food'
  | 'shopping'
  | 'parking'
  | 'wifi'
  | 'lounge'
  | 'shade';

/**
 * `integrated`: PlugOrbit controls the session (remote start + payment).
 * `external`: the operator's own app/QR/payment is used; we only guide.
 */
export type IntegrationMode = 'integrated' | 'external';

export type Station = {
  id: string;
  name: string;
  operator: string;
  address: string;
  latitude: number;
  longitude: number;
  /** 0-5 driver rating; 0 means "not rated" (never invent one). */
  rating: number;
  /** Share of recent sessions that started and finished without a fault. */
  successfulSessionsPct: number;
  /**
   * Organic reliability 0-100, never influenced by sponsorship. 0 means
   * unknown (Google Maps chargers carry no reliability data).
   */
  reliabilityPct: number;
  sponsored: boolean;
  hours: string;
  amenities: readonly Amenity[];
  /**
   * Empty when the source doesn't say which connectors exist (Google Maps
   * without EV data). Such a charger is "unconfirmed", never "compatible".
   */
  connectors: readonly StationConnector[];
  integration: IntegrationMode;
  /** Operator instructions shown for external stations. */
  operatorInstructions: string | null;
  statusFeed: FeedInfo;
  priceFeed: FeedInfo;
};

export type StationWithDistance = Station & {
  distanceKm: number;
  /** Extra minutes versus the current route/straight drive. */
  detourMin: number;
};

export type StationQuery = {
  origin: Coords;
  vehicle: Vehicle | null;
  /** Include chargers the active vehicle cannot use (default false). */
  includeIncompatible?: boolean;
};

export type StationFilters = {
  availableOnly: boolean;
  connector: ConnectorType | 'any';
  minPowerKw: number;
  maxPricePerKwh: number | null;
  amenities: readonly Amenity[];
  includeIncompatible: boolean;
};

// ------------------------------------------------------------------- waits --

export type Confidence = 'low' | 'medium' | 'high';

/** Wait times are always a range with a confidence label, never one number. */
export type WaitEstimate = {
  minMinutes: number;
  maxMinutes: number;
  confidence: Confidence;
  /**
   * `live_queue`: a fresh operator feed. `reported`: a bay was last reported
   * free by something other than a live feed (estimate, driver, stale feed).
   * `history`: how long sessions usually last. `none`: not enough data.
   */
  basis: 'live_queue' | 'reported' | 'history' | 'none';
};

// ------------------------------------------------------------------ routes --

export type RouteStrategy = 'fastest' | 'cheapest' | 'reliable';

export type RouteStop = {
  station: StationWithDistance;
  connectorId: string;
  /**
   * Every recommended stop ships with a backup. It is null only when no
   * compatible charger lies within a short detour that the arrival battery
   * could reach; `backupNote` then says so and the UI must warn, not hide it.
   */
  backup: StationWithDistance | null;
  /** Extra minutes to reach the backup; 0 when there is none. */
  backupExtraMin: number;
  backupNote?: string;
  /** Whole percent, so the plan never prints 70.35%. */
  arriveSoc: number;
  chargeToSoc: number;
  chargeMin: number;
  detourMin: number;
  /** Null when the chosen connector has no published price. */
  costInr: number | null;
  wait: WaitEstimate;
};

export type Route = {
  id: string;
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  driveMin: number;
  startSoc: number;
  arriveSoc: number;
  safetyReservePct: number;
  strategy: RouteStrategy;
  polyline: readonly Coords[];
  stops: readonly RouteStop[];
  /** Intermediate places of a multi-stop trip, kept so a re-plan keeps them. */
  via?: readonly string[];
  /** Epoch ms the route was computed; used for cache age labels. */
  computedAt: number;
};

export type RouteRequest = {
  fromLabel: string;
  toLabel: string;
  startSoc: number;
  strategy: RouteStrategy;
  vehicle: Vehicle;
  safetyReservePct: number;
  avoidPaidParking: boolean;
  /** Intermediate destinations for multi-stop trips. */
  via?: readonly string[];
};

// ---------------------------------------------------------------- sessions --

export type SessionStatus =
  | 'authorising'
  | 'active'
  | 'stopped'
  | 'payment_due'
  | 'payment_failed'
  | 'paid';

export type ChargingSession = {
  id: string;
  stationId: string;
  stationName: string;
  connectorId: string;
  connectorLabel: string;
  connectorType: ConnectorType;
  powerKw: number;
  pricePerKwh: number;
  batteryKwh: number;
  startSoc: number;
  targetSoc: number;
  /** Epoch ms charging started (demo clock is derived from this). */
  startedAt: number;
  /** Set once stopped; freezes the metrics. */
  stoppedAt: number | null;
  status: SessionStatus;
  paymentMethodId: string | null;
  preauthId: string | null;
  preauthAmountInr: number;
  receiptNo: string | null;
  /** Last payment failure reason, for the recovery screen. */
  failureReason: string | null;
};

export type SessionMetrics = {
  socPercent: number;
  energyKwh: number;
  elapsedMin: number;
  costInr: number;
  minToTarget: number;
  reachedTarget: boolean;
};

export type SessionSummary = {
  id: string;
  stationName: string;
  startedAt: number;
  energyKwh: number;
  durationMin: number;
  costInr: number;
  receiptNo: string;
  status: 'paid' | 'refunded' | 'payment_due';
  startSoc: number;
  endSoc: number;
  connectorLabel: string;
  powerKw: number;
  pricePerKwh: number;
};

// ---------------------------------------------------------------- payments --

export type PaymentMethodKind = 'upi' | 'card' | 'wallet';

export type PaymentMethod = {
  id: string;
  kind: PaymentMethodKind;
  label: string;
  detail: string;
  /** Validated = can be used for a PlugOrbit-controlled remote start. */
  validated: boolean;
  isDefault: boolean;
};

export type PreauthResult =
  | {ok: true; preauthId: string; amountInr: number}
  | {ok: false; reason: PaymentFailureReason; message: string};

export type PaymentResult =
  | {ok: true; receiptNo: string; chargedInr: number}
  | {ok: false; reason: PaymentFailureReason; message: string};

export type PaymentFailureReason =
  | 'declined'
  | 'insufficient_funds'
  | 'network'
  | 'bank_unavailable'
  | 'no_method';

// ----------------------------------------------------------------- support --

export type TicketCategory = 'charging' | 'payment' | 'station' | 'other';

export type TicketStatus = 'open' | 'in_review' | 'resolved';

export type TicketMessage = {
  id: string;
  from: 'user' | 'support';
  text: string;
  at: number;
};

export type Ticket = {
  id: string;
  number: string;
  category: TicketCategory;
  title: string;
  status: TicketStatus;
  linkedSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: readonly TicketMessage[];
};

export type ProblemKind =
  | 'offline'
  | 'broken_connector'
  | 'wrong_price'
  | 'access_blocked'
  | 'other';

export type ProblemReport = {
  stationId: string;
  kind: ProblemKind;
  note: string;
  hasPhoto: boolean;
};

// ----------------------------------------------------------- notifications --

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  /** Where tapping it should go. */
  target: {route: string; params?: Record<string, unknown>} | null;
};

// ------------------------------------------------------------- preferences --

export type TripPreferences = {
  minArrivalSocPct: number;
  strategy: RouteStrategy;
  avoidPaidParking: boolean;
  preferAmenities: boolean;
};

export type AlertPreferences = {
  started: boolean;
  reached80: boolean;
  ended: boolean;
  paymentDone: boolean;
  idleFeeWarning: boolean;
};

export type PrivacyPreferences = {
  preciseLocation: boolean;
  vehicleBatteryData: boolean;
  history: boolean;
  personalisedOffers: boolean;
};

export type CommunityUpdate = {
  id: string;
  stationId: string;
  kind: 'working' | 'bay_blocked' | 'price_confirmed' | 'busy';
  text: string;
  at: number;
  /** True when it came from a signed-in PlugOrbit user rather than a feed. */
  userConfirmed: boolean;
};

export type SavedRoute = {
  id: string;
  fromLabel: string;
  toLabel: string;
  strategy: RouteStrategy;
  savedAt: number;
};

export type Reservation = {
  id: string;
  stationId: string;
  stationName: string;
  connectorLabel: string;
  /** Epoch ms of the chosen arrival slot. */
  arrivalAt: number;
  holdMinutes: number;
  status: 'held' | 'cancelled' | 'expired';
  createdAt: number;
};

export type QueueTicket = {
  id: string;
  stationId: string;
  stationName: string;
  position: number;
  joinedAt: number;
  wait: WaitEstimate;
  backupStationName: string;
  backupExtraMin: number;
};

export type Forecast = {
  stationId: string;
  freeNow: number;
  total: number;
  /** Probability of at least one free bay in each of the next 60 minutes, 0-1. */
  next60: readonly number[];
  confidence: Confidence;
  basis: 'history' | 'none';
};
