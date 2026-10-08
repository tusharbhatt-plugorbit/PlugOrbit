import {clamp} from '../utils/format';
import {energyToCharge} from './charging';
import {socCostOfKm} from './battery';
import type {Vehicle} from './types';

/**
 * The charging plan maths (the "chargingPlanService"): do I need to charge,
 * how much, and to what. One implementation, used by the route planner and the
 * trip monitor so a stop's target never differs between screens.
 */

/** DC charging slows sharply after this, so plans never ask for more. */
export const MAX_CHARGE_TO_PCT = 80;
/** Extra percent kept on top of the reserve when sizing a charge. */
const TARGET_HEADROOM_PCT = 4;

/**
 * Where to charge to at a stop: enough to finish the remaining distance with
 * the reserve and a little headroom, rounded up to the next 5, never more than
 * 80%, at least a useful top-up, and never "charge down" below the arrival
 * level. Whole percents only.
 */
export function chargeTargetFor(
  arriveSoc: number,
  remainingPct: number,
  reservePct: number,
): number {
  const need = remainingPct + reservePct + TARGET_HEADROOM_PCT;
  return Math.max(
    Math.round(
      clamp(
        need > MAX_CHARGE_TO_PCT ? MAX_CHARGE_TO_PCT : Math.ceil(need / 5) * 5,
        Math.min(arriveSoc + 12, MAX_CHARGE_TO_PCT),
        MAX_CHARGE_TO_PCT,
      ),
    ),
    Math.round(arriveSoc),
  );
}

export type ChargingNeed = {
  /** The battery would drop below the reserve before the destination. */
  required: boolean;
  /** Where the battery would be at the destination with no charging. */
  socAtDestination: number;
  /** Percent short of the reserve (0 when none is needed). */
  shortfallPct: number;
  /** How far the driver can go before the reserve is reached, km. */
  kmUntilReserve: number;
  /** Where to charge to if a stop is needed; null otherwise. */
  targetSoc: number | null;
  energyKwh: number;
};

/** Does the remaining drive need a charge, and how big would it be? */
export function chargingNeed(input: {
  vehicle: Pick<Vehicle, 'rangeKm100' | 'batteryKwh'>;
  socPercent: number;
  remainingKm: number;
  reservePct: number;
}): ChargingNeed {
  const {vehicle, socPercent, remainingKm, reservePct} = input;
  const remainingPct = socCostOfKm(vehicle, remainingKm);
  const socAtDestination = socPercent - remainingPct;
  const required = socAtDestination < reservePct;
  const kmUntilReserve = Math.max(
    0,
    ((socPercent - reservePct) * vehicle.rangeKm100) / 100,
  );
  const targetSoc = required
    ? chargeTargetFor(
        Math.max(0, socPercent - socCostOfKm(vehicle, kmUntilReserve / 2)),
        remainingPct,
        reservePct,
      )
    : null;
  return {
    required,
    socAtDestination,
    shortfallPct: required ? Math.max(0, reservePct - socAtDestination) : 0,
    kmUntilReserve,
    targetSoc,
    energyKwh:
      targetSoc === null
        ? 0
        : energyToCharge(socPercent, targetSoc, vehicle.batteryKwh),
  };
}
