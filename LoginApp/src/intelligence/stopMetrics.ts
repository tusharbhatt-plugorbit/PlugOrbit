import {GST_RATE, energyToCharge, minutesToCharge} from '../domain/charging';
import {compatibleConnectors, effectivePowerKw} from '../domain/rules';
import type {Station, StationConnector, Vehicle} from '../domain/types';
import {driveMinutes, safeReachKm, socAfterKm, socNeededFor} from './battery';
import type {SmartDriveConfig} from './config';
import type {
  DriveConditions,
  Range,
  StopCost,
  StopMetrics,
  SocRange,
} from './types';
import {expectedWait} from './wait';

/**
 * The connector a stop would really use: free ones first, then the fastest this
 * car can draw, then the cheapest. Offline bays are never chosen.
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
  const free = usable.filter(c => c.status === 'available');
  const pool = free.length > 0 ? free : usable;
  const price = (c: StationConnector) => c.pricePerKwh ?? Number.MAX_VALUE;
  return [...pool].sort(
    (a, b) =>
      effectivePowerKw(b, vehicle) - effectivePowerKw(a, vehicle) ||
      price(a) - price(b),
  )[0];
}

function around(value: number, share: number): Range {
  return {
    min: Math.max(1, Math.round(value * (1 - share))),
    max: Math.max(2, Math.round(value * (1 + share))),
  };
}

/** Average kW the car draws over the session (accounts for the slow top-up). */
export function averageKw(
  fromSoc: number,
  toSoc: number,
  powerKw: number,
  batteryKwh: number,
): number {
  const minutes = minutesToCharge(fromSoc, toSoc, powerKw, batteryKwh);
  if (minutes <= 0) {
    return powerKw;
  }
  return energyToCharge(fromSoc, toSoc, batteryKwh) / (minutes / 60);
}

export type ChargeTarget = {
  targetSoc: number;
  reason: 'finish_trip' | 'reach_next_stop' | 'best_effort';
  savedVsCapMin: number | null;
};

/**
 * How much to charge: just enough for what is still ahead, not "to 100%".
 * Enough to finish with the reserve and a small buffer; if that is more than
 * the comfort cap and another stop follows, charge to the cap and let that stop
 * finish the job. Charging beyond the cap happens only when nothing follows.
 */
export function chargeTargetFor(args: {
  vehicle: Vehicle;
  arriveSoc: number;
  powerKw: number;
  remainingKmAfter: number;
  reservePct: number;
  hasLaterOptions: boolean;
  config: SmartDriveConfig;
  conditions?: DriveConditions;
}): ChargeTarget {
  const {config, vehicle} = args;
  const cap = config.maxChargeToPct;
  const need =
    socNeededFor(
      vehicle,
      args.remainingKmAfter,
      args.reservePct,
      config,
      args.conditions,
    ) + config.comfortBufferPct;

  let target: number;
  let reason: ChargeTarget['reason'];
  if (need <= cap) {
    target = Math.ceil(need);
    reason = 'finish_trip';
  } else if (args.hasLaterOptions) {
    target = cap;
    reason = 'reach_next_stop';
  } else {
    // Nothing follows, so this stop has to do it all, past the comfort cap if
    // need be. If even the hard cap cannot finish the trip, say it is a best
    // effort rather than claiming it will.
    target = Math.min(config.hardChargeCapPct, Math.ceil(need));
    reason = need <= config.hardChargeCapPct ? 'finish_trip' : 'best_effort';
  }
  // A stop that adds almost nothing is not worth making.
  const useful = Math.ceil(args.arriveSoc + config.minUsefulChargePct);
  target = Math.min(
    Math.max(target, Math.min(useful, cap)),
    config.hardChargeCapPct,
  );
  target = Math.max(target, Math.ceil(args.arriveSoc) + 1);
  target = Math.min(100, target);

  let savedVsCapMin: number | null = null;
  if (target < cap) {
    const atCap = minutesToCharge(
      args.arriveSoc,
      cap,
      args.powerKw,
      vehicle.batteryKwh,
    );
    const atTarget = minutesToCharge(
      args.arriveSoc,
      target,
      args.powerKw,
      vehicle.batteryKwh,
    );
    savedVsCapMin = atCap - atTarget > 0 ? atCap - atTarget : null;
  }
  return {targetSoc: target, reason, savedVsCapMin};
}

/**
 * Total cost of the stop. Never a partial sum presented as the whole: with no
 * published energy price the total is null and the UI says so.
 */
export function stopCostFor(
  connector: StationConnector,
  fromSoc: number,
  toSoc: number,
  batteryKwh: number,
  config: Pick<SmartDriveConfig, 'platformFeeInr'>,
): StopCost {
  const kwh = energyToCharge(fromSoc, toSoc, batteryKwh);
  const energyInr =
    connector.pricePerKwh === null ? null : kwh * connector.pricePerKwh;
  const platformInr = config.platformFeeInr;
  const taxInr =
    energyInr === null ? null : (energyInr + platformInr) * GST_RATE;
  return {
    energyInr: energyInr === null ? null : Math.round(energyInr),
    // No charger publishes a parking fee yet: unknown, not zero.
    parkingInr: null,
    idleInr: 0,
    platformInr,
    taxInr: taxInr === null ? null : Math.round(taxInr),
    totalInr:
      energyInr === null
        ? null
        : Math.round(energyInr + platformInr + (taxInr ?? 0)),
  };
}

export type ContinuationCandidate = {alongKm: number};

/**
 * After charging at `fromAlongKm`, how many more stops does the trip need, and
 * is it even possible? Greedy: each leg goes as far as the pessimistic range
 * allows, to the furthest charger within it, then charges to the comfort cap.
 */
export function estimateStopsAfter(args: {
  vehicle: Vehicle;
  fromAlongKm: number;
  totalKm: number;
  reservePct: number;
  others: readonly ContinuationCandidate[];
  config: SmartDriveConfig;
  conditions?: DriveConditions;
}): {stopsAfter: number; feasible: boolean; beyondCap?: boolean} {
  const {config, vehicle} = args;
  // Same margin the charge target uses, so the two never disagree.
  const floor = args.reservePct + config.comfortBufferPct;

  const run = (chargeTo: number) => {
    let pos = args.fromAlongKm;
    let soc = chargeTo;
    let stops = 0;
    for (let leg = 0; leg < 4; leg++) {
      const reach = safeReachKm(vehicle, soc, floor, config, args.conditions);
      if (pos + reach >= args.totalKm) {
        return {stopsAfter: stops, feasible: true};
      }
      const next = args.others
        .filter(o => o.alongKm > pos + 1 && o.alongKm <= pos + reach)
        .reduce<number | null>(
          (best, o) => (best === null || o.alongKm > best ? o.alongKm : best),
          null,
        );
      if (next === null) {
        return {stopsAfter: stops, feasible: false};
      }
      pos = next;
      soc = chargeTo;
      stops += 1;
    }
    return {stopsAfter: stops, feasible: false};
  };

  // Comfortable first: every charge to the comfort cap. Only when that cannot
  // finish the trip is charging past the cap allowed (slower, but possible).
  const comfortable = run(config.maxChargeToPct);
  if (comfortable.feasible) {
    return comfortable;
  }
  const stretched = run(config.hardChargeCapPct);
  return stretched.feasible ? {...stretched, beyondCap: true} : comfortable;
}

export type MetricsInput = {
  station: Station;
  connector: StationConnector;
  vehicle: Vehicle;
  now: number;
  progressKm: number;
  soc: number;
  alongKm: number;
  lateralKm: number;
  totalKm: number;
  reservePct: number;
  hasLaterOptions: boolean;
  config: SmartDriveConfig;
  conditions?: DriveConditions;
};

/**
 * Everything the driver needs to judge a stop: how much battery they will have
 * on arrival, how much to take on, and the whole time and money it costs.
 */
export function computeStopMetrics(input: MetricsInput): StopMetrics {
  const {config, vehicle, connector, conditions} = input;
  const alongLeg = Math.max(0, input.alongKm - input.progressKm);
  const distanceFromDriverKm = alongLeg + input.lateralKm;

  const arriveSoc: SocRange = socAfterKm(
    vehicle,
    input.soc,
    distanceFromDriverKm,
    config,
    conditions,
  );
  const sideMin = (input.lateralKm / config.localSpeedKmh) * 60;
  const etaMin = driveMinutes(alongLeg, config, conditions) + sideMin;
  const etaAt = input.now + etaMin * 60000;

  const wait = expectedWait(input.station, vehicle, input.now, etaAt, config);
  const powerKw = effectivePowerKw(connector, vehicle);
  const target = chargeTargetFor({
    vehicle,
    arriveSoc: arriveSoc.expected,
    powerKw,
    remainingKmAfter: input.totalKm - input.alongKm,
    reservePct: input.reservePct,
    hasLaterOptions: input.hasLaterOptions,
    config,
    conditions,
  });
  const minutes = minutesToCharge(
    arriveSoc.expected,
    target.targetSoc,
    powerKw,
    vehicle.batteryKwh,
  );
  const chargeMinutes = around(minutes, 0.12);
  const detourMin = Math.round(sideMin);
  const rejoinMin = Math.round(sideMin) + config.rejoinOverheadMin;
  // An unknown wait still widens the total: it is not zero.
  const waitRange =
    wait.basis === 'none'
      ? {min: 0, max: 10}
      : {min: wait.minMinutes, max: wait.maxMinutes};

  return {
    connectorId: connector.id,
    connectorLabel: connector.label,
    connectorType: connector.type,
    chargerKw: connector.powerKw,
    expectedKw: Math.round(
      averageKw(
        arriveSoc.expected,
        target.targetSoc,
        powerKw,
        vehicle.batteryKwh,
      ),
    ),
    arriveSoc,
    targetSoc: target.targetSoc,
    targetReason: target.reason,
    savedVsCapMin: target.savedVsCapMin,
    chargeMinutes,
    detourMin,
    rejoinMin,
    wait,
    totalStopMin: {
      min: detourMin + waitRange.min + chargeMinutes.min + rejoinMin,
      max: detourMin + waitRange.max + chargeMinutes.max + rejoinMin,
    },
    cost: stopCostFor(
      connector,
      arriveSoc.expected,
      target.targetSoc,
      vehicle.batteryKwh,
      config,
    ),
    etaAt,
    etaMin: Math.round(etaMin),
    distanceFromDriverKm,
  };
}

export function rangeMid(r: Range): number {
  return (r.min + r.max) / 2;
}
