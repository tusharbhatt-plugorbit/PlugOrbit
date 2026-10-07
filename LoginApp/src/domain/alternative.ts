import {availableCount, stationHealth} from './rules';
import type {StationWithDistance, Vehicle} from './types';

/** A "backup" further away than this isn't a backup, it's a different trip. */
export const ALTERNATIVE_MAX_KM = 60;

/**
 * The nearest alternative to a charger that is not on a planned route: one the
 * car can use, that is not offline and is close enough to be a diversion.
 * A free bay beats a closer queue. `nearby` is ordered by distance from the
 * charger being replaced.
 */
export function nearestAlternative(
  nearby: readonly StationWithDistance[],
  replacingId: string,
  vehicle: Vehicle | null,
): StationWithDistance | null {
  const free = (s: StationWithDistance) =>
    Number(availableCount(s, vehicle) > 0);
  const usable = nearby.filter(
    s =>
      s.id !== replacingId &&
      s.distanceKm <= ALTERNATIVE_MAX_KM &&
      stationHealth(s, vehicle) !== 'offline',
  );
  const ranked = [...usable].sort(
    (a, b) => free(b) - free(a) || a.distanceKm - b.distanceKm,
  );
  return ranked[0] ?? null;
}
