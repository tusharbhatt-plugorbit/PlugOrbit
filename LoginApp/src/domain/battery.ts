import {formatDistanceRound} from './wording';
import type {Vehicle} from './types';

/**
 * Battery maths in one place (the "batteryService"): how far a charge goes, how
 * much a drive costs in percent, and what state the battery is in. Pure, so the
 * Home screen, the trip monitor and the recommendation engine can never
 * disagree about what "low" means.
 */

export type BatteryBand = 'comfortable' | 'watch' | 'low' | 'critical';

/** At or below this the driver needs a charger now, not "soon". */
export const BATTERY_CRITICAL_PCT = 10;
/** Below this a charge is recommended before any real trip. */
export const BATTERY_LOW_PCT = 20;
/** Below this we start keeping an eye out for the next charger. */
export const BATTERY_WATCH_PCT = 35;

/** Real-world range at `socPercent`, in km (unrounded). */
export function rangeKmAt(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  socPercent: number,
): number {
  return Math.max(0, (vehicle.rangeKm100 * socPercent) / 100);
}

/** Percent of battery a drive of `km` uses. */
export function socCostOfKm(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  km: number,
): number {
  return (Math.max(0, km) * 100) / vehicle.rangeKm100;
}

/** Km you can drive before touching the safety reserve (unrounded). */
export function safeRangeKm(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  socPercent: number,
  reservePct: number,
): number {
  return rangeKmAt(vehicle, Math.max(0, socPercent - reservePct));
}

export function batteryBand(socPercent: number, reservePct = 0): BatteryBand {
  if (socPercent <= BATTERY_CRITICAL_PCT) {
    return 'critical';
  }
  if (socPercent <= Math.max(BATTERY_LOW_PCT, reservePct + 8)) {
    return 'low';
  }
  if (socPercent <= BATTERY_WATCH_PCT) {
    return 'watch';
  }
  return 'comfortable';
}

export type BatteryStatus = {
  band: BatteryBand;
  tone: 'good' | 'watch' | 'warn' | 'critical';
  /** Whole km to the nearest 5, honest about being an estimate. */
  safeRangeKm: number;
  headline: string;
  detail: string;
};

const round5 = (km: number) => Math.round(km / 5) * 5;

/** What the battery alone says, in the words the driver sees on Home. */
export function batteryStatus(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  socPercent: number,
  reservePct: number,
): BatteryStatus {
  const band = batteryBand(socPercent, reservePct);
  const safe = round5(safeRangeKm(vehicle, socPercent, reservePct));
  const total = round5(rangeKmAt(vehicle, socPercent));
  switch (band) {
    case 'critical':
      return {
        band,
        tone: 'critical',
        safeRangeKm: safe,
        headline: 'Battery is low. We’ve found the safest charging option.',
        detail: `About ${formatDistanceRound(total)} of range left.`,
      };
    case 'low':
      return {
        band,
        tone: 'warn',
        safeRangeKm: safe,
        headline: 'Charging recommended before your trip.',
        detail: `About ${formatDistanceRound(total)} of range left.`,
      };
    case 'watch':
      return {
        band,
        tone: 'watch',
        safeRangeKm: safe,
        headline: 'You’re good for now.',
        detail: `About ${formatDistanceRound(
          safe,
        )} before you’d want to charge.`,
      };
    default:
      return {
        band,
        tone: 'good',
        safeRangeKm: safe,
        headline: 'You’re good to drive.',
        detail: `About ${formatDistanceRound(safe)} of comfortable range.`,
      };
  }
}
