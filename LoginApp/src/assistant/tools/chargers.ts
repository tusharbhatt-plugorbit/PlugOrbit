import {
  compatibleConnectors,
  effectivePowerKw,
  hasUnconfirmedConnectors,
} from '../../domain/rules';
import {dataTrust} from '../../domain/trust';
import {StationNotFoundError} from '../../services/types';
import type {ToolEnvelope} from '../types';
import {
  ToolDeps,
  availabilityOf,
  inputs,
  minutesAgo,
  ok,
  source,
  unavailable,
} from './common';

const vehicleOf = (deps: ToolDeps) => {
  const s = deps.getState();
  return s.vehicles.find(v => v.id === s.activeVehicleId) ?? null;
};

async function loadStation(deps: ToolDeps, id: string) {
  try {
    return await deps.services.station.get(id);
  } catch (e) {
    if (e instanceof StationNotFoundError) {
      return null;
    }
    throw e;
  }
}

export async function getChargerDetails(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const id = inputs.str(input.station_id);
  if (!id) {
    return unavailable('Which charger? A station id is needed.');
  }
  const s = await loadStation(deps, id);
  if (!s) {
    return unavailable('That charger isn’t available right now.');
  }
  const vehicle = vehicleOf(deps);
  const now = deps.now();
  const fits = new Set(compatibleConnectors(s, vehicle).map(c => c.id));
  return ok(
    {
      id: s.id,
      name: s.name,
      operator: s.operator,
      address: s.address,
      hours: s.hours,
      amenities: s.amenities,
      distance_from_route_or_you_km: Math.round(s.distanceKm * 10) / 10,
      rating: s.rating > 0 ? s.rating : null,
      reliability_percent: s.reliabilityPct > 0 ? s.reliabilityPct : null,
      sponsored: s.sponsored,
      control:
        s.integration === 'integrated'
          ? 'PlugOrbit can start charging here after payment is set up.'
          : 'The operator’s own app or QR is used here; PlugOrbit only guides.',
      ...(s.operatorInstructions
        ? {operator_instructions: s.operatorInstructions}
        : {}),
      connectors_confirmed: !hasUnconfirmedConnectors(s),
      connectors: s.connectors.map(c => ({
        id: c.id,
        type: c.type,
        power_kw: c.powerKw,
        power_kw_for_this_car: effectivePowerKw(c, vehicle),
        fits_this_car: fits.has(c.id),
        status: c.status,
        price_per_kwh: c.pricePerKwh,
        idle_fee_per_min: c.idleFeePerMin,
      })),
      status_data: {
        trust: dataTrust(s.statusFeed, now),
        updated_min_ago: minutesAgo(s.statusFeed.updatedAt, now),
      },
      price_data: {
        trust: dataTrust(s.priceFeed, now),
        updated_min_ago: minutesAgo(s.priceFeed.updatedAt, now),
      },
    },
    source(deps, 'sample_data', {trust: dataTrust(s.statusFeed, now)}),
    [
      'Rating and reliability are null when nobody has rated the charger; they are never guessed.',
      'Sponsored chargers are labelled but never ranked higher.',
    ],
  );
}

export async function getChargerAvailability(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const id = inputs.str(input.station_id);
  if (!id) {
    return unavailable('Which charger? A station id is needed.');
  }
  const s = await loadStation(deps, id);
  if (!s) {
    return unavailable('That charger isn’t available right now.');
  }
  const vehicle = vehicleOf(deps);
  const now = deps.now();
  const wait = await deps.services.station.waitEstimate(id, vehicle);
  const trust = dataTrust(s.statusFeed, now);
  const unconfirmed = hasUnconfirmedConnectors(s);
  return ok(
    {
      station_id: s.id,
      name: s.name,
      overall_for_this_car: availabilityOf(s, vehicle, now),
      connectors_for_this_car: compatibleConnectors(s, vehicle).map(c => ({
        id: c.id,
        type: c.type,
        status: c.status,
      })),
      queue_length: s.queueLength ?? null,
      queue_note:
        s.queueLength === undefined
          ? 'Queue length is not reported for this charger. That does not mean there is no queue.'
          : 'Reported by the operator’s live feed.',
      expected_wait: {
        min_minutes: wait.minMinutes,
        max_minutes: wait.maxMinutes,
        confidence: wait.confidence,
        basis: wait.basis,
      },
    },
    source(deps, 'sample_data', {
      trust,
      as_of: s.statusFeed.updatedAt ?? deps.now(),
    }),
    [
      trust === 'live'
        ? 'Status is from a fresh operator feed.'
        : 'Status is NOT live: it is an estimate, a driver report or an old feed. Do not call it live.',
      ...(unconfirmed
        ? [
            'This charger’s connector types are not confirmed, so availability for this car is unknown.',
          ]
        : []),
      'Waiting time is a range with a confidence level, never an exact number.',
    ],
  );
}
