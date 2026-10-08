import type {ActiveTrip, OfflineTripSnapshot} from '../domain/activeTrip';
import type {SmartDrivePrefs} from '../domain/coDriver';
import type {DriverIntent, Recommendation} from '../domain/recommendation';
import type {
  AlertPreferences,
  AppNotification,
  BatteryReading,
  ChargingSession,
  CommunityUpdate,
  Forecast,
  PaymentMethod,
  PaymentResult,
  PreauthResult,
  PrivacyPreferences,
  ProblemReport,
  Reservation,
  QueueTicket,
  Route,
  RouteRequest,
  SessionSummary,
  Station,
  StationQuery,
  StationWithDistance,
  Ticket,
  TicketCategory,
  TripPreferences,
  Vehicle,
  WaitEstimate,
} from '../domain/types';
import type {Coords} from '../utils/geo';

/**
 * Service contracts. The mock implementations in ./mock back every screen today;
 * a real backend only has to implement these interfaces. Anything that needs a
 * charger-operator, payment-gateway or OEM integration is marked `TODO(integration)`.
 *
 * Rule of thumb for screens:
 *  - READ persisted user data (history, tickets, favourites, ...) from the app
 *    store with selectors (instant, works offline).
 *  - READ discovery data (stations, routes, forecasts, community) and DO every
 *    action through a service (async, can fail, can be offline).
 */

export class OfflineError extends Error {
  constructor(message = 'You are offline.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export class ApiError extends Error {
  constructor(message = 'Something went wrong on our side. Try again.') {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The id doesn't resolve to a charger we can show right now: removed, or a
 * Google Maps charger that isn't among the results we last loaded. Still an
 * ApiError (same `name`) so generic error copy keeps working.
 */
export class StationNotFoundError extends ApiError {
  constructor(message = 'This charger isn’t available right now.') {
    super(message);
  }
}

export class IntegrationUnavailableError extends Error {
  constructor(message = 'Remote start is not available for this charger.') {
    super(message);
    this.name = 'IntegrationUnavailableError';
  }
}

export type VehicleModel = Omit<Vehicle, 'id'> & {modelId: string};

export interface VehicleService {
  catalog(): Promise<VehicleModel[]>;
  /** Persist a vehicle (adds or updates) and make it active. */
  save(vehicle: Omit<Vehicle, 'id'> & {id?: string}): Promise<Vehicle>;
  setActive(vehicleId: string): Promise<void>;
  remove(vehicleId: string): Promise<void>;
  setBattery(percent: number): Promise<BatteryReading>;
  /** TODO(integration): OEM account / Bluetooth OBD reading. */
  connectVehicle(method: 'oem' | 'obd'): Promise<BatteryReading>;
  disconnectVehicle(): Promise<void>;
}

export interface StationService {
  nearby(query: StationQuery): Promise<StationWithDistance[]>;
  get(stationId: string, origin?: Coords): Promise<StationWithDistance>;
  search(
    text: string,
    origin: Coords,
    vehicle: Vehicle | null,
  ): Promise<StationWithDistance[]>;
  /**
   * Pass the active vehicle so the estimate is for connectors it can use
   * (a free CHAdeMO bay is no help to a CCS2-only car).
   */
  waitEstimate(
    stationId: string,
    vehicle?: Vehicle | null,
  ): Promise<WaitEstimate>;
  /** TODO(integration): operator occupancy history model. */
  forecast(stationId: string): Promise<Forecast>;
  community(stationId: string): Promise<CommunityUpdate[]>;
  confirmStatus(
    stationId: string,
    kind: CommunityUpdate['kind'],
  ): Promise<CommunityUpdate>;
  report(report: ProblemReport): Promise<{ticketId: string}>;
  /** Join the queue / leave it (TODO(integration): operator queue API). */
  joinQueue(stationId: string): Promise<QueueTicket>;
  leaveQueue(): Promise<void>;
  /** TODO(integration): operator reservation API. */
  reserve(
    stationId: string,
    arrivalAt: number,
    holdMinutes: number,
  ): Promise<Reservation>;
  cancelReservation(): Promise<void>;
}

export type EnergyPlan = {
  route: Route;
  /** SoC after each leg: start, then arrival at each stop, then destination. */
  legs: ReadonlyArray<{
    label: string;
    socPercent: number;
    kind: 'start' | 'stop' | 'arrive';
  }>;
  /** Share of battery kept as reserve at the lowest point. */
  lowestSocPercent: number;
};

export interface RouteService {
  plan(request: RouteRequest): Promise<Route>;
  energyPlan(request: RouteRequest): Promise<EnergyPlan>;
  /** Re-plan a stop onto its backup; returns the updated route. */
  switchToBackup(route: Route, stopIndex: number): Promise<Route>;
  /** Known destinations for the search suggestions. */
  suggestions(text: string): Promise<string[]>;
}

export type StartChargingInput = {
  stationId: string;
  connectorId: string;
  targetSoc: number;
  paymentMethodId: string;
};

export interface SessionService {
  /**
   * Remote start. Requires a validated payment method and a successful
   * pre-authorisation. Throws IntegrationUnavailableError on external stations.
   * TODO(integration): charger CMS (OCPP) remote-start.
   */
  start(input: StartChargingInput): Promise<ChargingSession>;
  stop(sessionId: string): Promise<ChargingSession>;
  /** Mark an unfinished authorising session as failed after a restart. */
  cancelPending(): Promise<void>;
  feedback(
    sessionId: string,
    feedback: {
      chargerWorked: boolean;
      rating: number;
      confirmedStatus: boolean;
    },
  ): Promise<void>;
}

export interface PaymentService {
  methods(): Promise<PaymentMethod[]>;
  addMethod(
    method: Omit<PaymentMethod, 'id' | 'validated' | 'isDefault'>,
  ): Promise<PaymentMethod>;
  setDefault(methodId: string): Promise<void>;
  /** TODO(integration): payment gateway pre-authorisation. */
  preauthorise(amountInr: number, methodId: string): Promise<PreauthResult>;
  /** TODO(integration): capture against the pre-authorisation. */
  pay(sessionId: string, methodId: string): Promise<PaymentResult>;
}

export interface SupportService {
  createTicket(input: {
    category: TicketCategory;
    title: string;
    message: string;
    linkedSessionId: string | null;
  }): Promise<Ticket>;
  reply(ticketId: string, text: string): Promise<Ticket>;
}

export interface NotificationService {
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface PreferencesService {
  setTripPreferences(prefs: TripPreferences): Promise<void>;
  setAlerts(prefs: AlertPreferences): Promise<void>;
  /** How Smart Drive behaves and how much it speaks. */
  setSmartDrive(prefs: SmartDrivePrefs): Promise<void>;
  setPrivacy(prefs: PrivacyPreferences): Promise<void>;
  /** TODO(integration): billing for PlugOrbit Plus. */
  setPlus(active: boolean): Promise<void>;
  eraseHistory(): Promise<void>;
}

/**
 * The decision engine as a service: "which charger should THIS driver use?"
 * Reads the active vehicle, battery and reserve itself, so a screen only says
 * what the driver wants (nearby, or battery critical) and from where.
 * Planned trips get their stops from the route service; the engine then
 * explains and monitors them (see TripService).
 */
export interface RecommendationService {
  recommend(input: {
    intent: Exclude<DriverIntent, 'plan_trip'>;
    origin: Coords;
    /** Charge target to price and time the stop for; default depends on intent. */
    targetSoc?: number;
  }): Promise<Recommendation>;
}

/**
 * The journey PlugOrbit is co-driving. Smart Drive in code: start a trip, keep
 * watching its charging stop, move to the backup when it can't be relied on,
 * and stay correct through charging and across restarts.
 *
 * Mocked: positions come from `advance` (a simulated drive; a GPS feed calls the
 * same method) and station statuses from the mock station service.
 */
export interface TripService {
  /** Begin co-driving `route`. Throws TripInProgressError unless `replace`. */
  start(input: {
    route: Route;
    smartDrive: boolean;
    replace?: boolean;
  }): Promise<ActiveTrip>;
  /**
   * Look at the planned stop and its backup again. Never throws for network
   * trouble: with no signal the trip flips to offline mode and keeps its plan.
   */
  refresh(): Promise<ActiveTrip | null>;
  /** The car moved to `km` along the route (monotonic). */
  advance(km: number): Promise<ActiveTrip | null>;
  /**
   * Take the suggested switch, or switch to the planned backup when none was
   * suggested. Throws if it can't be done right now (for example offline).
   */
  acceptSwitch(): Promise<ActiveTrip>;
  /** "I'll stay with my charger": don't offer the same move again. */
  dismissSwitch(): Promise<ActiveTrip | null>;
  setSmartDrive(enabled: boolean): Promise<ActiveTrip | null>;
  /** The driver corrected the battery reading. */
  updateBattery(percent: number): Promise<ActiveTrip | null>;
  /** Arrived, or ending early: archive the trip and clear the plan. */
  finish(): Promise<void>;
}

/** The charging plan kept on the phone for dead zones (no network needed). */
export interface OfflineTripService {
  load(): OfflineTripSnapshot | null;
  clear(): void;
}

export type Services = {
  vehicle: VehicleService;
  station: StationService;
  route: RouteService;
  session: SessionService;
  payment: PaymentService;
  support: SupportService;
  notification: NotificationService;
  preferences: PreferencesService;
  recommendation: RecommendationService;
  trip: TripService;
  offline: OfflineTripService;
};

export type {AppNotification, SessionSummary, Station};
