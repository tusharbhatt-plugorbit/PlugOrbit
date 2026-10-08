import type {Registry} from './AppNavigator';

import ActivityScreen from '../screens/activity/ActivityScreen';
import AlertsScreen from '../screens/activity/AlertsScreen';
import FeedbackScreen from '../screens/activity/FeedbackScreen';
import NotificationsScreen from '../screens/activity/NotificationsScreen';
import ReportProblemScreen from '../screens/activity/ReportProblemScreen';
import RoadsideScreen from '../screens/activity/RoadsideScreen';
import SessionDetailScreen from '../screens/activity/SessionDetailScreen';
import SupportScreen from '../screens/activity/SupportScreen';
import TicketDetailScreen from '../screens/activity/TicketDetailScreen';
import ActiveSessionScreen from '../screens/charge/ActiveSessionScreen';
import ChargePickScreen from '../screens/charge/ChargePickScreen';
import ChargeScreen from '../screens/charge/ChargeScreen';
import PaymentFailureScreen from '../screens/charge/PaymentFailureScreen';
import PaymentScreen from '../screens/charge/PaymentScreen';
import QueueScreen from '../screens/charge/QueueScreen';
import ReceiptScreen from '../screens/charge/ReceiptScreen';
import ReservationScreen from '../screens/charge/ReservationScreen';
import ScanQrScreen from '../screens/charge/ScanQrScreen';
import StartChargingScreen from '../screens/charge/StartChargingScreen';
import CommunityScreen from '../screens/discover/CommunityScreen';
import CompareScreen from '../screens/discover/CompareScreen';
import CostCalculatorScreen from '../screens/discover/CostCalculatorScreen';
import FiltersScreen from '../screens/discover/FiltersScreen';
import ForecastScreen from '../screens/discover/ForecastScreen';
import SavedScreen from '../screens/discover/SavedScreen';
import StationDetailScreen from '../screens/discover/StationDetailScreen';
import StationListScreen from '../screens/discover/StationListScreen';
import HomeScreen from '../screens/home/HomeScreen';
import MapScreen from '../screens/home/MapScreen';
import LanguageScreen from '../screens/profile/LanguageScreen';
import PaymentMethodsScreen from '../screens/profile/PaymentMethodsScreen';
import PlusScreen from '../screens/profile/PlusScreen';
import PresenterToolsScreen from '../screens/profile/PresenterToolsScreen';
import PrivacyScreen from '../screens/profile/PrivacyScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import BackupAlertScreen from '../screens/trip/BackupAlertScreen';
import EnergyPlannerScreen from '../screens/trip/EnergyPlannerScreen';
import MultiStopScreen from '../screens/trip/MultiStopScreen';
import NavigationScreen from '../screens/trip/NavigationScreen';
import OfflineModeScreen from '../screens/trip/OfflineModeScreen';
import RoutePlannerScreen from '../screens/trip/RoutePlannerScreen';
import RouteResultScreen from '../screens/trip/RouteResultScreen';
import SmartDriveScreen from '../screens/trip/SmartDriveScreen';
import TripPreferencesScreen from '../screens/trip/TripPreferencesScreen';
import TripSummaryScreen from '../screens/trip/TripSummaryScreen';
import TripsScreen from '../screens/trip/TripsScreen';
import AutoSocScreen from '../screens/vehicle/AutoSocScreen';
import ManualSocScreen from '../screens/vehicle/ManualSocScreen';
import VehicleSetupScreen from '../screens/vehicle/VehicleSetupScreen';
import VehiclesScreen from '../screens/vehicle/VehiclesScreen';

/**
 * Every route in the app. The `Record<RouteName, ...>` type makes this a
 * compile error if a route in params.ts has no screen.
 * `tabBar: true` keeps the bottom bar visible on that stack screen.
 */
export const REGISTRY: Registry = {
  // Tab roots
  Home: {component: HomeScreen, tabBar: true},
  Trips: {component: TripsScreen, tabBar: true},
  Charge: {component: ChargeScreen, tabBar: true},
  Activity: {component: ActivityScreen, tabBar: true},
  Profile: {component: ProfileScreen, tabBar: true},

  // Co-driver
  Map: {component: MapScreen, tabBar: true, tab: 'Home'},
  SmartDrive: {component: SmartDriveScreen},
  TripSummary: {component: TripSummaryScreen},
  ChargePick: {component: ChargePickScreen},

  // Vehicle
  VehicleSetup: {component: VehicleSetupScreen},
  ManualSoc: {component: ManualSocScreen},
  Vehicles: {component: VehiclesScreen},
  AutoSoc: {component: AutoSocScreen},

  // Discover
  StationList: {component: StationListScreen, tabBar: true, tab: 'Home'},
  Filters: {component: FiltersScreen},
  StationDetail: {component: StationDetailScreen},
  Compare: {component: CompareScreen},
  Saved: {component: SavedScreen, tabBar: true, tab: 'Trips'},
  Forecast: {component: ForecastScreen},
  Community: {component: CommunityScreen},
  CostCalculator: {component: CostCalculatorScreen},

  // Trips
  RoutePlanner: {component: RoutePlannerScreen},
  RouteResult: {component: RouteResultScreen},
  BackupAlert: {component: BackupAlertScreen},
  Navigation: {component: NavigationScreen},
  EnergyPlanner: {component: EnergyPlannerScreen},
  MultiStop: {component: MultiStopScreen},
  OfflineMode: {component: OfflineModeScreen},
  TripPreferences: {component: TripPreferencesScreen},

  // Charging
  ScanQr: {component: ScanQrScreen},
  StartCharging: {component: StartChargingScreen},
  ActiveSession: {component: ActiveSessionScreen, tabBar: true, tab: 'Charge'},
  Payment: {component: PaymentScreen},
  PaymentFailure: {component: PaymentFailureScreen},
  Receipt: {component: ReceiptScreen},
  Reservation: {component: ReservationScreen},
  Queue: {component: QueueScreen},

  // Activity & support
  SessionDetail: {component: SessionDetailScreen},
  Feedback: {component: FeedbackScreen},
  ReportProblem: {component: ReportProblemScreen},
  Support: {component: SupportScreen, tabBar: true, tab: 'Profile'},
  TicketDetail: {component: TicketDetailScreen},
  Notifications: {component: NotificationsScreen, tabBar: true, tab: 'Home'},
  Alerts: {component: AlertsScreen},
  Roadside: {component: RoadsideScreen, tabBar: true, tab: 'Profile'},

  // Profile
  PaymentMethods: {component: PaymentMethodsScreen},
  Language: {component: LanguageScreen},
  Plus: {component: PlusScreen},
  Privacy: {component: PrivacyScreen},
  PresenterTools: {component: PresenterToolsScreen},
};
