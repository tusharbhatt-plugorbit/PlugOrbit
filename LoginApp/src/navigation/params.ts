// Single source of truth for every route and its params. A route name with
// `undefined` params takes none; `X | undefined` means params are optional.

export type TabName = 'Home' | 'Trips' | 'Charge' | 'Activity' | 'Profile';

export type RouteParams = {
  // Tab roots
  Home: undefined;
  Trips: undefined;
  Charge: undefined;
  Activity: {segment?: 'sessions' | 'tickets'} | undefined;
  Profile: undefined;

  // MVP
  VehicleSetup: {onboarding?: boolean; vehicleId?: string} | undefined; // 01
  ManualSoc: {onboarding?: boolean} | undefined; // 02
  StationList: {query?: string} | undefined; // 04
  Filters: undefined; // 05
  StationDetail: {stationId: string}; // 06
  Compare: {stationIds: string[]}; // 07
  RoutePlanner: {toLabel?: string; fromLabel?: string} | undefined; // 08
  RouteResult: undefined; // 09 (reads the cached active route)
  BackupAlert:
    | {
        /** The charger the driver is heading to; the alert is about this one. */
        stationId?: string;
        stopIndex?: number;
        reason?: 'occupied' | 'offline';
      }
    | undefined; // 10
  Navigation: {stationId: string; stopIndex?: number}; // 11
  ScanQr: {stationId?: string} | undefined; // 12
  StartCharging: {
    stationId: string;
    connectorId: string;
    /** Smart Drive's recommended target, prefilled instead of the default 80. */
    targetSoc?: number;
  }; // 13
  ActiveSession: undefined; // 14
  Payment: {sessionId: string}; // 15
  PaymentFailure: {sessionId: string}; // 16
  Receipt: {sessionId: string}; // 17
  SessionDetail: {sessionId: string}; // 19
  Feedback: {sessionId: string}; // 20
  ReportProblem: {stationId?: string; sessionId?: string} | undefined; // 21
  Support: undefined; // 22
  TicketDetail: {ticketId: string}; // 23
  Vehicles: undefined; // Profile > Vehicles (24)
  PaymentMethods: undefined; // Profile > Payment methods
  Language: undefined; // Profile > Language

  // Phase 2
  Saved: undefined; // 25
  Reservation: {stationId: string}; // 26
  Queue: {stationId: string}; // 27
  EnergyPlanner: undefined; // 28
  Alerts: undefined; // 29
  Plus: undefined; // 30

  // Later
  Roadside: undefined; // 31
  AutoSoc: undefined; // 32
  Forecast: {stationId: string}; // 33

  // Extra
  CostCalculator: {stationId?: string} | undefined; // 34
  OfflineMode: undefined; // 35
  Community: {stationId: string}; // 36
  Notifications: undefined; // 37
  TripPreferences: undefined; // 38
  MultiStop: undefined; // 39
  Privacy: undefined; // 40

  // Smart Drive
  SmartDrive: undefined; // the co-pilot: plan a trip, or watch the one in progress
  SmartDriveStop: undefined; // why this charger, what it costs, ask the co-pilot

  // Demo
  PresenterTools: undefined;
};

export type RouteName = keyof RouteParams;

export const TABS: readonly TabName[] = [
  'Home',
  'Trips',
  'Charge',
  'Activity',
  'Profile',
];

export function isTab(name: RouteName): name is TabName {
  return (TABS as readonly string[]).includes(name);
}

export type NavArgs<K extends RouteName> = undefined extends RouteParams[K]
  ? [params?: RouteParams[K]]
  : [params: RouteParams[K]];
