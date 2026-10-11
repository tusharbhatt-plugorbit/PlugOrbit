import {IntegrationUnavailableError, OfflineError} from '../../services/types';
import {ApiError} from '../../services/types';
import type {ToolCall, ToolEnvelope} from '../types';
import {ToolDeps, failed, unavailable} from './common';
import {getChargerAvailability, getChargerDetails} from './chargers';
import {
  calculateTripCost,
  estimateRouteEnergy,
  explainPlan,
  getActiveTrip,
  getChargersAlongRoute,
  getRouteOptions,
  recommendChargingStops,
} from './journey';
import {
  getActiveChargingSession,
  getBatteryLevel,
  getCurrentLocation,
  getUserPreferences,
  getVehicleCompatibility,
  getVehicleStatus,
} from './vehicle';

export type {ToolDeps} from './common';

type Handler = (
  deps: ToolDeps,
  input: Record<string, unknown>,
) => Promise<ToolEnvelope>;

/**
 * Every tool the model may call on the phone. This table must stay in step with
 * DEVICE_TOOLS in Backend/app/ai/tools.py; a test compares the two names lists.
 */
export const HANDLERS: Record<string, Handler> = {
  get_vehicle_status: d => getVehicleStatus(d),
  get_battery_level: d => getBatteryLevel(d),
  get_vehicle_compatibility: getVehicleCompatibility,
  get_current_location: d => getCurrentLocation(d),
  get_route_options: getRouteOptions,
  get_chargers_along_route: getChargersAlongRoute,
  get_charger_details: getChargerDetails,
  get_charger_availability: getChargerAvailability,
  estimate_route_energy: estimateRouteEnergy,
  recommend_charging_stops: recommendChargingStops,
  calculate_trip_cost: calculateTripCost,
  get_active_charging_session: d => getActiveChargingSession(d),
  get_user_preferences: d => getUserPreferences(d),
  get_active_trip: d => getActiveTrip(d),
  explain_plan: explainPlan,
};

export const DEVICE_TOOL_NAMES = Object.keys(HANDLERS);

const TOOL_TIMEOUT_MS = 12_000;

/**
 * Run one tool call. Never throws and never fabricates: a failure comes back as
 * `unavailable` (offline, not integrated) or `error`, and the model says so.
 */
export function createToolRunner(deps: ToolDeps) {
  return async function run(call: ToolCall): Promise<ToolEnvelope> {
    const handler = HANDLERS[call.name];
    if (!handler) {
      return failed(`This app doesn’t have a tool called ${call.name}.`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<ToolEnvelope>(resolve => {
        timer = setTimeout(
          () =>
            resolve(
              unavailable('That check took too long. Try again in a moment.'),
            ),
          TOOL_TIMEOUT_MS,
        );
      });
      return await Promise.race([handler(deps, call.input ?? {}), timeout]);
    } catch (e) {
      if (e instanceof OfflineError) {
        return unavailable(
          'The app is offline, so that can’t be checked right now.',
        );
      }
      if (e instanceof IntegrationUnavailableError) {
        return unavailable(e.message);
      }
      if (e instanceof ApiError) {
        return failed(e.message);
      }
      return failed('That check failed unexpectedly.');
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
