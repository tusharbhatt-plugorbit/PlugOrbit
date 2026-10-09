import {minutesRangeLabel} from '../domain/socEstimate';
import {formatInr} from '../utils/format';
import {formatDistance} from '../utils/geo';
import type {
  ChargeConfidence,
  NotificationLevel,
  Range,
  ReasonCode,
  SafetyViolationCode,
  StopCost,
} from './types';

/**
 * The PlugOrbit voice. Calm, confident, useful, proactive, human, non-technical.
 *
 * All user-facing wording for the intelligence layer lives here, so the tone is
 * consistent and an engineer can never leak "SOC CRITICAL 16%" to a driver.
 * (Typographic apostrophes, like the rest of the app.)
 */
export const PHRASES = {
  tagline: 'You drive. We handle the charge.',
  goodToDrive: 'You’re good to drive.',
  onTrack: 'Your trip is on track.',
  gotNextStop: 'We’ve got your next stop.',
  backupReady: 'Your backup is ready.',
  noActionNeeded: 'No action needed.',
  monitoringTrip: 'PlugOrbit is monitoring your trip.',
  monitoringStop: 'PlugOrbit is monitoring this stop.',
  betterCharger: 'We’ve found a better charger.',
  enoughCharge: 'Enough charge to continue.',
  readyToGo: 'You’re ready to go.',
} as const;

/** Reason codes in the words a driver would use: "Why this charger?" */
export const REASON_LABEL: Record<ReasonCode, string> = {
  REASON_COMPATIBLE: 'Fits your car',
  REASON_REACHABLE_SAFELY: 'You’ll get there with battery to spare',
  REASON_SAFEST_REACHABLE: 'The safest charger you can reach',
  REASON_LOW_DETOUR: 'On your route',
  REASON_HIGH_RELIABILITY: 'Reliable recent sessions',
  REASON_LIVE_AVAILABILITY: 'Live availability',
  REASON_FASTER_TRIP: 'Gets you back on the road sooner',
  REASON_FAST_FOR_YOUR_CAR: 'Fast for your car',
  REASON_LOWER_COST: 'Good value',
  REASON_AMENITIES: 'Food and washrooms nearby',
  REASON_OPEN_24_7: 'Open 24/7',
  REASON_STRONG_BACKUP: 'Strong backup nearby',
  REASON_FEWER_STOPS: 'Fewer stops on this trip',
};

/** Order shown to the driver, most persuasive first. */
const REASON_ORDER: readonly ReasonCode[] = [
  'REASON_SAFEST_REACHABLE',
  'REASON_LOW_DETOUR',
  'REASON_LIVE_AVAILABILITY',
  'REASON_HIGH_RELIABILITY',
  'REASON_FEWER_STOPS',
  'REASON_FASTER_TRIP',
  'REASON_STRONG_BACKUP',
  'REASON_FAST_FOR_YOUR_CAR',
  'REASON_REACHABLE_SAFELY',
  'REASON_LOWER_COST',
  'REASON_AMENITIES',
  'REASON_OPEN_24_7',
];

/** The few reasons worth printing; "fits your car" is assumed, not a selling point. */
export function topReasons(reasons: readonly ReasonCode[], max = 4): string[] {
  return REASON_ORDER.filter(r => reasons.includes(r))
    .slice(0, max)
    .map(r => REASON_LABEL[r]);
}

export const CHARGE_CONFIDENCE_LABEL: Record<ChargeConfidence, string> = {
  high: 'High charge confidence',
  medium: 'Medium charge confidence',
  low: 'Low charge confidence',
};

/** Why the safety engine said no, for "what I ruled out". */
export const VIOLATION_WORDS: Record<SafetyViolationCode, string> = {
  CONNECTOR_UNCONFIRMED: 'connector type unconfirmed',
  INCOMPATIBLE_CONNECTOR: 'wrong plug for your car',
  UNREACHABLE: 'too far for your battery',
  BELOW_RESERVE: 'would leave you under your safety reserve',
  CHARGER_OFFLINE: 'offline',
  CLOSED_AT_ARRIVAL: 'closed when you’d arrive',
};

export function kmLabel(km: number): string {
  return formatDistance(km);
}

/** "~35-41 min", or "~24 min" when the band is a single value. */
export function minutesLabel(r: Range): string {
  return r.min === r.max ? `~${r.min} min` : minutesRangeLabel(r.min, r.max);
}

/** "~₹368", or an honest note when the operator has not published a price. */
export function costLabel(cost: StopCost): string {
  return cost.totalInr === null
    ? 'Price not published'
    : `~${formatInr(cost.totalInr)}`;
}

/** "Expected battery on arrival: 21%". Whole percents only. */
export function pctLabel(n: number): string {
  return `${Math.round(n)}%`;
}

export const LEVEL_LABEL: Record<NotificationLevel, string> = {
  info: 'Info',
  action: 'Coming up',
  important: 'Plan changed',
  critical: 'Needs attention',
};
