import {
  compatibleConnectors,
  effectivePowerKw,
  hasUnconfirmedConnectors,
} from '../../domain/rules';
import {LocationError} from '../../services/location';
import {StationNotFoundError} from '../../services/types';
import type {ToolEnvelope} from '../types';
import {
  ToolDeps,
  inputs,
  minutesAgo,
  ok,
  sessionFacts,
  source,
  unavailable,
  unknown,
} from './common';

const BATTERY_SOURCE_WORDS = {
  manual: 'typed in by the driver',
  vehicle: 'read from the car',
  trip_estimate: 'the app’s own estimate while on a trip',
} as const;

const activeVehicle = (deps: ToolDeps) => {
  const s = deps.getState();
  return s.vehicles.find(v => v.id === s.activeVehicleId) ?? null;
};

export async function getVehicleStatus(deps: ToolDeps): Promise<ToolEnvelope> {
  const state = deps.getState();
  const vehicle = activeVehicle(deps);
  if (!vehicle) {
    return unavailable(
      'No car has been added yet. The driver can add one under Vehicles.',
    );
  }
  const now = deps.now();
  return ok(
    {
      vehicle: {
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant,
        battery_kwh: vehicle.batteryKwh,
        connectors: vehicle.connectors,
        max_dc_kw: vehicle.maxDcKw,
        max_ac_kw: vehicle.maxAcKw,
        range_km_at_100_percent: vehicle.rangeKm100,
      },
      battery: state.battery
        ? {
            percent: Math.round(state.battery.percent),
            source: BATTERY_SOURCE_WORDS[state.battery.source],
            updated_min_ago: minutesAgo(state.battery.updatedAt, now),
          }
        : null,
      live_link: {
        connected: state.vehicleLink.connected,
        method: state.vehicleLink.method,
        sample_reading: !!state.vehicleLink.simulated,
      },
    },
    source(deps, 'device_store', {trust: 'user'}),
    ['Range is a real-world estimate at 100% battery, not a guarantee.'],
  );
}

export async function getBatteryLevel(deps: ToolDeps): Promise<ToolEnvelope> {
  const state = deps.getState();
  const vehicle = activeVehicle(deps);
  const b = state.battery;
  if (!b) {
    return unknown(
      'The battery level has not been set. Ask the driver for it; they can also set it in Orbit Assist.',
    );
  }
  if (b.source === 'vehicle' && !state.privacy.vehicleBatteryData) {
    return unavailable(
      'Reading battery data from the car is switched off in Privacy settings.',
    );
  }
  const now = deps.now();
  const age = minutesAgo(b.updatedAt, now) ?? 0;
  const live =
    b.source === 'vehicle' && !state.vehicleLink.simulated && age <= 5;
  const trust = live ? 'live' : b.source === 'manual' ? 'user' : 'estimated';
  return ok(
    {
      percent: Math.round(b.percent),
      source: BATTERY_SOURCE_WORDS[b.source],
      updated_min_ago: age,
      ...(vehicle
        ? {
            estimated_range_km: Math.round(
              (vehicle.rangeKm100 * b.percent) / 100,
            ),
          }
        : {}),
    },
    source(deps, 'device_store', {
      trust,
      as_of: b.updatedAt,
      demo: b.source === 'vehicle' && !!state.vehicleLink.simulated,
    }),
    vehicle
      ? [
          'Range is the car’s real-world range scaled by the battery percent; speed, load and air-conditioning change it.',
        ]
      : [],
  );
}

export async function getVehicleCompatibility(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const vehicle = activeVehicle(deps);
  if (!vehicle) {
    return unavailable(
      'No car has been added yet, so compatibility cannot be checked.',
    );
  }
  const src = source(deps, 'device_store', {trust: 'user'});
  const id = inputs.str(input.station_id);
  if (!id) {
    return ok({connectors_the_car_can_use: vehicle.connectors}, src);
  }
  try {
    const station = await deps.services.station.get(id);
    const unconfirmed = hasUnconfirmedConnectors(station);
    const matching = compatibleConnectors(station, vehicle);
    return ok(
      {
        connectors_the_car_can_use: vehicle.connectors,
        station: {
          id: station.id,
          name: station.name,
          connectors_confirmed: !unconfirmed,
          compatible: unconfirmed ? null : matching.length > 0,
          matching_connectors: matching.map(c => ({
            id: c.id,
            type: c.type,
            power_kw: c.powerKw,
            power_kw_for_this_car: effectivePowerKw(c, vehicle),
          })),
        },
      },
      source(deps, 'sample_data'),
      unconfirmed
        ? [
            'This charger’s source does not list its connector types, so it is unconfirmed, not compatible.',
          ]
        : [],
    );
  } catch (e) {
    if (e instanceof StationNotFoundError) {
      return unavailable('That charger isn’t available right now.');
    }
    throw e;
  }
}

export async function getCurrentLocation(
  deps: ToolDeps,
): Promise<ToolEnvelope> {
  if (!deps.getState().privacy.preciseLocation) {
    return unavailable('Precise location is switched off in Privacy settings.');
  }
  try {
    const {coords, outsideDemoArea} = await deps.locate();
    return ok(
      {
        // About a kilometre: enough to plan from, not enough to identify a doorstep.
        latitude: Math.round(coords.latitude * 100) / 100,
        longitude: Math.round(coords.longitude * 100) / 100,
        precision: 'about 1 km',
        outside_sample_area: outsideDemoArea,
      },
      source(deps, 'device_gps', {trust: 'estimated'}),
      [
        'The route planner starts from a named place, so this position is not used to choose the start.',
        ...(outsideDemoArea
          ? ['The phone is far from the sample charger area (Delhi–Jaipur).']
          : []),
      ],
    );
  } catch (e) {
    if (e instanceof LocationError) {
      return unavailable(
        e.code === 'denied'
          ? 'Location permission is off. The driver can allow it in the phone’s settings.'
          : e.code === 'timeout'
          ? 'The phone could not get a location fix in time.'
          : 'Location is unavailable. Location services may be switched off.',
      );
    }
    throw e;
  }
}

export async function getActiveChargingSession(
  deps: ToolDeps,
): Promise<ToolEnvelope> {
  const facts = sessionFacts(deps.getState(), deps.now());
  if (!facts) {
    return ok({active: false}, source(deps, 'device_store'));
  }
  return ok(
    {active: true, ...facts},
    source(deps, 'sample_data', {trust: 'estimated'}),
    [
      'The meter shown during a session is an estimate until a charger operator integration is connected.',
    ],
  );
}

export async function getUserPreferences(
  deps: ToolDeps,
): Promise<ToolEnvelope> {
  const s = deps.getState();
  const now = deps.now();
  const remembered = deps.remembered();
  const journey = deps.journey();
  return ok(
    {
      saved_settings: {
        min_arrival_soc_percent: s.tripPrefs.minArrivalSocPct,
        route_priority: s.tripPrefs.strategy,
        avoid_paid_parking: s.tripPrefs.avoidPaidParking,
        prefer_amenities: s.tripPrefs.preferAmenities,
        orbit_assist: {
          enabled: s.smartDrive.prefs.enabled,
          mode: s.smartDrive.prefs.mode ?? 'assist',
          talkativeness: s.smartDrive.prefs.verbosity,
        },
        app_language: s.language,
        precise_location_allowed: s.privacy.preciseLocation,
        vehicle_battery_data_allowed: s.privacy.vehicleBatteryData,
      },
      remembered_by_assistant_unverified: remembered.map(p => ({
        key: p.key,
        value: p.value,
        saved_days_ago: Math.round((now - p.savedAt) / 86_400_000),
      })),
      stated_for_this_journey_unverified: journey ?? null,
    },
    source(deps, 'device_store', {trust: 'user'}),
    [
      'saved_settings are the driver’s app settings. The other two blocks are things the driver said earlier; they may be out of date.',
    ],
  );
}
