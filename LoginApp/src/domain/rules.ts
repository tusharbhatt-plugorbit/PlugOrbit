import type {
  ConnectorStatus,
  Confidence,
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
  return station.connectors.some(c => connectorFits(c, vehicle));
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
    return 'No wait expected';
  }
  return `~${w.minMinutes}-${w.maxMinutes} min`;
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
