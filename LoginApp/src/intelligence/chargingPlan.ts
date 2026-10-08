import type {Station, Vehicle} from '../domain/types';
import {stationHealth} from '../domain/rules';
import {Path, project} from '../utils/path';
import {selectBackup} from './backup';
import {driveMinutes, safeReachKm, socAfterKm} from './battery';
import type {SmartDriveConfig} from './config';
import {chargeConfidenceOf, dataConfidenceOf} from './confidence';
import {
  Scorable,
  fieldStats,
  rankStops,
  tripImpactMid,
  weightsFor,
} from './recommendation';
import {evaluateArrival, evaluateStation} from './safety';
import {
  chooseConnector,
  computeStopMetrics,
  estimateStopsAfter,
} from './stopMetrics';
import type {
  BackupStop,
  ChargingPlan,
  DriveConditions,
  DriveMode,
  PreferenceProfile,
  Readiness,
  RouteRisk,
  RuledOut,
  SafetyViolationCode,
  ScoredStop,
  SwitchInfo,
} from './types';

/** A new backup must beat the current one by this much (0-1) to replace it. */
const BACKUP_SWAP_MARGIN = 0.08;

export type PlanInput = {
  now: number;
  vehicle: Vehicle;
  path: Path;
  progressKm: number;
  soc: number;
  stations: readonly Station[];
  config: SmartDriveConfig;
  reservePct?: number;
  profile?: PreferenceProfile;
  preferAmenities?: boolean;
  conditions?: DriveConditions;
  /** The current primary. Hysteresis keeps it unless there is a clear reason. */
  incumbentId?: string | null;
  /** A charger the driver told us to keep. */
  pinnedId?: string | null;
  /** Keep the incumbent while it stays safe (offline, or already at the charger). */
  holdIncumbent?: boolean;
  /** The current backup: kept unless another is clearly stronger. */
  incumbentBackupId?: string | null;
  /** The charger we most recently switched away from, and when. */
  recentlyLeft?: {stationId: string; at: number} | null;
  excludeIds?: readonly string[];
};

type Raw = {station: Station; alongKm: number; lateralKm: number};

type Evaluated = {
  safe: Scorable[];
  ruledOut: RuledOut[];
};

/**
 * ChargingPlanService: the one place the engines meet.
 *
 *   1. find chargers on the way
 *   2. SafetyRuleEngine removes everything unsafe        (deterministic)
 *   3. RecommendationEngine ranks what is left           (explainable score)
 *   4. BackupSelectionService picks a Plan B for each
 *   5. a stability policy decides whether to change an earlier choice
 *
 * It is a pure function of its input: same world in, same plan out.
 */
export function planCharging(input: PlanInput): ChargingPlan {
  const {config, vehicle, path, now} = input;
  const reserve = input.reservePct ?? config.minimumSafetyReservePct;
  const profile = input.profile ?? 'balanced';
  const progress = Math.min(Math.max(0, input.progressKm), path.totalKm);
  const remainingKm = Math.max(0, path.totalKm - progress);

  const destinationSoc = socAfterKm(
    vehicle,
    input.soc,
    remainingKm,
    config,
    input.conditions,
  );
  const chargingRequired = destinationSoc.low < reserve;
  const destinationEta =
    now + driveMinutes(remainingKm, config, input.conditions) * 60000;

  // 1. Chargers ahead of the driver and close enough to the road.
  const exclude = new Set(input.excludeIds ?? []);
  const raws: Raw[] = [];
  input.stations.forEach(station => {
    if (exclude.has(station.id)) {
      return;
    }
    const {along, lateral} = project(path, station);
    if (lateral > config.maxLateralKm) {
      return;
    }
    // Ahead of the driver, or at the very junction: a stop stays in the plan
    // until the driver has actually driven past it.
    if (along < progress - 0.5 || along >= path.totalKm - 0.5) {
      return;
    }
    raws.push({station, alongKm: along, lateralKm: lateral});
  });

  // Chargers that pass the static rules also show where later stops can be.
  const fixedOk = raws.filter(
    r => evaluateStation(r.station, vehicle).length === 0,
  );
  const continuationPool = fixedOk.map(r => ({alongKm: r.alongKm}));

  const evaluateAll = (mode: DriveMode): Evaluated => {
    const safe: Scorable[] = [];
    const ruledOut: RuledOut[] = [];
    raws.forEach(raw => {
      const fixed = evaluateStation(raw.station, vehicle);
      if (fixed.length > 0) {
        ruledOut.push({
          stationId: raw.station.id,
          stationName: raw.station.name,
          codes: fixed.map(v => v.code),
        });
        return;
      }
      const connector = chooseConnector(raw.station, vehicle);
      if (!connector) {
        ruledOut.push({
          stationId: raw.station.id,
          stationName: raw.station.name,
          codes: ['CHARGER_OFFLINE'],
        });
        return;
      }
      const cont = estimateStopsAfter({
        vehicle,
        fromAlongKm: raw.alongKm,
        totalKm: path.totalKm,
        reservePct: reserve,
        others: continuationPool,
        config,
        conditions: input.conditions,
      });
      const metrics = computeStopMetrics({
        station: raw.station,
        connector,
        vehicle,
        now,
        progressKm: progress,
        soc: input.soc,
        alongKm: raw.alongKm,
        lateralKm: raw.lateralKm,
        totalKm: path.totalKm,
        reservePct: reserve,
        hasLaterOptions: cont.feasible && cont.stopsAfter >= 1,
        config,
        conditions: input.conditions,
      });
      const verdict = evaluateArrival(
        raw.station,
        {etaAt: metrics.etaAt, arriveSoc: metrics.arriveSoc, connector},
        now,
        mode,
        reserve,
        config,
      );
      if (verdict.violations.length > 0) {
        ruledOut.push({
          stationId: raw.station.id,
          stationName: raw.station.name,
          codes: verdict.violations.map(v => v.code),
        });
        return;
      }
      safe.push({
        station: raw.station,
        alongKm: raw.alongKm,
        lateralKm: raw.lateralKm,
        metrics,
        warnings: verdict.warnings,
        dataConfidence: dataConfidenceOf(raw.station, now),
        chargeConfidence: chargeConfidenceOf(
          raw.station,
          vehicle,
          now,
          verdict.warnings,
        ),
        continuation: cont,
      });
    });
    return {safe, ruledOut};
  };

  // 2. Safety. Battery-critical mode relaxes the arrival floor, nothing else.
  let mode: DriveMode =
    input.soc <= config.batteryCriticalPct ? 'battery_critical' : 'normal';
  let modeReason: ChargingPlan['modeReason'] =
    mode === 'battery_critical' ? 'low_battery' : null;
  let result = evaluateAll(mode);
  if (mode === 'normal' && chargingRequired && result.safe.length === 0) {
    const critical = evaluateAll('battery_critical');
    if (critical.safe.length > 0) {
      mode = 'battery_critical';
      modeReason = 'no_safe_option_with_reserve';
      result = critical;
    }
  }

  // Necessity: when the trip needs a charge, do not make a stop that adds
  // almost nothing while a better-timed safe one exists. This is a rule, not a
  // weight, because a score can always be outvoted by many small advantages
  // (cheap, close, always free) and would happily pick a two-hour stop at the
  // start line. Battery-critical mode takes the closest safe charger instead.
  let tooEarly: string[] = [];
  if (mode === 'normal' && chargingRequired) {
    const pool = result.safe;
    // Measured up to the comfort cap: charging past it is slow, so it is not
    // what makes a stop worth making.
    const worthwhile = (c: Scorable) =>
      Math.min(c.metrics.targetSoc, config.maxChargeToPct) -
        c.metrics.arriveSoc.expected >=
      config.minWorthwhileChargePct;
    const laterExists = (c: Scorable) =>
      result.safe.some(d => d.alongKm > c.alongKm + 1);
    const needed = pool.filter(c => worthwhile(c) || !laterExists(c));
    if (needed.length > 0 && needed.length < pool.length) {
      tooEarly = pool.filter(c => !needed.includes(c)).map(c => c.station.id);
    }
  }
  const tooEarlySet = new Set(tooEarly);

  // 3 & 4. Rank, then rank again knowing how good each one's Plan B is.
  const floorPct =
    mode === 'battery_critical' ? config.absoluteFloorPct : reserve;
  const reachKm = safeReachKm(
    vehicle,
    input.soc,
    floorPct,
    config,
    input.conditions,
  );
  const weights = weightsFor(
    mode,
    profile,
    input.preferAmenities ?? false,
    config,
  );
  const baseCtx = {
    mode,
    vehicle,
    now,
    reservePct: reserve,
    floorPct,
    config,
    weights,
    stats: fieldStats(result.safe, reachKm),
  };
  const firstPass = rankStops(result.safe, baseCtx);
  const strengths = new Map<string, number>();
  firstPass.forEach(c => {
    const b = selectBackup({
      primary: c,
      candidates: firstPass,
      vehicle,
      config,
      conditions: input.conditions,
    });
    strengths.set(c.station.id, b ? b.strength : 0);
  });
  // Everything safe is scored (any of it can be a Plan B); only chargers that
  // are worth stopping at yet may become the primary.
  const rankedAll = rankStops(result.safe, {
    ...baseCtx,
    backupStrength: strengths,
  });
  const ranked = rankedAll.filter(s => !tooEarlySet.has(s.station.id));

  // 5. Stability policy: a plan the driver has already heard about does not
  //    change for a marginal gain. Two questions decide a change: is there a
  //    comparable charger that clearly SAVES TIME, or one that is clearly BETTER
  //    overall? (Never one that is quicker only because it is worse.)
  let primary: ScoredStop | null = null;
  let switched: SwitchInfo | null = null;
  let held: ChargingPlan['held'] = null;
  if (chargingRequired && ranked.length > 0) {
    const best = ranked[0];
    primary = best;
    const holdId =
      input.pinnedId ??
      (input.holdIncumbent ? input.incumbentId : null) ??
      null;
    const anchorId = input.incumbentId ?? holdId;
    const holding = holdId
      ? ranked.find(s => s.station.id === holdId)
      : undefined;
    if (holding) {
      primary = holding;
    } else if (anchorId) {
      const incumbent = ranked.find(s => s.station.id === anchorId);
      if (!incumbent) {
        // Gone from the safe set. If we ruled it out, that is a safety switch;
        // if the driver simply drove past it, it is just the next stop.
        if (result.ruledOut.some(r => r.stationId === anchorId)) {
          switched = {
            from: anchorId,
            to: best.station.id,
            fromName:
              result.ruledOut.find(r => r.stationId === anchorId)
                ?.stationName ?? 'your previous stop',
            toName: best.station.name,
            reason: 'safety',
            minutesSaved: 0,
          };
        }
      } else {
        const impact = (s: ScoredStop) => tripImpactMid(s, config);
        const locked =
          incumbent.metrics.distanceFromDriverKm <= config.switchLockKm;
        const options = ranked
          .filter(s => s.station.id !== incumbent.station.id)
          .filter(
            s =>
              s.score >= incumbent.score - config.switchQualityMargin &&
              s.chargeConfidence !== 'low',
          )
          .map(s => ({
            stop: s,
            saved: impact(incumbent) - impact(s),
            gap: s.score - incumbent.score,
          }));
        const leftRecently = (id: string) =>
          input.recentlyLeft?.stationId === id &&
          now - input.recentlyLeft.at < config.switchBackCooldownMin * 60000;
        const allowed = options.filter(o => {
          // Going back to a charger we just left must clear twice the bar.
          const k = leftRecently(o.stop.station.id) ? 2 : 1;
          return locked
            ? o.saved >= config.switchLockSavingMin * k
            : o.saved >= config.switchMinSavingMin * k ||
                o.gap >= config.switchScoreMargin * k;
        });
        // Of the changes worth making, take the one that saves the most time.
        const pick = [...allowed].sort(
          (a, b) => b.saved - a.saved || b.gap - a.gap,
        )[0];
        if (pick) {
          primary = pick.stop;
          switched = {
            from: incumbent.station.id,
            to: pick.stop.station.id,
            fromName: incumbent.station.name,
            toName: pick.stop.station.name,
            reason:
              pick.saved >= config.switchMinSavingMin
                ? 'time_saved'
                : 'better_score',
            minutesSaved: Math.max(0, Math.round(pick.saved)),
          };
        } else {
          primary = incumbent;
          const near = [...options].sort((a, b) => b.saved - a.saved)[0];
          if (near && near.saved > 0) {
            held = {
              stationId: near.stop.station.id,
              stationName: near.stop.station.name,
              minutesSaved: Math.round(near.saved),
            };
          }
        }
      }
    }
  }

  let backup: BackupStop | null = primary
    ? selectBackup({
        primary,
        candidates: rankedAll,
        vehicle,
        config,
        conditions: input.conditions,
      })
    : null;
  // A Plan B that is still good is not swapped for one that is only marginally
  // better: the driver was told about it, and churn erodes trust.
  if (primary && backup && input.incumbentBackupId) {
    if (backup.station.id !== input.incumbentBackupId) {
      const kept = rankedAll.find(
        s => s.station.id === input.incumbentBackupId,
      );
      const keptAsBackup = kept
        ? selectBackup({
            primary,
            candidates: [kept],
            vehicle,
            config,
            conditions: input.conditions,
          })
        : null;
      if (
        keptAsBackup &&
        backup.strength - keptAsBackup.strength < BACKUP_SWAP_MARGIN
      ) {
        backup = keptAsBackup;
      }
    }
  }

  const chosenIds = new Set(
    [primary?.station.id, backup?.station.id].filter(Boolean) as string[],
  );
  const alternatives = ranked
    .filter(s => !chosenIds.has(s.station.id))
    .slice(0, 3);

  const limitedOptions =
    chargingRequired && (!primary || !backup || ranked.length <= 1);

  const readiness: Readiness = !chargingRequired
    ? 'good_to_drive'
    : primary
    ? 'good_to_drive'
    : progress <= 1
    ? 'charge_first'
    : 'limited_options';

  return {
    computedAt: now,
    mode,
    modeReason,
    progressKm: progress,
    socNow: input.soc,
    remainingKm,
    readiness,
    chargingRequired,
    destination: {
      etaAt: destinationEta,
      socWithoutCharging: destinationSoc,
      socWithPlan: !chargingRequired
        ? destinationSoc
        : primary &&
          primary.continuation.feasible &&
          primary.continuation.stopsAfter === 0
        ? socAfterKm(
            vehicle,
            primary.metrics.targetSoc,
            path.totalKm - primary.alongKm,
            config,
            input.conditions,
          )
        : null,
    },
    primary,
    backup,
    alternatives,
    safetyNet: result.safe.length,
    stopsAfterPrimary: primary ? primary.continuation.stopsAfter : 0,
    considered: raws.length,
    ruledOut: result.ruledOut,
    tooEarly,
    routeRisk: riskOf({
      chargingRequired,
      mode,
      primary,
      backup,
      safetyNet: result.safe.length,
    }),
    limitedOptions,
    switched,
    held,
  };
}

function riskOf(args: {
  chargingRequired: boolean;
  mode: DriveMode;
  primary: ScoredStop | null;
  backup: BackupStop | null;
  safetyNet: number;
}): RouteRisk {
  if (args.chargingRequired && !args.primary) {
    return 'high';
  }
  if (args.mode === 'battery_critical') {
    return 'high';
  }
  if (!args.chargingRequired || !args.primary) {
    return 'low';
  }
  let points = 0;
  if (!args.backup) {
    points += 2;
  } else if (args.backup.strength < 0.4) {
    points += 1;
  }
  if (args.primary.chargeConfidence === 'low') {
    points += 1;
  }
  if (args.safetyNet <= 1) {
    points += 1;
  }
  if (!args.primary.continuation.feasible) {
    points += 2;
  }
  // Having to charge past the comfort cap is slower, and a sign the route is thin.
  if (args.primary.continuation.beyondCap) {
    points += 1;
  }
  return points >= 3 ? 'high' : points >= 1 ? 'medium' : 'low';
}

/** How the safety engine's rejections read, grouped, for "why not X?" answers. */
export function summariseRuledOut(
  ruledOut: readonly RuledOut[],
): Array<{code: SafetyViolationCode; count: number}> {
  const counts = new Map<SafetyViolationCode, number>();
  ruledOut.forEach(r =>
    r.codes.forEach(code => counts.set(code, (counts.get(code) ?? 0) + 1)),
  );
  return [...counts.entries()]
    .map(([code, count]) => ({code, count}))
    .sort((a, b) => b.count - a.count);
}

/** Coarse state of a station for this car; used to detect changes between ticks. */
export function stateOf(station: Station, vehicle: Vehicle) {
  const h = stationHealth(station, vehicle);
  return h;
}
