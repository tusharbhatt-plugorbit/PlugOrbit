import type {RouteName} from './params';

// Declared as a Record so adding a route to params.ts without listing it here
// is a compile error, which keeps deep-link validation complete.
const NAMES: Record<RouteName, true> = {
  Home: true,
  Trips: true,
  Charge: true,
  Activity: true,
  Profile: true,
  Map: true,
  SmartDrive: true,
  TripSummary: true,
  ChargePick: true,
  VehicleSetup: true,
  ManualSoc: true,
  StationList: true,
  Filters: true,
  StationDetail: true,
  Compare: true,
  RoutePlanner: true,
  RouteResult: true,
  BackupAlert: true,
  Navigation: true,
  ScanQr: true,
  StartCharging: true,
  ActiveSession: true,
  Payment: true,
  PaymentFailure: true,
  Receipt: true,
  SessionDetail: true,
  Feedback: true,
  ReportProblem: true,
  Support: true,
  TicketDetail: true,
  Vehicles: true,
  PaymentMethods: true,
  Language: true,
  Saved: true,
  Reservation: true,
  Queue: true,
  EnergyPlanner: true,
  Alerts: true,
  Plus: true,
  Roadside: true,
  AutoSoc: true,
  Forecast: true,
  CostCalculator: true,
  OfflineMode: true,
  Community: true,
  Notifications: true,
  TripPreferences: true,
  MultiStop: true,
  Privacy: true,
  PresenterTools: true,
};

export const ROUTE_NAMES = Object.keys(NAMES) as RouteName[];

export function isRouteName(value: string): value is RouteName {
  return value in NAMES;
}
