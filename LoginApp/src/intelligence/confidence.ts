import {
  availableCount,
  compatibleConnectors,
  hasUnconfirmedConnectors,
} from '../domain/rules';
import {dataTrust, isStale} from '../domain/trust';
import type {Station, Vehicle} from '../domain/types';
import {isAlwaysOpen} from './hours';
import type {
  ChargeConfidence,
  DataConfidence,
  SafetyWarningCode,
} from './types';

/**
 * DATA CONFIDENCE: how trustworthy is the status information itself?
 * It is exactly `dataTrust`, the one function in the app allowed to say LIVE,
 * so Smart Drive can never promote an estimate to live.
 */
export function dataConfidenceOf(
  station: Station,
  now: number,
): DataConfidence {
  return dataTrust(station.statusFeed, now);
}

/**
 * CHARGE CONFIDENCE: how sure are we that THIS driver will complete a charging
 * stop here? Related to, but not the same as, data confidence: a live feed says
 * "all bays busy" with total confidence and still gives a low chance of a
 * smooth stop.
 *
 * Phase 1 is a small points system that ends in three words, not a percentage:
 * a percentage would claim precision no data supports yet.
 */
export function chargeConfidenceOf(
  station: Station,
  vehicle: Vehicle,
  now: number,
  warnings: readonly SafetyWarningCode[],
): ChargeConfidence {
  if (hasUnconfirmedConnectors(station)) {
    return 'low';
  }
  const trust = dataTrust(station.statusFeed, now);
  const usable = compatibleConnectors(station, vehicle);
  const free = availableCount(station, vehicle);
  const allUnknown = usable.every(c => c.status === 'unknown');

  let points = 0;
  points +=
    trust === 'live' ? 3 : trust === 'user' ? 2 : trust === 'estimated' ? 1 : 0;
  if (!allUnknown) {
    points += free > 0 ? 2 : -2;
  }
  if (station.reliabilityPct >= 85) {
    points += 2;
  } else if (station.reliabilityPct >= 70) {
    points += 1;
  } else if (station.reliabilityPct > 0 && station.reliabilityPct < 60) {
    points -= 1;
  }
  if (station.successfulSessionsPct >= 90) {
    points += 1;
  }
  if (station.integration === 'integrated') {
    points += 1;
  }
  if (isStale(station.statusFeed, now) && trust !== 'unknown') {
    points -= 1;
  }
  if (!isAlwaysOpen(station.hours) && warnings.includes('HOURS_UNKNOWN')) {
    points -= 1;
  }

  let level: ChargeConfidence =
    points >= 6 ? 'high' : points >= 3 ? 'medium' : 'low';
  // Hard caps. "High" needs fresh evidence the bay will work: no amount of
  // reliability makes a stop "high" when we cannot see the bays, none is free,
  // or what we know is only an estimate (or a driver report that has aged).
  if (level === 'high') {
    const cannotSee = trust === 'unknown' || allUnknown || free === 0;
    const notFresh =
      trust === 'estimated' ||
      (trust === 'user' && isStale(station.statusFeed, now));
    if (cannotSee || notFresh) {
      level = 'medium';
    }
  }
  return level;
}
