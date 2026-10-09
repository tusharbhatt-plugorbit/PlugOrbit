import {LIVE_MAX_AGE_MS} from '../domain/trust';
import type {Station, Vehicle} from '../domain/types';
import {clamp} from '../utils/format';
import {AMENITIES_BOOST, PROFILE_MULTIPLIERS, SmartDriveConfig} from './config';
import {isAlwaysOpen} from './hours';
import {rangeMid} from './stopMetrics';
import type {
  DriveMode,
  PreferenceProfile,
  ReasonCode,
  ScoreComponent,
  ScoredStop,
  Weights,
} from './types';
import {waitMid} from './wait';

/**
 * RecommendationEngine (Phase 1: explainable weighted scoring).
 *
 * It only ever sees chargers the SafetyRuleEngine already allowed. It does not
 * pick the nearest, the fastest or the cheapest: it picks the stop with the best
 * overall chance of a smooth charge, by weighing every factor in one score
 * whose parts are all kept (`components`) and turned into reason codes.
 *
 * Weights live in `config.ts`. Machine learning can later replace individual
 * components (availability, wait, reliability) without changing this contract.
 */

export type Scorable = Omit<ScoredStop, 'score' | 'components' | 'reasons'>;

/**
 * Minutes this stop adds to the WHOLE trip: its own time plus the stops it
 * forces later. Comparing stops on their own time alone would favour stopping
 * early for a quick top-up and then having to stop again.
 */
export function tripImpactMid(
  c: Pick<Scorable, 'metrics' | 'continuation'>,
  config: Pick<
    SmartDriveConfig,
    'downstreamStopMin' | 'infeasiblePenaltyMin' | 'beyondCapPenaltyMin'
  >,
): number {
  const own = rangeMid(c.metrics.totalStopMin);
  if (!c.continuation.feasible) {
    return own + config.infeasiblePenaltyMin;
  }
  return (
    own +
    c.continuation.stopsAfter * config.downstreamStopMin +
    (c.continuation.beyondCap ? config.beyondCapPenaltyMin : 0)
  );
}

export function normalise(weights: Weights): Weights {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const out = {} as Weights;
  (Object.keys(weights) as ScoreComponent[]).forEach(k => {
    out[k] = weights[k] / total;
  });
  return out;
}

/**
 * The weights for this moment. Battery-critical mode ignores every preference:
 * safer always beats cheaper.
 */
export function weightsFor(
  mode: DriveMode,
  profile: PreferenceProfile,
  preferAmenities: boolean,
  config: Pick<SmartDriveConfig, 'weights'>,
): Weights {
  if (mode === 'battery_critical') {
    return normalise(config.weights.critical);
  }
  const w = {...config.weights.normal};
  const mult = PROFILE_MULTIPLIERS[profile];
  (Object.keys(mult) as ScoreComponent[]).forEach(k => {
    w[k] *= mult[k] ?? 1;
  });
  if (preferAmenities) {
    w.amenities *= AMENITIES_BOOST;
  }
  return normalise(w);
}

export type FieldStats = {
  minCost: number | null;
  maxCost: number | null;
  reachKm: number;
};

export function fieldStats(
  field: readonly Scorable[],
  reachKm: number,
): FieldStats {
  const costs = field
    .map(c => c.metrics.cost.totalInr)
    .filter((c): c is number => c !== null);
  return {
    minCost: costs.length ? Math.min(...costs) : null,
    maxCost: costs.length ? Math.max(...costs) : null,
    reachKm,
  };
}

export type ScoreContext = {
  mode: DriveMode;
  vehicle: Vehicle;
  now: number;
  reservePct: number;
  /** Arrival floor for the mode: the reserve normally, the absolute floor when critical. */
  floorPct: number;
  config: SmartDriveConfig;
  weights: Weights;
  stats: FieldStats;
  /** 0-1 per station id; missing means "not assessed yet" (neutral). */
  backupStrength?: ReadonlyMap<string, number>;
};

function amenityScore(station: Station): number {
  const weight = (a: Station['amenities'][number]) =>
    a === 'restroom' || a === 'food' || a === 'cafe' ? 1 : 0.5;
  return clamp(station.amenities.reduce((s, a) => s + weight(a), 0) / 3, 0, 1);
}

const TRUST_FACTOR = {live: 1, user: 0.9, estimated: 0.75, unknown: 0.5};

function reliabilityScore(s: Station): number {
  const rel = s.reliabilityPct > 0 ? s.reliabilityPct / 100 : null;
  const ok = s.successfulSessionsPct > 0 ? s.successfulSessionsPct / 100 : null;
  if (rel === null && ok === null) {
    // Nobody has measured this charger. Unknown is middling, not good.
    return 0.4;
  }
  const base =
    rel !== null && ok !== null ? 0.7 * rel + 0.3 * ok : rel ?? ok ?? 0;
  return s.rating > 0 ? base * 0.9 + 0.1 * (s.rating / 5) : base;
}

function freshnessScore(c: Scorable, now: number): number {
  const at = c.station.statusFeed.updatedAt;
  if (at === null) {
    return 0.1;
  }
  const age = Math.max(0, now - at);
  switch (c.dataConfidence) {
    case 'live':
      return 1 - Math.min(1, age / LIVE_MAX_AGE_MS) * 0.1;
    case 'user':
      return Math.max(0.3, 0.7 - (age / (30 * 60000)) * 0.4);
    case 'estimated':
      return Math.max(0.2, 0.55 - (age / (60 * 60000)) * 0.35);
    default:
      return 0.1;
  }
}

function timingScore(arriveLow: number, reservePct: number): number {
  const lo = reservePct + 4;
  const hi = reservePct + 16;
  if (arriveLow >= lo && arriveLow <= hi) {
    return 1;
  }
  if (arriveLow < lo) {
    return 0.8;
  }
  // Charging very early wastes the battery you already have.
  return Math.max(0.1, 1 - (arriveLow - hi) / 50);
}

export function componentsFor(
  c: Scorable,
  ctx: ScoreContext,
): Record<ScoreComponent, number> {
  const {metrics, station} = c;
  const peak =
    metrics.connectorType !== 'Type2' && ctx.vehicle.maxDcKw > 0
      ? ctx.vehicle.maxDcKw
      : ctx.vehicle.maxAcKw;
  const wait = metrics.wait;
  const availability =
    wait.basis === 'none'
      ? 0.3
      : clamp(1 - waitMid(wait) / 30, 0, 1) * TRUST_FACTOR[c.dataConfidence];
  const total = tripImpactMid(c, ctx.config);
  const {minCost, maxCost} = ctx.stats;
  const cost = metrics.cost.totalInr;
  const costScore =
    cost === null
      ? 0.5
      : minCost === null || maxCost === null || maxCost === minCost
      ? 1
      : 1 - (cost - minCost) / (maxCost - minCost);
  const dcCar = ctx.vehicle.maxDcKw > 0;
  const compat = !dcCar || metrics.connectorType !== 'Type2' ? 1 : 0.5;
  const cont = c.continuation.feasible
    ? c.continuation.stopsAfter === 0
      ? 1
      : Math.max(0.4, 0.7 - 0.1 * (c.continuation.stopsAfter - 1))
    : 0;

  return {
    compatibility: compat,
    reachability: clamp((metrics.arriveSoc.low - ctx.floorPct) / 20, 0, 1),
    reliability: clamp(reliabilityScore(station), 0, 1),
    availability: clamp(availability, 0, 1),
    freshness: clamp(freshnessScore(c, ctx.now), 0, 1),
    routeFit: 1 - clamp(c.lateralKm / ctx.config.maxLateralKm, 0, 1),
    stopTime: clamp(
      1 - (total - ctx.config.stopTimeFloorMin) / ctx.config.stopTimeSpanMin,
      0,
      1,
    ),
    speed: clamp(metrics.expectedKw / Math.max(peak, 1), 0, 1),
    cost: costScore,
    backup: ctx.backupStrength?.get(station.id) ?? 0.5,
    amenities: amenityScore(station),
    timing: timingScore(metrics.arriveSoc.low, ctx.reservePct),
    proximity:
      1 -
      clamp(
        metrics.distanceFromDriverKm / Math.max(ctx.stats.reachKm, 1),
        0,
        1,
      ),
    continuation: cont,
  };
}

export function scoreOf(
  components: Record<ScoreComponent, number>,
  weights: Weights,
): number {
  const keys = Object.keys(weights) as ScoreComponent[];
  const sum = keys.reduce((s, k) => s + weights[k] * components[k], 0);
  return Math.round(sum * 1000) / 10;
}

/**
 * Reason codes: the machine-readable "why", derived from the same components
 * that produced the score and from how the pick compares with the field.
 */
export function reasonsFor(
  c: ScoredStop,
  field: readonly ScoredStop[],
  ctx: Pick<ScoreContext, 'mode' | 'floorPct' | 'config' | 'vehicle'>,
): ReasonCode[] {
  const out: ReasonCode[] = ['REASON_COMPATIBLE'];
  const k = c.components;
  if (ctx.mode === 'battery_critical') {
    out.push('REASON_SAFEST_REACHABLE');
  } else if (c.metrics.arriveSoc.low - ctx.floorPct >= 6) {
    out.push('REASON_REACHABLE_SAFELY');
  }
  if (c.lateralKm <= 2) {
    out.push('REASON_LOW_DETOUR');
  }
  if (c.station.reliabilityPct >= 85 || k.reliability >= 0.85) {
    out.push('REASON_HIGH_RELIABILITY');
  }
  if (c.dataConfidence === 'live' && k.availability >= 0.8) {
    out.push('REASON_LIVE_AVAILABILITY');
  }
  const others = field.filter(f => f.station.id !== c.station.id);
  const mine = tripImpactMid(c, ctx.config);
  if (
    others.length > 0 &&
    others.every(f => tripImpactMid(f, ctx.config) - mine >= 5)
  ) {
    out.push('REASON_FASTER_TRIP');
  }
  if (c.metrics.expectedKw >= 0.8 * Math.max(ctx.vehicle.maxDcKw, 1)) {
    out.push('REASON_FAST_FOR_YOUR_CAR');
  }
  if (k.cost >= 0.75 && c.metrics.cost.totalInr !== null && others.length > 0) {
    out.push('REASON_LOWER_COST');
  }
  if (c.station.amenities.length >= 3) {
    out.push('REASON_AMENITIES');
  }
  if (isAlwaysOpen(c.station.hours)) {
    out.push('REASON_OPEN_24_7');
  }
  if (c.continuation.feasible && c.continuation.stopsAfter === 0) {
    out.push('REASON_FEWER_STOPS');
  }
  if (k.backup >= 0.6) {
    out.push('REASON_STRONG_BACKUP');
  }
  return out;
}

/** Score, order and explain a set of ALREADY-SAFE chargers. Best first. */
export function rankStops(
  field: readonly Scorable[],
  ctx: ScoreContext,
): ScoredStop[] {
  const scored: ScoredStop[] = field.map(c => {
    const components = componentsFor(c, ctx);
    return {
      ...c,
      components,
      score: scoreOf(components, ctx.weights),
      reasons: [],
    };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      // Deterministic tie-break: the one closer to the driver.
      a.metrics.distanceFromDriverKm - b.metrics.distanceFromDriverKm ||
      a.station.id.localeCompare(b.station.id),
  );
  return scored.map(s => ({...s, reasons: reasonsFor(s, scored, ctx)}));
}
