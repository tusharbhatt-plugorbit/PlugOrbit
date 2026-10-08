import {clamp} from './format';
import {Coords, distanceKm} from './geo';

/** Straight-line to road distance. One number so every planner agrees. */
export const ROAD_FACTOR = 1.16;

export type Path = {points: Coords[]; cum: number[]; totalKm: number};

/** A polyline with cumulative road kilometres at each vertex. */
export function buildPath(points: readonly Coords[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + distanceKm(points[i - 1], points[i]) * ROAD_FACTOR);
  }
  return {points: [...points], cum, totalKm: cum[cum.length - 1]};
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

/** The point `alongKm` road-kilometres from the start (clamped to the path). */
export function pointAt(path: Path, alongKm: number): Coords {
  const km = clamp(alongKm, 0, path.totalKm);
  for (let i = 0; i < path.points.length - 1; i++) {
    if (km <= path.cum[i + 1] || i === path.points.length - 2) {
      const span = path.cum[i + 1] - path.cum[i];
      const t = span === 0 ? 0 : (km - path.cum[i]) / span;
      return lerp(path.points[i], path.points[i + 1], clamp(t, 0, 1));
    }
  }
  return path.points[0];
}
