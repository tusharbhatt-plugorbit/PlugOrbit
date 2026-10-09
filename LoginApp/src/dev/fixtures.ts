import type {RouteName, RouteParams} from '../navigation/params';

/**
 * A valid set of params for every route, used by the crawl test and the web
 * preview harness to open any screen directly. IDs refer to mock data.
 */
export const ROUTE_FIXTURES: {[K in RouteName]: RouteParams[K]} = {
  Home: undefined,
  Trips: undefined,
  Charge: undefined,
  Activity: undefined,
  Profile: undefined,

  VehicleSetup: undefined,
  ManualSoc: undefined,
  StationList: undefined,
  Filters: undefined,
  StationDetail: {stationId: 'st-chargezone-neemrana'},
  Compare: {
    stationIds: [
      'st-chargezone-neemrana',
      'st-statiq-bawal',
      'st-chargezone-manesar',
    ],
  },
  RoutePlanner: undefined,
  RouteResult: undefined,
  BackupAlert: undefined,
  Navigation: {stationId: 'st-chargezone-neemrana'},
  ScanQr: undefined,
  StartCharging: {
    stationId: 'st-chargezone-neemrana',
    connectorId: 'st-chargezone-neemrana-c2',
  },
  ActiveSession: undefined,
  Payment: {sessionId: 'PO-LIVE01'},
  PaymentFailure: {sessionId: 'PO-LIVE01'},
  Receipt: {sessionId: 'PO-6A4K92'},
  SessionDetail: {sessionId: 'PO-6A4K92'},
  Feedback: {sessionId: 'PO-6A4K92'},
  ReportProblem: {stationId: 'st-chargezone-neemrana'},
  Support: undefined,
  TicketDetail: {ticketId: 'tk-142'},
  Vehicles: undefined,
  PaymentMethods: undefined,
  Language: undefined,

  Saved: undefined,
  Reservation: {stationId: 'st-chargezone-neemrana'},
  Queue: {stationId: 'st-chargezone-sec16'},
  EnergyPlanner: undefined,
  Alerts: undefined,
  Plus: undefined,

  Roadside: undefined,
  AutoSoc: undefined,
  Forecast: {stationId: 'st-chargezone-neemrana'},

  CostCalculator: undefined,
  OfflineMode: undefined,
  Community: {stationId: 'st-chargezone-neemrana'},
  Notifications: undefined,
  TripPreferences: undefined,
  MultiStop: undefined,
  Privacy: undefined,

  SmartDrive: undefined,
  SmartDriveStop: undefined,

  PresenterTools: undefined,
};

/** Routes that need an in-flight session in the store to render meaningfully. */
export const NEEDS_SESSION: ReadonlyArray<RouteName> = [
  'ActiveSession',
  'Payment',
  'PaymentFailure',
];
