import {clamp} from '../utils/format';
import {Coords, distanceKm} from '../utils/geo';

/**
 * Geometry of a route polyline: how far along it a point is, how far off to
 * the side, and where on the map "km N" is. Shared by the route planner (to
 * choose stops) and the trip monitor (to know where the driver is).
 */

/** Straight-line distance -> road distance. */
export const ROAD_FACTOR = 1.16;

export type Path = {points: Coords[]; cum: number[]; totalKm: number};

export function buildPath(points: readonly Coords[]): Path {
  const list = [...points];
  const cum = [0];
  for (let i = 1; i < list.length; i++) {
    cum.push(cum[i - 1] + distanceKm(list[i - 1], list[i]) * ROAD_FACTOR);
  }
  return {points: list, cum, totalKm: cum[cum.length - 1] ?? 0};
}

export function lerp(a: Coords, b: Coords, t: number): Coords {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

export type Projection = {along: number; lateral: number};

/** Where a point sits relative to the path: km along it and km off to the side. */
export function project(path: Path, p: Coords): Projection {
  let best: Projection = {along: 0, lateral: Infinity};
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i];
    const b = path.points[i + 1];
    const ax =
      (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
    const ay = b.latitude - a.latitude;
    const px =
      (p.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
    const py = p.latitude - a.latitude;
    const len2 = ax * ax + ay * ay;
    const t = len2 === 0 ? 0 : clamp((px * ax + py * ay) / len2, 0, 1);
    const foot = lerp(a, b, t);
    const lateral = distanceKm(foot, p);
    if (lateral < best.lateral) {
      best = {
        along: path.cum[i] + t * (path.cum[i + 1] - path.cum[i]),
        lateral,
      };
    }
  }
  return best;
}

/** The map position `km` along the path (clamped to its ends). */
export function pointAtKm(path: Path, km: number): Coords {
  if (path.points.length === 0) {
    return {latitude: 0, longitude: 0};
  }
  if (km <= 0 || path.points.length === 1) {
    return path.points[0];
  }
  if (km >= path.totalKm) {
    return path.points[path.points.length - 1];
  }
  for (let i = 0; i < path.points.length - 1; i++) {
    if (km <= path.cum[i + 1]) {
      const span = path.cum[i + 1] - path.cum[i];
      return lerp(
        path.points[i],
        path.points[i + 1],
        span === 0 ? 0 : (km - path.cum[i]) / span,
      );
    }
  }
  return path.points[path.points.length - 1];
}
