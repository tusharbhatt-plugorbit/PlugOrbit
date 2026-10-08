import {energyToCharge, minutesToCharge, taper} from './charging';
import type {StationConnector, Vehicle} from './types';

/**
 * What a charger will really do for THIS car. A 120 kW charger does not charge a
 * 60 kW car at 120 kW, so every duration, cost and recommendation the app shows
 * goes through here instead of reading the charger's label.
 *
 * Phase 1 model: the car draws min(charger, car limit) up to 80%, then tapers
 * linearly (see `taper` in charging.ts). Per-model charging curves slot in by
 * replacing `minutesToCharge`; nothing else has to change.
 */

export type VehicleChargeEstimate = {
  /** What the connector can deliver. */
  chargerKw: number;
  /** What the car can accept on this kind of connector. */
  carLimitKw: number;
  /** The most the pair can do: min of the two. */
  peakKw: number;
  /** Average over the whole window, taper included. */
  avgKw: number;
  /** Whole minutes from `fromSoc` to `toSoc` (not a range: callers add one). */
  minutes: number;
  energyKwh: number;
  fromSoc: number;
  toSoc: number;
  /** Which side is the bottleneck, or `none` when they match. */
  limitedBy: 'charger' | 'car' | 'none';
  /** False for a car that cannot use this connector kind at all. */
  canCharge: boolean;
};

/**
 * Minutes along the charging curve, unrounded. `minutesToCharge` rounds up for
 * display; the average power has to come from the exact figure or a car with no
 * taper in the window would read as slower than its own limit.
 */
function exactMinutes(
  fromSoc: number,
  toSoc: number,
  peakKw: number,
  batteryKwh: number,
): number {
  const step = 0.25;
  let minutes = 0;
  for (let s = fromSoc; s < toSoc; s += step) {
    const ds = Math.min(step, toSoc - s);
    const kw = peakKw * taper(s + ds / 2);
    minutes += (((ds / 100) * batteryKwh) / kw) * 60;
  }
  return minutes;
}

export function carLimitKwFor(
  connector: Pick<StationConnector, 'type'>,
  vehicle: Pick<Vehicle, 'maxAcKw' | 'maxDcKw'>,
): number {
  return connector.type === 'Type2' ? vehicle.maxAcKw : vehicle.maxDcKw;
}

export function estimateVehicleCharge(
  connector: Pick<StationConnector, 'type' | 'powerKw'>,
  vehicle: Pick<Vehicle, 'maxAcKw' | 'maxDcKw' | 'batteryKwh'>,
  fromSoc: number,
  toSoc: number,
): VehicleChargeEstimate {
  const carLimitKw = carLimitKwFor(connector, vehicle);
  const peakKw = Math.min(connector.powerKw, carLimitKw);
  const from = Math.max(0, Math.min(100, fromSoc));
  const to = Math.max(from, Math.min(100, toSoc));
  const canCharge = peakKw > 0;
  const energyKwh = energyToCharge(from, to, vehicle.batteryKwh);
  const minutes = canCharge
    ? minutesToCharge(from, to, peakKw, vehicle.batteryKwh)
    : 0;
  const exact = canCharge
    ? exactMinutes(from, to, peakKw, vehicle.batteryKwh)
    : 0;
  const avgKw = exact > 0 ? energyKwh / (exact / 60) : 0;
  return {
    chargerKw: connector.powerKw,
    carLimitKw,
    peakKw,
    avgKw,
    minutes,
    energyKwh,
    fromSoc: from,
    toSoc: to,
    limitedBy:
      connector.powerKw > carLimitKw
        ? 'car'
        : connector.powerKw < carLimitKw
        ? 'charger'
        : 'none',
    canCharge,
  };
}

/**
 * "120 kW charger, ~60 kW for your car": the capability line next to the
 * driver-facing line, so the technical number is there for those who want it.
 */
export function capabilityLine(e: VehicleChargeEstimate): string {
  if (!e.canCharge) {
    return `${e.chargerKw} kW charger, your car can’t use this connector`;
  }
  return e.peakKw < e.chargerKw
    ? `${e.chargerKw} kW charger • about ${Math.round(e.avgKw)} kW for your car`
    : `${e.chargerKw} kW charger • your car can use all of it`;
}
