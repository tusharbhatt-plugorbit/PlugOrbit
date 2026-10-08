import {
  ArrivalOutlook,
  AvailabilityPredictor,
  arrivalOutlook,
  NO_PREDICTION,
} from './arrivalOutlook';
import {socCostOfKm} from './battery';
import {ChargeConfidence, chargeConfidence} from './chargeConfidence';
import {stopCostBreakdown, StopCostBreakdown} from './costBreakdown';
import {isOpenAt} from './openingHours';
import {ROAD_FACTOR} from './routeGeometry';
import {
  compatibleConnectors,
  effectivePowerKw,
  hasUnconfirmedConnectors,
  isCompatible,
} from './rules';
import {dataTrust, timeAgo} from './trust';
import {extraMinutes, impactLabel, TripImpact, tripImpact} from './tripImpact';
import type {
  Station,
  StationConnector,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from './types';
import {estimateVehicleCharge, VehicleChargeEstimate} from './vehicleCharging';
import {distanceKm} from '../utils/geo';

/**
 * THE PLUGORBIT DECISION ENGINE.
 *
 * Instead of "which chargers are nearby?", it answers "which charger should THIS
 * driver use?" by scoring every candidate on many factors for the driver's
 * intent and returning one pick, its backup and a plain-language reason.
 *
 * Phase 1 is understandable weighted rules (see WEIGHTS). The engine is pure and
 * lives apart from the screens so the scoring can improve without touching UI.
 *
 * Product rules built in:
 *  - hard gates first: compatible, confirmed connectors, not out of service, not
 *    closed at arrival, reachable on the battery;
 *  - sponsorship is not an input anywhere;
 *  - in BATTERY CRITICAL the order is reachability, reliability, availability,
 *    distance, speed, and only then price: price can never beat reaching a
 *    working charger safely.
 */

export type DriverIntent = 'plan_trip' | 'charge_nearby' | 'battery_critical';

export type FactorId =
  | 'availability'
  | 'freshness'
  | 'reliability'
  | 'distance'
  | 'detour'
  | 'speed'
  | 'wait'
  | 'price'
  | 'faults'
  | 'amenities'
  | 'hours'
  | 'reach';

export type ScoreFactor = {
  id: FactorId;
  /** 0-1, higher is better for the driver. */
  value: number;
  weight: number;
};

/** Relative importance per intent. Price is absent from battery-critical. */
export const WEIGHTS: Record<
  DriverIntent,
  Partial<Record<FactorId, number>>
> = {
  plan_trip: {
    reliability: 22,
    detour: 18,
    availability: 16,
    speed: 12,
    freshness: 8,
    wait: 8,
    price: 6,
    faults: 5,
    amenities: 3,
    hours: 2,
  },
  charge_nearby: {
    availability: 20,
    reliability: 18,
    distance: 14,
    speed: 14,
    freshness: 8,
    detour: 8,
    wait: 8,
    price: 6,
    faults: 4,
  },
  battery_critical: {
    reach: 30,
    reliability: 22,
    availability: 18,
    distance: 14,
    speed: 8,
    freshness: 6,
    faults: 2,
  },
};

/** Battery the driver may arrive with, by intent (percent). */
const ARRIVAL_FLOOR_PCT: Record<DriverIntent, number> = {
  plan_trip: 5,
  charge_nearby: 5,
  battery_critical: 2,
};

/** A backup further than this from the pick is a different trip. */
const BACKUP_MAX_APART_KM = 40;
/** A backup that adds more than this to the stop isn't worth holding. */
const BACKUP_MAX_EXTRA_MIN = 30;
/** Within this many points, prefer a backup run by a different operator. */
const INDEPENDENCE_BONUS = 5;

export type Candidate = {
  station: StationWithDistance;
  /** Road km the driver covers to get there. Default: straight line x road factor. */
  roadKm?: number;
  /** Extra minutes versus staying on course. Default: the time to get there. */
  detourMin?: number;
  /** Minutes to get there. Default from roadKm and the context speed. */
  etaMin?: number;
  /** Battery on arrival, when a plan already knows it. Default from roadKm. */
  arriveSoc?: number;
  /** Charge target, when a plan already knows it. */
  chargeToSoc?: number;
  /** The connector a plan already chose. Default: the best one for this car. */
  connectorId?: string;
};

export type RecommendationContext = {
  intent: DriverIntent;
  vehicle: Vehicle;
  /** Battery now, percent. */
  socPercent: number;
  reservePct: number;
  now: number;
  /** Charge target when the candidate doesn't carry one. */
  targetSoc?: number;
  /** Average speed used to turn km into minutes (default 40 km/h). */
  speedKmh?: number;
  /** Wait estimate for a station; injected so the engine stays service-free. */
  waitOf: (station: Station, vehicle: Vehicle) => WaitEstimate;
  /** Driver confirmations in the last hour, by station id. */
  confirmations?: Readonly<Record<string, number>>;
  predictor?: AvailabilityPredictor;
};

export type ScoredCharger = {
  station: StationWithDistance;
  connector: StationConnector;
  intent: DriverIntent;
  /** The PlugOrbit score, 0-100. Ranking input: not shown to drivers. */
  score: number;
  factors: ScoreFactor[];
  roadKm: number;
  etaMin: number;
  arriveSoc: number;
  chargeToSoc: number;
  charge: VehicleChargeEstimate;
  wait: WaitEstimate;
  impact: TripImpact;
  cost: StopCostBreakdown;
  confidence: ChargeConfidence;
  arrival: ArrivalOutlook;
  /** Open at arrival, or null when the hours text doesn't say. */
  open: boolean | null;
  /** Up to three plain-language reasons, strongest first. */
  reasons: string[];
};

export type ExclusionReason =
  | 'incompatible'
  | 'unconfirmed_connectors'
  | 'out_of_service'
  | 'closed'
  | 'unreachable'
  | 'cannot_charge';

export type Exclusion = {
  stationId: string;
  name: string;
  reason: ExclusionReason;
};

export type CompareRow = {
  kind: 'fastest' | 'cheapest' | 'pick';
  stationId: string;
  stationName: string;
  totalInr: number | null;
  impactText: string;
};

export type RecommendationStatus =
  | 'ok'
  | 'no_candidates'
  | 'none_compatible'
  | 'none_reachable'
  | 'none_usable';

export type Recommendation = {
  intent: DriverIntent;
  status: RecommendationStatus;
  primary: ScoredCharger | null;
  backup: ScoredCharger | null;
  /** Extra minutes the backup adds compared with the pick. */
  backupExtraMin: number;
  /** Next-best choices after the pick and backup (at most two). */
  alternatives: ScoredCharger[];
  /** Everything that passed the gates, best first. */
  ranked: ScoredCharger[];
  excluded: Exclusion[];
  /** One calm sentence: why this charger. */
  reason: string;
  /** Fastest / Cheapest / Pick, only when comparing is actually useful. */
  comparison: CompareRow[] | null;
};

// ------------------------------------------------------------------ connectors --

/**
 * The connector this driver would use: a free one first, then the quickest for
 * this car, then the cheapest. Out-of-service connectors are never chosen.
 */
export function chooseConnector(
  station: Station,
  vehicle: Vehicle,
): StationConnector | null {
  const usable = compatibleConnectors(station, vehicle).filter(
    c => c.status !== 'offline',
  );
  if (usable.length === 0) {
    return null;
  }
  const price = (c: StationConnector) => c.pricePerKwh ?? Number.MAX_VALUE;
  const rank = (c: StationConnector) => (c.status === 'available' ? 0 : 1);
  return [...usable].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      effectivePowerKw(b, vehicle) - effectivePowerKw(a, vehicle) ||
      price(a) - price(b),
  )[0];
}

/** What charging to 80% (or 100% for AC-only cars) means for this intent. */
export function defaultTargetSoc(
  intent: DriverIntent,
  vehicle: Pick<Vehicle, 'maxDcKw'>,
): number {
  if (vehicle.maxDcKw <= 0) {
    return 100;
  }
  return intent === 'battery_critical' ? 60 : 80;
}

// --------------------------------------------------------------------- scoring --

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function reliabilityValue(s: Station): number {
  const rel = s.reliabilityPct;
  const success = s.successfulSessionsPct;
  if (rel <= 0 && success <= 0) {
    // No history: neither rewarded nor punished like a known-bad charger.
    return 0.45;
  }
  return clamp01((0.6 * (rel || success) + 0.4 * (success || rel)) / 100);
}

function freshnessValue(station: Station, now: number): number {
  const trust = dataTrust(station.statusFeed, now);
  if (trust === 'live') {
    return 1;
  }
  if (trust === 'user') {
    return 0.75;
  }
  if (trust === 'estimated') {
    const age =
      station.statusFeed.updatedAt === null
        ? Infinity
        : now - station.statusFeed.updatedAt;
    return age > 30 * 60 * 1000 ? 0.3 : 0.45;
  }
  return 0.15;
}

function availabilityValue(arrival: ArrivalOutlook): number {
  switch (arrival.risk) {
    case 'low':
      return 1;
    case 'medium':
      return 0.75;
    case 'high':
      return 0.2;
    default:
      return 0.4;
  }
}

type PriceRange = {min: number; max: number};

function priceValue(price: number | null, range: PriceRange | null): number {
  if (price === null) {
    return 0.3;
  }
  if (!range || range.max - range.min < 1e-9) {
    return 0.6;
  }
  return clamp01(1 - (price - range.min) / (range.max - range.min));
}

function priceRangeOf(
  candidates: readonly Candidate[],
  vehicle: Vehicle,
): PriceRange | null {
  const prices: number[] = [];
  candidates.forEach(c => {
    const conn = chooseConnector(c.station, vehicle);
    if (conn && conn.pricePerKwh !== null) {
      prices.push(conn.pricePerKwh);
    }
  });
  return prices.length === 0
    ? null
    : {min: Math.min(...prices), max: Math.max(...prices)};
}

function reasonsFor(c: {
  station: StationWithDistance;
  intent: DriverIntent;
  arriveSoc: number;
  arrival: ArrivalOutlook;
  charge: VehicleChargeEstimate;
  impact: TripImpact;
  priceScore: number;
  now: number;
}): string[] {
  const out: string[] = [];
  const s = c.station;
  const trust = dataTrust(s.statusFeed, c.now);
  if (c.intent === 'battery_critical') {
    out.push(`You can reach it with about ${Math.round(c.arriveSoc)}% left.`);
  }
  if (c.arrival.freeNow !== null && c.arrival.freeNow > 0) {
    out.push(
      trust === 'live'
        ? `A bay is free right now (live, updated ${timeAgo(
            s.statusFeed.updatedAt,
            c.now,
          )}).`
        : 'A bay was reported free, but the status isn’t live.',
    );
  }
  if (s.successfulSessionsPct >= 85) {
    out.push(
      `${Math.round(
        s.successfulSessionsPct,
      )}% of recent sessions here finish without a fault.`,
    );
  } else if (s.reliabilityPct >= 85) {
    out.push('Dependable: it has a strong reliability record.');
  }
  if (c.charge.canCharge && c.charge.minutes > 0) {
    out.push(
      c.charge.limitedBy === 'car'
        ? `Your car charges at its best here, about ${c.charge.minutes} min for this stop.`
        : `About ${c.charge.minutes} min to charge your car here.`,
    );
  }
  if (c.intent === 'plan_trip' && c.impact.detourMin <= 5) {
    out.push(
      c.impact.detourMin <= 1
        ? 'It’s right on your route.'
        : `Only a ${c.impact.detourMin} min detour.`,
    );
  }
  if (c.intent !== 'battery_critical' && c.priceScore >= 0.85) {
    out.push('One of the best prices around.');
  }
  if (s.amenities.length >= 3) {
    out.push('Food and restrooms close by.');
  }
  return out.slice(0, 3);
}

/** Hard gates, then the weighted score. Returns why a charger was left out. */
export function scoreCharger(
  candidate: Candidate,
  ctx: RecommendationContext,
  priceRange: PriceRange | null,
): ScoredCharger | Exclusion {
  const {station} = candidate;
  const {vehicle, intent, now} = ctx;
  const skip = (reason: ExclusionReason): Exclusion => ({
    stationId: station.id,
    name: station.name,
    reason,
  });

  if (hasUnconfirmedConnectors(station)) {
    return skip('unconfirmed_connectors');
  }
  if (!isCompatible(station, vehicle)) {
    return skip('incompatible');
  }
  const connector =
    (candidate.connectorId
      ? compatibleConnectors(station, vehicle).find(
          c => c.id === candidate.connectorId,
        )
      : undefined) ?? chooseConnector(station, vehicle);
  if (!connector) {
    return skip('out_of_service');
  }

  const roadKm = candidate.roadKm ?? station.distanceKm * ROAD_FACTOR;
  const speed = ctx.speedKmh ?? 40;
  const etaMin = candidate.etaMin ?? Math.max(2, (roadKm / speed) * 60);
  const arriveSoc =
    candidate.arriveSoc ?? ctx.socPercent - socCostOfKm(vehicle, roadKm);
  const floor = ARRIVAL_FLOOR_PCT[intent];
  if (arriveSoc < floor) {
    return skip('unreachable');
  }
  const open = isOpenAt(station.hours, now + etaMin * 60_000);
  if (open === false) {
    return skip('closed');
  }

  const target = Math.min(
    100,
    Math.max(
      candidate.chargeToSoc ??
        ctx.targetSoc ??
        defaultTargetSoc(intent, vehicle),
      arriveSoc,
    ),
  );
  const charge = estimateVehicleCharge(connector, vehicle, arriveSoc, target);
  if (!charge.canCharge) {
    return skip('cannot_charge');
  }

  const wait = ctx.waitOf(station, vehicle);
  const detour = candidate.detourMin ?? etaMin;
  const impact = tripImpact({
    detourMin: detour,
    wait,
    chargeMin: charge.minutes,
  });
  const cost = stopCostBreakdown({
    station,
    connector,
    vehicle,
    fromSoc: arriveSoc,
    toSoc: target,
  });
  const confidence = chargeConfidence(station, vehicle, now, {
    userConfirmations: ctx.confirmations?.[station.id],
  });
  const arrival = arrivalOutlook(
    station,
    vehicle,
    etaMin,
    now,
    ctx.predictor ?? NO_PREDICTION,
  );

  const usable = compatibleConnectors(station, vehicle);
  const downShare =
    usable.length === 0
      ? 0
      : usable.filter(c => c.status === 'offline').length / usable.length;
  const priceScore = priceValue(connector.pricePerKwh, priceRange);
  const values: Record<FactorId, number> = {
    availability: availabilityValue(arrival),
    freshness: freshnessValue(station, now),
    reliability: reliabilityValue(station),
    distance: clamp01(1 - roadKm / (intent === 'battery_critical' ? 25 : 40)),
    detour: clamp01(1 - detour / 30),
    speed: charge.minutes === 0 ? 1 : clamp01(1 - charge.minutes / 90),
    wait: wait.basis === 'none' ? 0.5 : clamp01(1 - wait.maxMinutes / 40),
    price: priceScore,
    faults: 1 - downShare,
    amenities: clamp01(station.amenities.length / 4),
    hours: open === true ? 1 : 0.7,
    reach: clamp01((arriveSoc - floor) / 30),
  };
  const weights = WEIGHTS[intent];
  const factors: ScoreFactor[] = (Object.keys(weights) as FactorId[]).map(
    id => ({id, value: values[id], weight: weights[id] ?? 0}),
  );
  const totalWeight = factors.reduce((n, f) => n + f.weight, 0);
  const score =
    (100 * factors.reduce((n, f) => n + f.weight * f.value, 0)) / totalWeight;

  return {
    station,
    connector,
    intent,
    score,
    factors,
    roadKm,
    etaMin,
    arriveSoc,
    chargeToSoc: target,
    charge,
    wait,
    impact,
    cost,
    confidence,
    arrival,
    open,
    reasons: reasonsFor({
      station,
      intent,
      arriveSoc,
      arrival,
      charge,
      impact,
      priceScore,
      now,
    }),
  };
}

function isScored(x: ScoredCharger | Exclusion): x is ScoredCharger {
  return (x as ScoredCharger).score !== undefined;
}

// --------------------------------------------------------------------- ranking --

function valueOf(c: ScoredCharger, id: FactorId): number {
  return c.factors.find(f => f.id === id)?.value ?? 0;
}

/**
 * Battery critical: strict priority, not a blend, so a cheap price can never
 * outrank a safer, more reliable, more available or closer charger.
 *   1 reachability margin  2 reliability  3 availability
 *   4 distance             5 speed        6 price
 */
export function compareCritical(a: ScoredCharger, b: ScoredCharger): number {
  const margin = (c: ScoredCharger) => (c.arriveSoc >= 6 ? 1 : 0);
  const reliability = (c: ScoredCharger) =>
    Math.floor(valueOf(c, 'reliability') * 5);
  const free = (c: ScoredCharger) => (c.arrival.risk === 'high' ? 0 : 1);
  const distance = (c: ScoredCharger) => Math.round(c.roadKm / 2);
  const speed = (c: ScoredCharger) => Math.floor(c.charge.minutes / 10);
  const price = (c: ScoredCharger) => c.cost.totalInr ?? Number.MAX_VALUE;
  return (
    margin(b) - margin(a) ||
    reliability(b) - reliability(a) ||
    free(b) - free(a) ||
    distance(a) - distance(b) ||
    speed(a) - speed(b) ||
    price(a) - price(b) ||
    b.score - a.score
  );
}

export function rankScored(
  list: readonly ScoredCharger[],
  intent: DriverIntent,
): ScoredCharger[] {
  const sorted = [...list];
  if (intent === 'battery_critical') {
    return sorted.sort(compareCritical);
  }
  return sorted.sort((a, b) => b.score - a.score || a.roadKm - b.roadKm);
}

/**
 * The backup for `primary`: reachable, a short hop from it, not a big extra
 * delay, and preferably run by someone else so one operator's outage can't take
 * out both. Returns null when nothing qualifies (callers must say so).
 */
export function pickBackup(
  primary: ScoredCharger,
  ranked: readonly ScoredCharger[],
): {backup: ScoredCharger; extraMin: number} | null {
  const options = ranked
    .filter(o => o.station.id !== primary.station.id)
    .map(o => ({
      o,
      extra: extraMinutes(primary.impact, o.impact),
      apart: distanceKm(primary.station, o.station),
    }))
    .filter(
      x => x.extra <= BACKUP_MAX_EXTRA_MIN && x.apart <= BACKUP_MAX_APART_KM,
    );
  if (options.length === 0) {
    return null;
  }
  const adjusted = (x: (typeof options)[number]) =>
    x.o.score -
    (x.o.station.operator === primary.station.operator
      ? INDEPENDENCE_BONUS
      : 0);
  const best = [...options].sort((a, b) => adjusted(b) - adjusted(a))[0];
  return {backup: best.o, extraMin: best.extra};
}

function compareRows(
  pick: ScoredCharger,
  ranked: readonly ScoredCharger[],
): CompareRow[] | null {
  if (ranked.length < 2) {
    return null;
  }
  const row = (kind: CompareRow['kind'], c: ScoredCharger): CompareRow => ({
    kind,
    stationId: c.station.id,
    stationName: c.station.name,
    totalInr: c.cost.totalInr,
    impactText: impactLabel(c.impact),
  });
  const fastest = [...ranked].sort(
    (a, b) =>
      a.impact.totalMinMinutes +
      a.impact.totalMaxMinutes -
      (b.impact.totalMinMinutes + b.impact.totalMaxMinutes),
  )[0];
  const priced = ranked.filter(c => c.cost.totalInr !== null);
  const cheapest =
    priced.length === 0
      ? null
      : [...priced].sort(
          (a, b) => (a.cost.totalInr ?? 0) - (b.cost.totalInr ?? 0),
        )[0];
  const differs =
    fastest.station.id !== pick.station.id ||
    (cheapest !== null && cheapest.station.id !== pick.station.id);
  if (!differs) {
    return null;
  }
  const rows: CompareRow[] = [];
  if (fastest.station.id !== pick.station.id) {
    rows.push(row('fastest', fastest));
  }
  if (cheapest && cheapest.station.id !== pick.station.id) {
    rows.push(row('cheapest', cheapest));
  }
  rows.push(row('pick', pick));
  return rows;
}

/** Score every candidate for the driver's intent and pick one, with a backup. */
export function recommend(
  candidates: readonly Candidate[],
  ctx: RecommendationContext,
): Recommendation {
  const range = priceRangeOf(candidates, ctx.vehicle);
  const scored: ScoredCharger[] = [];
  const excluded: Exclusion[] = [];
  candidates.forEach(c => {
    const r = scoreCharger(c, ctx, range);
    if (isScored(r)) {
      scored.push(r);
    } else {
      excluded.push(r);
    }
  });
  const ranked = rankScored(scored, ctx.intent);
  const empty = (status: RecommendationStatus): Recommendation => ({
    intent: ctx.intent,
    status,
    primary: null,
    backup: null,
    backupExtraMin: 0,
    alternatives: [],
    ranked: [],
    excluded,
    reason: '',
    comparison: null,
  });

  if (ranked.length === 0) {
    if (candidates.length === 0) {
      return empty('no_candidates');
    }
    const count = (r: ExclusionReason) =>
      excluded.filter(e => e.reason === r).length;
    if (count('unreachable') > 0) {
      return empty('none_reachable');
    }
    if (
      count('out_of_service') + count('closed') + count('cannot_charge') >
      0
    ) {
      return empty('none_usable');
    }
    return empty('none_compatible');
  }

  const primary = ranked[0];
  const picked = pickBackup(primary, ranked);
  const rest = ranked.filter(
    c =>
      c.station.id !== primary.station.id &&
      c.station.id !== picked?.backup.station.id,
  );
  return {
    intent: ctx.intent,
    status: 'ok',
    primary,
    backup: picked?.backup ?? null,
    backupExtraMin: picked?.extraMin ?? 0,
    alternatives: rest.slice(0, 2),
    ranked,
    excluded,
    reason: primary.reasons.slice(0, 2).join(' '),
    comparison: compareRows(primary, ranked),
  };
}

/** Driver-facing explanation for an empty result. */
export function emptyRecommendationCopy(status: RecommendationStatus): {
  title: string;
  body: string;
} {
  switch (status) {
    case 'none_reachable':
      return {
        title: 'No charger within reach of your battery',
        body: 'Nothing compatible is close enough to reach safely. Roadside help can bring you a charge, and we’ll keep looking.',
      };
    case 'none_usable':
      return {
        title: 'The nearby chargers aren’t usable right now',
        body: 'They’re out of service, closed, or can’t charge your car at the moment. We’ll keep checking.',
      };
    case 'none_compatible':
      return {
        title: 'No compatible charger found',
        body: 'We couldn’t find a charger that fits your car nearby. Try a wider search or check your car’s connector.',
      };
    default:
      return {
        title: 'No chargers found nearby',
        body: 'Move the map or try again in a moment.',
      };
  }
}
