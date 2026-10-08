import {minutesToCharge} from './charging';
import {timeAgo} from './trust';
import type {BatteryReading, Vehicle} from './types';

/** Reference DC charger used for the "how long to 80%" hint. */
const REFERENCE_DC_KW = 50;
/** Reference AC wall-box for cars that cannot fast charge. */
const REFERENCE_AC_KW = 7.4;

/**
 * Km you can drive before touching the safety reserve, to the nearest 5 km.
 * An estimate from the manufacturer-style range at 100%; real range varies with
 * speed, load and weather, so the UI always prefixes it with "~".
 */
export function usableRangeKm(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  socPercent: number,
  reservePct: number,
): number {
  const usable = Math.max(0, socPercent - reservePct);
  return Math.round((vehicle.rangeKm100 * usable) / 100 / 5) * 5;
}

export type ChargeHint = {
  kind: 'dc' | 'ac';
  /** Power of the reference charger. */
  chargerKw: number;
  /** What the car can really draw from it. */
  effectiveKw: number;
  fromSoc: number;
  toSoc: number;
  minMinutes: number;
  maxMinutes: number;
};

/**
 * A rough "time to a useful charge" for the current battery, as a range (we
 * never print a single false-precise number). DC cars hint at 80%, AC-only cars
 * at 100%. Returns null when the battery is already at the target.
 */
export function chargeHint(
  vehicle: Pick<Vehicle, 'batteryKwh' | 'maxDcKw' | 'maxAcKw'>,
  fromSoc: number,
): ChargeHint | null {
  const dc = vehicle.maxDcKw > 0;
  const chargerKw = dc ? REFERENCE_DC_KW : REFERENCE_AC_KW;
  const effectiveKw = dc
    ? Math.min(chargerKw, vehicle.maxDcKw)
    : Math.min(chargerKw, vehicle.maxAcKw);
  const toSoc = dc ? 80 : 100;
  if (fromSoc >= toSoc || effectiveKw <= 0) {
    return null;
  }
  const minutes = minutesToCharge(
    fromSoc,
    toSoc,
    effectiveKw,
    vehicle.batteryKwh,
  );
  const minMinutes = Math.max(1, Math.round(minutes * 0.85));
  const maxMinutes = Math.max(minMinutes + 1, Math.round(minutes * 1.15));
  return {
    kind: dc ? 'dc' : 'ac',
    chargerKw,
    effectiveKw,
    fromSoc: Math.round(fromSoc),
    toSoc,
    minMinutes,
    maxMinutes,
  };
}

/** "~14-18 min" or "~1.4-1.9 h" for longer charges. */
export function minutesRangeLabel(min: number, max: number): string {
  if (min >= 90) {
    return `~${(min / 60).toFixed(1)}-${(max / 60).toFixed(1)} h`;
  }
  return `~${min}-${max} min`;
}

export type SocSourceView = {
  /** True only when the number really came from the car and is still linked. */
  fromCar: boolean;
  label: string;
  tone: 'lime' | 'info' | 'slate';
  detail: string;
};

/**
 * The honest answer to "where did this battery number come from?". A reading is
 * only called "from your car" when `battery.source === 'vehicle'` AND the link is
 * still up; everything else is plainly manual or a stale reading.
 */
export function describeSocSource(
  link: {connected: boolean},
  battery: BatteryReading | null,
  now: number,
): SocSourceView | null {
  if (!battery) {
    return null;
  }
  const age = timeAgo(battery.updatedAt, now);
  if (battery.source === 'vehicle' && link.connected) {
    return {
      fromCar: true,
      label: 'Read from your car',
      tone: 'lime',
      detail: `Updated ${age}.`,
    };
  }
  if (battery.source === 'vehicle') {
    return {
      fromCar: false,
      label: 'Last read from your car',
      tone: 'slate',
      detail: `Read ${age}. Your car is not connected, so this won’t update.`,
    };
  }
  return {
    fromCar: false,
    label: 'Manual reading',
    tone: 'info',
    detail: link.connected
      ? `You entered this ${age}. Refresh to read it from your car.`
      : `You entered this ${age}.`,
  };
}

/** Roughly how far a reserve percentage lets you drive, to the nearest 5 km. */
export function reserveKm(
  vehicle: Pick<Vehicle, 'rangeKm100'>,
  reservePct: number,
): number {
  return Math.round((vehicle.rangeKm100 * reservePct) / 100 / 5) * 5;
}

export type ReserveLevel = {label: string; tone: 'warn' | 'lime' | 'info'};

/** A plain-language read on a chosen safety reserve. */
export function reserveLevel(pct: number): ReserveLevel {
  if (pct < 10) {
    return {
      label: 'Tight: best for short trips with many chargers',
      tone: 'warn',
    };
  }
  if (pct <= 15) {
    return {label: 'Balanced: the recommended range', tone: 'lime'};
  }
  return {label: 'Cautious: more buffer, possibly an extra stop', tone: 'info'};
}
