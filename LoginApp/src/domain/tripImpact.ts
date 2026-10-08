import type {Confidence, WaitEstimate} from './types';
import {formatMinuteRange} from './wording';

/**
 * TOTAL TRIP IMPACT: what a charging stop really costs the journey in time,
 * not just how fast the charger is. Detour + likely wait + charging, as a
 * range, because a wait is never a single honest number.
 */

export type TripImpact = {
  /** Extra driving to reach the charger and rejoin the route. */
  detourMin: number;
  waitMinMinutes: number;
  waitMaxMinutes: number;
  /** False when we have no basis for a wait (so the total is a floor). */
  waitKnown: boolean;
  waitConfidence: Confidence;
  chargeMin: number;
  totalMinMinutes: number;
  totalMaxMinutes: number;
};

export function tripImpact(input: {
  detourMin: number;
  wait: WaitEstimate;
  chargeMin: number;
}): TripImpact {
  const known = input.wait.basis !== 'none';
  const waitMin = known ? input.wait.minMinutes : 0;
  const waitMax = known ? input.wait.maxMinutes : 0;
  const base = Math.max(0, input.detourMin) + Math.max(0, input.chargeMin);
  return {
    detourMin: Math.max(0, Math.round(input.detourMin)),
    waitMinMinutes: waitMin,
    waitMaxMinutes: waitMax,
    waitKnown: known,
    waitConfidence: input.wait.confidence,
    chargeMin: Math.max(0, Math.round(input.chargeMin)),
    totalMinMinutes: Math.round(base + waitMin),
    totalMaxMinutes: Math.round(base + waitMax),
  };
}

/** "~35-41 min", or "~35 min or more" when the wait is unknown. */
export function impactLabel(i: TripImpact): string {
  const range = formatMinuteRange(i.totalMinMinutes, i.totalMaxMinutes);
  return i.waitKnown ? range : `${range} or more`;
}

/** The wait line on its own: "0-6 min", "No wait expected" never invented. */
export function impactWaitLabel(i: TripImpact): string {
  if (!i.waitKnown) {
    return 'Wait unknown';
  }
  if (i.waitMaxMinutes === 0) {
    return 'No wait expected';
  }
  return i.waitMinMinutes === 0
    ? `Up to ~${i.waitMaxMinutes} min`
    : `~${i.waitMinMinutes}-${i.waitMaxMinutes} min`;
}

/**
 * Extra time `other` adds compared with `base`, as shown on a backup ("+6 min").
 * Never negative: a backup that is faster overall would have been the pick.
 */
export function extraMinutes(base: TripImpact, other: TripImpact): number {
  return Math.max(
    0,
    Math.round(
      (other.totalMinMinutes + other.totalMaxMinutes) / 2 -
        (base.totalMinMinutes + base.totalMaxMinutes) / 2,
    ),
  );
}
