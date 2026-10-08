/**
 * Small shared formatters for driver-facing sentences. Kept in the domain layer
 * (no React) so the copy the engine generates is testable.
 */

/** "85 km", never "85.0 km" or "84.6 km": range numbers are estimates. */
export function formatDistanceRound(km: number): string {
  return `${Math.max(0, Math.round(km))} km`;
}

/** "28 km" for >=10 km, "4.5 km" below, "400 m" under a kilometre. */
export function formatKmAhead(km: number): string {
  if (km < 1) {
    return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  }
  if (km < 10) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km)} km`;
}

/** "6 min" / "1 h 5 min": whole minutes, at least 1. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** "~35-41 min", or "~35 min" when the range collapses. */
export function formatMinuteRange(min: number, max: number): string {
  const lo = Math.max(0, Math.round(min));
  const hi = Math.max(lo, Math.round(max));
  return lo === hi ? `~${lo} min` : `~${lo}-${hi} min`;
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
