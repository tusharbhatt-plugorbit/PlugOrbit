import {clamp} from '../utils/format';
import type {SmartDriveConfig} from './config';
import type {DriveConditions, PlanVehicle, SocRange} from './types';

/**
 * BatteryPredictionService (Phase 1).
 *
 * Starts from the manufacturer-style range at 100% (`rangeKm100`) and bends it
 * with transparent factors. With no conditions the factor is exactly 1, so
 * numbers match the rest of the app. Every prediction is a band: `low` is the
 * pessimistic edge and is the one the safety rules use.
 *
 * Future: replace `consumptionFactor` with a model fed by speed traces,
 * weather, elevation and the driver's own history. The signatures stay.
 */

const DEFAULT_SPEED_KMH = 66;

function speedFactor(speedKmh: number): number {
  if (speedKmh <= 60) {
    return 0.94;
  }
  if (speedKmh <= 80) {
    return 1;
  }
  if (speedKmh <= 100) {
    return 1.1;
  }
  return 1.25;
}

function temperatureFactor(tempC: number, hvacOn: boolean): number {
  if (tempC < 10) {
    return hvacOn ? 1.15 : 1.1;
  }
  if (tempC > 35) {
    return hvacOn ? 1.1 : 1.04;
  }
  return 1;
}

/**
 * Multiplier on baseline consumption. Only conditions that were actually given
 * change anything, so an unknown never silently makes the estimate rosier.
 */
export function consumptionFactor(conditions?: DriveConditions): number {
  if (!conditions) {
    return 1;
  }
  let factor = 1;
  if (conditions.speedKmh !== undefined) {
    // Normalise so the default road speed is neutral.
    factor *= speedFactor(conditions.speedKmh) / speedFactor(DEFAULT_SPEED_KMH);
  }
  if (conditions.temperatureC !== undefined) {
    factor *= temperatureFactor(
      conditions.temperatureC,
      conditions.hvacOn ?? true,
    );
  }
  if (
    conditions.elevationGainM !== undefined &&
    conditions.elevationGainM > 0
  ) {
    // About +1% energy per 100 m of net climb over a trip, capped.
    factor *= 1 + Math.min(0.15, conditions.elevationGainM / 10000);
  }
  return factor;
}

/** Battery percent one kilometre costs this car right now (expected). */
export function pctPerKm(
  vehicle: Pick<PlanVehicle, 'rangeKm100'>,
  conditions?: DriveConditions,
): number {
  return (100 / vehicle.rangeKm100) * consumptionFactor(conditions);
}

/** Battery left after `km`, as a band. The `low` edge assumes worse luck. */
export function socAfterKm(
  vehicle: Pick<PlanVehicle, 'rangeKm100'>,
  soc: number,
  km: number,
  config: Pick<SmartDriveConfig, 'consumptionSpread'>,
  conditions?: DriveConditions,
): SocRange {
  const used = Math.max(0, km) * pctPerKm(vehicle, conditions);
  const spread = config.consumptionSpread;
  return {
    expected: clamp(soc - used, 0, 100),
    low: clamp(soc - used * (1 + spread), 0, 100),
    high: clamp(soc - used * (1 - spread), 0, 100),
  };
}

/**
 * Kilometres you can drive before the pessimistic estimate reaches `floorPct`.
 * This is the number "can I safely reach it?" is answered with.
 */
export function safeReachKm(
  vehicle: Pick<PlanVehicle, 'rangeKm100'>,
  soc: number,
  floorPct: number,
  config: Pick<SmartDriveConfig, 'consumptionSpread'>,
  conditions?: DriveConditions,
): number {
  const perKm = pctPerKm(vehicle, conditions) * (1 + config.consumptionSpread);
  return Math.max(0, (soc - floorPct) / perKm);
}

/** Battery the car must leave with to cover `km` and still arrive at `floorPct`. */
export function socNeededFor(
  vehicle: Pick<PlanVehicle, 'rangeKm100'>,
  km: number,
  floorPct: number,
  config: Pick<SmartDriveConfig, 'consumptionSpread'>,
  conditions?: DriveConditions,
): number {
  if (km <= 0) {
    return floorPct;
  }
  return (
    floorPct +
    km * pctPerKm(vehicle, conditions) * (1 + config.consumptionSpread)
  );
}

/** Minutes to drive `km` at the conditions' speed, stretched by traffic. */
export function driveMinutes(
  km: number,
  config: Pick<SmartDriveConfig, 'defaultSpeedKmh'>,
  conditions?: DriveConditions,
): number {
  const speed = conditions?.speedKmh ?? config.defaultSpeedKmh;
  const traffic = Math.max(1, conditions?.trafficDelayFactor ?? 1);
  return (Math.max(0, km) / Math.max(speed, 10)) * 60 * traffic;
}
