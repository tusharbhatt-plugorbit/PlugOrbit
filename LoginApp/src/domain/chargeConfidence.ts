import {compatibleConnectors, hasUnconfirmedConnectors} from './rules';
import {dataTrust, isStale, timeAgo} from './trust';
import type {Confidence, Station, TrustLevel, Vehicle} from './types';

/**
 * CHARGE CONFIDENCE: how sure we are that a charge here will simply work.
 *
 * It is deliberately a LEVEL with reasons, not a percentage. A number like
 * "94%" claims a precision we only have once there is a real history of
 * sessions behind it; until then `chargeConfidencePercent` returns null and the
 * UI shows High / Medium / Low with the reasons it is built from.
 *
 * Inputs are only things the station record really carries: status trust and
 * age, the reliability and successful-session figures, bays that are out of
 * service, how the charger is started (integration quality) and, when a
 * service supplies them, recent driver confirmations. Availability ("is a bay
 * free?") is NOT an input: that is a separate fact, shown separately.
 */

export type ConfidenceReason = {
  text: string;
  tone: 'good' | 'neutral' | 'warn';
};

export type ChargeConfidence = {
  level: Confidence;
  /** "High Charge Confidence". */
  label: string;
  /** Strongest first, at most 4. */
  reasons: ConfidenceReason[];
  /** 0-100. Ranking input only: never print it as a percentage. */
  score: number;
  statusTrust: TrustLevel;
};

export const CONFIDENCE_HEADLINE: Record<Confidence, string> = {
  high: 'High Charge Confidence',
  medium: 'Medium Charge Confidence',
  low: 'Low Charge Confidence',
};

/** Real sessions needed before a percentage is allowed to exist. */
export const MIN_SESSIONS_FOR_PERCENT = 30;

const HIGH_AT = 72;
const MEDIUM_AT = 48;
/** A driver's confirmation counts towards "high" only while it is this fresh. */
const USER_FRESH_MS = 15 * 60 * 1000;

export type ConfidenceOptions = {
  /** Driver confirmations in the last hour, from a community service. */
  userConfirmations?: number;
};

export function chargeConfidence(
  station: Station,
  vehicle: Vehicle | null,
  now: number,
  options: ConfidenceOptions = {},
): ChargeConfidence {
  const trust = dataTrust(station.statusFeed, now);
  const stale = isStale(station.statusFeed, now);
  const ago = timeAgo(station.statusFeed.updatedAt, now);
  const reasons: ConfidenceReason[] = [];
  let score = 35;

  // ---- status: how fresh and who vouches for it ---------------------------
  switch (trust) {
    case 'live':
      score += 30;
      reasons.push({
        text: `Live status from the operator, updated ${ago}`,
        tone: 'good',
      });
      break;
    case 'user':
      score += stale ? 4 : 12;
      reasons.push({
        text: `A driver confirmed its status ${ago}, not the operator`,
        tone: 'neutral',
      });
      break;
    case 'estimated':
      score += 4;
      reasons.push({
        text: stale
          ? `Status is getting old (updated ${ago}) and isn’t live`
          : `Status is estimated (updated ${ago}), not live`,
        tone: 'warn',
      });
      break;
    default:
      score -= 10;
      reasons.push({
        text: 'We can’t see this charger’s status right now',
        tone: 'warn',
      });
  }
  if (stale && trust === 'live') {
    // Cannot happen (live is <5 min, stale >30 min) but keeps the rule explicit.
    score -= 8;
  } else if (stale && trust !== 'unknown') {
    score -= 8;
  }

  // ---- track record ---------------------------------------------------------
  const success = station.successfulSessionsPct;
  const rel = station.reliabilityPct;
  if (rel > 0) {
    score += Math.max(-8, Math.min(16, Math.round((rel - 60) * 0.4)));
  }
  if (success > 0) {
    score += success >= 92 ? 6 : success >= 85 ? 3 : success < 75 ? -5 : 0;
    reasons.push({
      text: `${Math.round(
        success,
      )}% of recent sessions here finish without a fault`,
      tone: success >= 85 ? 'good' : success >= 75 ? 'neutral' : 'warn',
    });
  } else if (rel > 0) {
    reasons.push({
      text: `Reliability check: ${Math.round(rel)} out of 100`,
      tone: rel >= 85 ? 'good' : rel >= 70 ? 'neutral' : 'warn',
    });
  } else {
    reasons.push({
      text: 'No reliability history for this charger yet',
      tone: 'neutral',
    });
  }

  // ---- faults: bays out of service ------------------------------------------
  const usable = compatibleConnectors(station, vehicle);
  const down = usable.filter(c => c.status === 'offline').length;
  if (usable.length > 0 && down > 0) {
    score -= Math.min(15, Math.round((down / usable.length) * 20));
    reasons.push({
      text: `${down} of ${usable.length} compatible bays ${
        down === 1 ? 'is' : 'are'
      } out of service`,
      tone: 'warn',
    });
  }
  if (hasUnconfirmedConnectors(station)) {
    score -= 20;
    reasons.push({
      text: 'The connector types here are unconfirmed',
      tone: 'warn',
    });
  }

  // ---- how it's started ------------------------------------------------------
  if (station.integration === 'integrated') {
    score += 4;
    reasons.push({text: 'Start and pay inside PlugOrbit', tone: 'good'});
  } else {
    reasons.push({
      text: 'Started with the operator’s own app or QR code',
      tone: 'neutral',
    });
  }

  // ---- driver confirmations ---------------------------------------------------
  const confirmations = Math.max(0, options.userConfirmations ?? 0);
  if (confirmations > 0) {
    score += Math.min(9, confirmations * 3);
    reasons.push({
      text: `${confirmations} driver ${
        confirmations === 1 ? 'confirmation' : 'confirmations'
      } in the last hour`,
      tone: 'good',
    });
  }

  score = Math.max(0, Math.min(100, score));

  let level: Confidence =
    score >= HIGH_AT ? 'high' : score >= MEDIUM_AT ? 'medium' : 'low';
  // "High" has to be earned by a status someone is vouching for right now.
  const userFresh =
    trust === 'user' &&
    station.statusFeed.updatedAt !== null &&
    now - station.statusFeed.updatedAt <= USER_FRESH_MS;
  if (level === 'high' && trust !== 'live' && !userFresh) {
    level = 'medium';
  }
  if (trust === 'unknown' && rel <= 0 && level !== 'low') {
    level = 'low';
  }

  return {
    level,
    label: CONFIDENCE_HEADLINE[level],
    reasons: reasons.slice(0, 4),
    score,
    statusTrust: trust,
  };
}

/**
 * The only door to a percentage. Returns null until a charger has a real
 * history of sessions (and a live feed to go with it); the station record has
 * no session count yet, so in Phase 1 this is always null by design.
 */
export function chargeConfidencePercent(
  confidence: ChargeConfidence,
  sessionSampleSize: number | null,
): number | null {
  if (
    sessionSampleSize === null ||
    sessionSampleSize < MIN_SESSIONS_FOR_PERCENT ||
    confidence.statusTrust !== 'live'
  ) {
    return null;
  }
  return Math.round(confidence.score);
}
