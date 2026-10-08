import {distanceKm} from '../utils/geo';
import type {Coords} from '../utils/geo';
import {dataTrust, timeAgo} from './trust';
import type {
  ConnectorStatus,
  Confidence,
  FeedInfo,
  Station,
  StationConnector,
  StationFilters,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from './types';

export const DEFAULT_FILTERS: StationFilters = {
  availableOnly: false,
  connector: 'any',
  minPowerKw: 0,
  maxPricePerKwh: null,
  amenities: [],
  includeIncompatible: false,
};

export function connectorFits(
  connector: StationConnector,
  vehicle: Vehicle | null,
): boolean {
  if (!vehicle) {
    return true;
  }
  return vehicle.connectors.includes(connector.type);
}

/** A station is compatible if at least one connector fits the vehicle. */
export function isCompatible(
  station: Station,
  vehicle: Vehicle | null,
): boolean {
  if (!vehicle) {
    // Nothing can be ruled out without a car, so nothing is hidden.
    return true;
  }
  return station.connectors.some(c => connectorFits(c, vehicle));
}

/**
 * True when the source never said which connectors this charger has (Google
 * Maps without EV data). It is not confirmed compatible, so with a car set it
 * stays hidden unless the driver asks for chargers that may not fit, and
 * whenever it is shown it must say "Connector type unconfirmed".
 */
export function hasUnconfirmedConnectors(station: Station): boolean {
  return station.connectors.length === 0;
}

/** False for chargers nobody has rated (rating 0), so no star is printed. */
export function hasRating(station: Station): boolean {
  return station.rating > 0;
}

export function compatibleConnectors(
  station: Station,
  vehicle: Vehicle | null,
): StationConnector[] {
  return station.connectors.filter(c => connectorFits(c, vehicle));
}

export function maxPowerKw(station: Station, vehicle: Vehicle | null): number {
  const list = compatibleConnectors(station, vehicle);
  const pool = list.length > 0 ? list : station.connectors;
  return pool.reduce((m, c) => Math.max(m, c.powerKw), 0);
}

/** Power the car can actually draw: min(charger, car limit). */
export function effectivePowerKw(
  connector: StationConnector,
  vehicle: Vehicle | null,
): number {
  if (!vehicle) {
    return connector.powerKw;
  }
  const carLimit =
    connector.type === 'Type2' ? vehicle.maxAcKw : vehicle.maxDcKw;
  return Math.min(connector.powerKw, carLimit);
}

export function availableCount(
  station: Station,
  vehicle: Vehicle | null,
): number {
  return compatibleConnectors(station, vehicle).filter(
    c => c.status === 'available',
  ).length;
}

export function lowestPrice(
  station: Station,
  vehicle: Vehicle | null,
): number | null {
  const prices = compatibleConnectors(station, vehicle)
    .map(c => c.pricePerKwh)
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** True when this car's compatible connectors are priced differently. */
export function hasPriceRange(
  station: Station,
  vehicle: Vehicle | null,
): boolean {
  const prices = compatibleConnectors(station, vehicle)
    .map(c => c.pricePerKwh)
    .filter((p): p is number => p !== null);
  return new Set(prices).size > 1;
}

export type StationHealth = 'available' | 'busy' | 'offline' | 'unknown';

export function stationHealth(
  station: Station,
  vehicle: Vehicle | null,
): StationHealth {
  const list = compatibleConnectors(station, vehicle);
  if (list.length === 0) {
    return 'unknown';
  }
  if (list.some(c => c.status === 'available')) {
    return 'available';
  }
  if (list.every(c => c.status === 'offline')) {
    return 'offline';
  }
  if (list.every(c => c.status === 'unknown')) {
    return 'unknown';
  }
  return 'busy';
}

export function applyFilters<T extends StationWithDistance>(
  stations: readonly T[],
  filters: StationFilters,
  vehicle: Vehicle | null,
): T[] {
  return stations.filter(s => {
    if (!filters.includeIncompatible && !isCompatible(s, vehicle)) {
      return false;
    }
    if (hasUnconfirmedConnectors(s)) {
      // No connector data to test these filters against, so they can't pass.
      if (
        filters.connector !== 'any' ||
        filters.minPowerKw > 0 ||
        filters.availableOnly
      ) {
        return false;
      }
      return filters.amenities.every(a => s.amenities.includes(a));
    }
    const pool = filters.includeIncompatible
      ? s.connectors
      : compatibleConnectors(s, vehicle);
    const matching = pool.filter(c => {
      if (filters.connector !== 'any' && c.type !== filters.connector) {
        return false;
      }
      if (c.powerKw < filters.minPowerKw) {
        return false;
      }
      if (
        filters.maxPricePerKwh !== null &&
        c.pricePerKwh !== null &&
        c.pricePerKwh > filters.maxPricePerKwh
      ) {
        return false;
      }
      if (filters.availableOnly && c.status !== 'available') {
        return false;
      }
      return true;
    });
    if (matching.length === 0) {
      return false;
    }
    return filters.amenities.every(a => s.amenities.includes(a));
  });
}

export function countActiveFilters(filters: StationFilters): number {
  let n = 0;
  if (filters.availableOnly) {
    n++;
  }
  if (filters.connector !== 'any') {
    n++;
  }
  if (filters.minPowerKw > 0) {
    n++;
  }
  if (filters.maxPricePerKwh !== null) {
    n++;
  }
  if (filters.amenities.length > 0) {
    n++;
  }
  if (filters.includeIncompatible) {
    n++;
  }
  return n;
}

/**
 * Ranking is purely organic: reliability, detour and availability. The
 * `sponsored` flag is deliberately not an input and never changes order.
 */
export function organicScore(
  s: StationWithDistance,
  vehicle: Vehicle | null,
): number {
  const avail = availableCount(s, vehicle) > 0 ? 12 : 0;
  // In-app start/pay and a live operator feed make a charger genuinely more
  // dependable to use. `sponsored` is intentionally not an input.
  const usable = s.integration === 'integrated' ? 6 : 0;
  const live = s.statusFeed.source === 'operator_feed' ? 3 : 0;
  return (
    s.reliabilityPct * 0.6 +
    s.rating * 4 +
    avail +
    usable +
    live -
    s.detourMin * 1.2
  );
}

export function rankOrganic<T extends StationWithDistance>(
  stations: readonly T[],
  vehicle: Vehicle | null,
): T[] {
  return [...stations].sort(
    (a, b) => organicScore(b, vehicle) - organicScore(a, vehicle),
  );
}

// ------------------------------------------------------------ wait ranges --

const CONF_ORDER: Record<Confidence, number> = {low: 0, medium: 1, high: 2};

export function worseConfidence(a: Confidence, b: Confidence): Confidence {
  return CONF_ORDER[a] <= CONF_ORDER[b] ? a : b;
}

export function waitLabel(w: WaitEstimate): string {
  if (w.basis === 'none') {
    return 'Wait unknown';
  }
  if (w.maxMinutes === 0) {
    // "No wait" is a claim only a live operator feed can back up.
    return w.basis === 'live_queue' ? 'No wait expected' : 'Wait unknown';
  }
  if (w.minMinutes === 0) {
    return `Up to ~${w.maxMinutes} min`;
  }
  return `~${w.minMinutes}-${w.maxMinutes} min`;
}

/** A bay reported free by something that isn't a live feed: a wide, low range. */
export const REPORTED_FREE_WAIT: WaitEstimate = {
  minMinutes: 0,
  maxMinutes: 10,
  confidence: 'low',
  basis: 'reported',
};

/** What a wait estimate is built on, in words (shown beside its confidence). */
export function waitBasisLabel(w: WaitEstimate): string {
  switch (w.basis) {
    case 'live_queue':
      return 'Based on the live queue at this charger.';
    case 'reported':
      return 'Based on the last reported bay status, which isn’t a live feed.';
    case 'history':
      return 'Based on how long sessions usually last here.';
    default:
      return 'Not enough data to estimate a wait.';
  }
}

/**
 * Re-states a wait for the moment it is shown. "No wait expected" belongs to a
 * live feed, so once the feed it came from is no longer live (a plan made a
 * while ago) it becomes a low-confidence range instead.
 */
export function waitAtTime(
  w: WaitEstimate,
  feed: FeedInfo,
  now: number,
): WaitEstimate {
  if (w.basis !== 'live_queue' || dataTrust(feed, now) === 'live') {
    return w;
  }
  return REPORTED_FREE_WAIT;
}

/**
 * Headline for "how many bays are free". It says "Live now" only for a fresh
 * operator feed; anything else says when it was last reported, and a charger
 * with no status never turns "unknown" into "0 free".
 */
export function availabilityHeadline(
  station: Station,
  vehicle: Vehicle | null,
  now: number,
): string {
  const usable = compatibleConnectors(station, vehicle);
  const trust = dataTrust(station.statusFeed, now);
  if (
    trust === 'unknown' ||
    usable.length === 0 ||
    usable.every(c => c.status === 'unknown')
  ) {
    return 'Status unknown';
  }
  const counts = `${availableCount(station, vehicle)} of ${usable.length} free`;
  return trust === 'live'
    ? `Live now: ${counts}`
    : `Last reported ${timeAgo(station.statusFeed.updatedAt, now)}: ${counts}`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export function connectorStatusLabel(status: ConnectorStatus): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'occupied':
      return 'Occupied';
    case 'offline':
      return 'Offline';
    case 'reserved':
      return 'Reserved';
    default:
      return 'Unknown';
  }
}

/** Rough extra drive minutes to reach a station `km` away (straight-line). */
export function estimateDetourMin(km: number): number {
  return Math.max(1, Math.round(km * 1.65));
}

// -------------------------------------------------------------- demo area --

/** nearby() looks this far around the search origin. */
export const NEARBY_RADIUS_KM = 400;

/** True when `origin` is too far from the demo chargers' centre to find any. */
export function isOutsideDemoArea(origin: Coords, demoCentre: Coords): boolean {
  return distanceKm(origin, demoCentre) > NEARBY_RADIUS_KM;
}

/**
 * True when `found` came from searching around the demo centre because
 * `origin` itself had nothing: a normal search never returns a charger
 * beyond NEARBY_RADIUS_KM, a fallback one only does.
 */
export function isDemoFallback(
  origin: Coords,
  found: readonly Coords[],
): boolean {
  return (
    found.length > 0 &&
    found.every(s => distanceKm(origin, s) > NEARBY_RADIUS_KM)
  );
}
