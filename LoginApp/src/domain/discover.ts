import {GST_RATE, invoiceFor, minutesToCharge} from './charging';
import type {Invoice} from './charging';
import {
  availableCount,
  compatibleConnectors,
  effectivePowerKw,
  isCompatible,
  lowestPrice,
  maxPowerKw,
  organicScore,
  rankOrganic,
} from './rules';
import {dataTrust, isStale, timeAgo} from './trust';
import type {
  Amenity,
  StationFilters,
  StationWithDistance,
  Vehicle,
} from './types';

// ------------------------------------------------------------------ sorting --

export type SortMode = 'best' | 'nearest' | 'cheapest' | 'fastest';

export const SORT_OPTIONS: ReadonlyArray<{value: SortMode; label: string}> = [
  {value: 'best', label: 'Best'},
  {value: 'nearest', label: 'Nearest'},
  {value: 'cheapest', label: 'Cheapest'},
  {value: 'fastest', label: 'Fastest'},
];

/**
 * Power the car can really draw at this station: the best of
 * min(connector, car limit) over the connectors it can use. A 120 kW charger
 * is no faster than a 60 kW one for a car that tops out at 60 kW.
 */
export function bestEffectiveKw(
  station: StationWithDistance,
  vehicle: Vehicle | null,
): number {
  const usable = compatibleConnectors(station, vehicle);
  const pool = usable.length > 0 ? usable : station.connectors;
  return pool.reduce(
    (best, c) => Math.max(best, effectivePowerKw(c, vehicle)),
    0,
  );
}

/**
 * Orders chargers for the list. "Best" is the organic ranking, which never
 * looks at the `sponsored` flag; the other modes are plain data sorts with a
 * stable distance tie-break.
 */
export function sortStations<T extends StationWithDistance>(
  stations: readonly T[],
  mode: SortMode,
  vehicle: Vehicle | null,
): T[] {
  switch (mode) {
    case 'best':
      return rankOrganic(stations, vehicle);
    case 'nearest':
      return [...stations].sort((a, b) => a.distanceKm - b.distanceKm);
    case 'cheapest':
      return [...stations].sort((a, b) => {
        const pa = lowestPrice(a, vehicle);
        const pb = lowestPrice(b, vehicle);
        if (pa === null && pb === null) {
          return a.distanceKm - b.distanceKm;
        }
        if (pa === null) {
          return 1;
        }
        if (pb === null) {
          return -1;
        }
        return pa - pb || a.distanceKm - b.distanceKm;
      });
    default:
      return [...stations].sort((a, b) => {
        const diff = bestEffectiveKw(b, vehicle) - bestEffectiveKw(a, vehicle);
        if (diff !== 0) {
          return diff;
        }
        const freeDiff =
          Number(availableCount(b, vehicle) > 0) -
          Number(availableCount(a, vehicle) > 0);
        return freeDiff || a.distanceKm - b.distanceKm;
      });
  }
}

// ------------------------------------------------------------- quick filters --

export type QuickFilter = 'all' | 'available' | 'fast' | 'near' | 'saved';

export const QUICK_OPTIONS: ReadonlyArray<{value: QuickFilter; label: string}> =
  [
    {value: 'all', label: 'All'},
    {value: 'available', label: 'Available'},
    {value: 'fast', label: 'Fast'},
    {value: 'near', label: 'Near me'},
    {value: 'saved', label: 'Saved'},
  ];

export const FAST_KW = 50;
export const NEAR_KM = 3;

export function matchesQuick(
  station: StationWithDistance,
  quick: QuickFilter,
  vehicle: Vehicle | null,
  favouriteIds: readonly string[],
): boolean {
  switch (quick) {
    case 'available':
      return availableCount(station, vehicle) > 0;
    case 'fast':
      return maxPowerKw(station, vehicle) >= FAST_KW;
    case 'near':
      return station.distanceKm <= NEAR_KM;
    case 'saved':
      return favouriteIds.includes(station.id);
    default:
      return true;
  }
}

export function matchesText(
  station: StationWithDistance,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return (
    station.name.toLowerCase().includes(q) ||
    station.address.toLowerCase().includes(q) ||
    station.operator.toLowerCase().includes(q)
  );
}

/** Chargers the car can't use that the default view hides. */
export function hiddenIncompatibleCount(
  all: readonly StationWithDistance[],
  filters: StationFilters,
  vehicle: Vehicle | null,
): number {
  if (filters.includeIncompatible || !vehicle) {
    return 0;
  }
  return all.filter(s => !isCompatible(s, vehicle)).length;
}

// ------------------------------------------------------------------ amenities --

export const AMENITY_LABEL: Record<Amenity, string> = {
  restroom: 'Restroom',
  cafe: 'Cafe',
  food: 'Food',
  shopping: 'Shopping',
  parking: 'Parking',
  wifi: 'Wi-Fi',
  lounge: 'Lounge',
  shade: 'Shade',
};

export const ALL_AMENITIES: readonly Amenity[] = [
  'restroom',
  'cafe',
  'food',
  'shopping',
  'parking',
  'wifi',
  'lounge',
  'shade',
];

// --------------------------------------------------------- why we recommend --

export type Why = {
  /** Honest positives, strongest first (2-4 items). */
  reasons: string[];
  /** Things to know before relying on it. */
  caveats: string[];
};

function vehicleLabel(v: Vehicle | null): string {
  return v ? `${v.make} ${v.model}` : 'car';
}

/**
 * Derives the reasons straight from the station's data, so the copy can never
 * claim something the numbers don't support. Sponsorship is not an input.
 */
export function whyRecommended(
  s: StationWithDistance,
  vehicle: Vehicle | null,
  now: number,
): Why {
  const trust = dataTrust(s.statusFeed, now);
  const usable = compatibleConnectors(s, vehicle);
  const free = availableCount(s, vehicle);
  const kw = bestEffectiveKw(s, vehicle);

  const reasons: string[] = [];
  // A charger the car can't use, or that is entirely out of service, has
  // nothing to recommend it.
  const unusable =
    (vehicle !== null && usable.length === 0) ||
    (usable.length > 0 && usable.every(c => c.status === 'offline'));
  if (!unusable && trust === 'live') {
    reasons.push(
      `Live status from the operator, updated ${timeAgo(
        s.statusFeed.updatedAt,
        now,
      )}`,
    );
  }
  if (!unusable && free > 0) {
    reasons.push(
      `${free} of ${usable.length} compatible bay${
        usable.length === 1 ? '' : 's'
      } ${trust === 'live' ? 'free right now' : 'reported free'}`,
    );
  }
  if (!unusable && s.successfulSessionsPct >= 85) {
    reasons.push(
      `${s.successfulSessionsPct >= 90 ? 'Strong' : 'Good'} reliability: ${
        s.successfulSessionsPct
      }% of recent sessions finished without a fault`,
    );
  }
  if (!unusable && s.detourMin <= 10) {
    reasons.push(`Small detour: about ${s.detourMin} min from where you are`);
  }
  if (!unusable && kw >= 50) {
    reasons.push(
      vehicle
        ? `Fast: your ${vehicleLabel(vehicle)} can draw up to ${kw} kW here`
        : `Fast charging up to ${kw} kW`,
    );
  }
  if (!unusable && s.rating >= 4.3) {
    reasons.push(`Rated ${s.rating.toFixed(1)} out of 5 by drivers`);
  }
  if (!unusable && s.integration === 'integrated') {
    reasons.push('Start and pay inside PlugOrbit');
  }
  if (!unusable && s.amenities.length >= 3) {
    reasons.push(
      `Useful amenities: ${s.amenities
        .slice(0, 3)
        .map(a => AMENITY_LABEL[a].toLowerCase())
        .join(', ')}`,
    );
  }

  const caveats: string[] = [];
  if (trust === 'estimated') {
    caveats.push(
      `Status is estimated (updated ${timeAgo(
        s.statusFeed.updatedAt,
        now,
      )}). Confirm on arrival.`,
    );
  } else if (trust === 'user') {
    caveats.push(
      `Status was confirmed by a driver ${timeAgo(
        s.statusFeed.updatedAt,
        now,
      )}, not by the operator.`,
    );
  } else if (trust === 'unknown') {
    caveats.push('We have no status for this charger yet.');
  }
  if (lowestPrice(s, vehicle) === null) {
    caveats.push('The price is not published. Check it before you charge.');
  }
  return {reasons: reasons.slice(0, 4), caveats};
}

/** True when the feed is old enough that the UI should flag it. */
export function statusIsStale(s: StationWithDistance, now: number): boolean {
  return isStale(s.statusFeed, now);
}

// ------------------------------------------------------------------ compare --

export type PickResult<T> = {
  /** Everyone sharing the best value, strongest organic score first. */
  winners: T[];
  value: number | null;
  /** Every compared charger has the same value, so nobody is crowned. */
  allTied: boolean;
};

export type ComparePicks<T> = {
  best: PickResult<T>;
  fastest: PickResult<T>;
  cheapest: PickResult<T>;
};

const EPS = 1e-6;

function pickBy<T extends StationWithDistance>(
  stations: readonly T[],
  vehicle: Vehicle | null,
  value: (s: T) => number | null,
  better: 'higher' | 'lower',
  tolerance = EPS,
): PickResult<T> {
  const scored = stations
    .map(s => ({s, v: value(s)}))
    .filter((x): x is {s: T; v: number} => x.v !== null);
  if (scored.length === 0) {
    return {winners: [], value: null, allTied: false};
  }
  const target =
    better === 'higher'
      ? Math.max(...scored.map(x => x.v))
      : Math.min(...scored.map(x => x.v));
  const winners = scored
    .filter(x => Math.abs(x.v - target) <= tolerance)
    .map(x => x.s)
    .sort((a, b) => organicScore(b, vehicle) - organicScore(a, vehicle));
  return {
    winners,
    value: target,
    allTied: scored.length > 1 && winners.length === scored.length,
  };
}

/** Best fit (organic score), Fastest (power the car can draw), Cheapest. */
export function comparePicks<T extends StationWithDistance>(
  stations: readonly T[],
  vehicle: Vehicle | null,
): ComparePicks<T> {
  return {
    best: pickBy(
      stations,
      vehicle,
      s => organicScore(s, vehicle),
      'higher',
      0.5,
    ),
    fastest: pickBy(
      stations,
      vehicle,
      s => bestEffectiveKw(s, vehicle),
      'higher',
    ),
    cheapest: pickBy(stations, vehicle, s => lowestPrice(s, vehicle), 'lower'),
  };
}

// ----------------------------------------------------------------- forecast --

export type ForecastLevel = 'high' | 'medium' | 'low';

export function forecastLevel(probability: number): ForecastLevel {
  if (probability >= 0.66) {
    return 'high';
  }
  if (probability >= 0.4) {
    return 'medium';
  }
  return 'low';
}

export const FORECAST_LEVEL_LABEL: Record<ForecastLevel, string> = {
  high: 'Likely free',
  medium: 'Could be busy',
  low: 'Likely busy',
};

export const FORECAST_STEP_MIN = 5;

export type ForecastSummary = {
  bestIndex: number;
  bestProbability: number;
  worstIndex: number;
  worstProbability: number;
  averageProbability: number;
};

export function summariseForecast(
  next60: readonly number[],
): ForecastSummary | null {
  if (next60.length === 0) {
    return null;
  }
  let bestIndex = 0;
  let worstIndex = 0;
  next60.forEach((p, i) => {
    if (p > next60[bestIndex]) {
      bestIndex = i;
    }
    if (p < next60[worstIndex]) {
      worstIndex = i;
    }
  });
  const sum = next60.reduce((a, b) => a + b, 0);
  return {
    bestIndex,
    bestProbability: next60[bestIndex],
    worstIndex,
    worstProbability: next60[worstIndex],
    averageProbability: sum / next60.length,
  };
}

// --------------------------------------------------------------- cost maths --

export type ChargeEstimate = {
  energyKwh: number;
  invoice: Invoice;
  /** Effective power after the car's own limit. */
  powerKw: number;
  minutes: number;
  /** A range, never a single false-precise number. */
  minMinutes: number;
  maxMinutes: number;
};

/** AC connectors top out at 22 kW; anything faster is DC. */
export const AC_MAX_KW = 22;

export function effectiveChargerKw(
  chargerKw: number,
  vehicle: Vehicle | null,
): number {
  if (!vehicle) {
    return chargerKw;
  }
  const carLimit = chargerKw <= AC_MAX_KW ? vehicle.maxAcKw : vehicle.maxDcKw;
  return Math.max(0.1, Math.min(chargerKw, carLimit));
}

export function estimateCharge(input: {
  fromSoc: number;
  toSoc: number;
  batteryKwh: number;
  pricePerKwh: number;
  chargerKw: number;
  vehicle: Vehicle | null;
}): ChargeEstimate {
  const {fromSoc, toSoc, batteryKwh, pricePerKwh, chargerKw, vehicle} = input;
  const energyKwh = (Math.max(toSoc - fromSoc, 0) / 100) * batteryKwh;
  const powerKw = effectiveChargerKw(chargerKw, vehicle);
  const minutes = minutesToCharge(fromSoc, toSoc, powerKw, batteryKwh);
  return {
    energyKwh,
    invoice: invoiceFor(energyKwh, pricePerKwh),
    powerKw,
    minutes,
    minMinutes: Math.max(minutes === 0 ? 0 : 1, Math.round(minutes * 0.9)),
    maxMinutes: Math.ceil(minutes * 1.15),
  };
}

export {GST_RATE};
