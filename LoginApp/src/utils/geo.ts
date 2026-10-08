export type Coords = {latitude: number; longitude: number};

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance between two points, in kilometres (haversine).
export function distanceKm(a: Coords, b: Coords): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  const metres = Math.round(km * 100) * 10;
  if (metres < 1000) {
    return `${Math.max(metres, 10)} m`;
  }
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
