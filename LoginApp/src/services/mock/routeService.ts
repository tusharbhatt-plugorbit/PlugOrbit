import {minutesToCharge, energyToCharge, GST_RATE} from '../../domain/charging';
import {
  availableCount,
  compatibleConnectors,
  effectivePowerKw,
  isCompatible,
  lowestPrice,
} from '../../domain/rules';
import type {
  Route,
  RouteRequest,
  RouteStop,
  RouteStrategy,
  Station,
  StationWithDistance,
  Vehicle,
} from '../../domain/types';
import {getActiveVehicle} from '../../store/appStore';
import {distanceKm, Coords} from '../../utils/geo';
import {clamp} from '../../utils/format';
import type {EnergyPlan, RouteService} from '../types';
import {ApiError} from '../types';
import {DELHI_JAIPUR_CORRIDOR, PLACES, findPlace} from './data';
import {guard, hash} from './runtime';
import {detourFor, loadStations, waitFor} from './stationService';

const ROAD_FACTOR = 1.16; // straight-line -> road distance
const AVG_SPEED_KMH = 66;
const MAX_LATERAL_KM = 14;
const MAX_CHARGE_TO = 80;

type Path = {points: Coords[]; cum: number[]; totalKm: number};

function buildPath(points: Coords[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + distanceKm(points[i - 1], points[i]) * ROAD_FACTOR);
  }
  return {points, cum, totalKm: cum[cum.length - 1]};
}

function lerp(a: Coords, b: Coords, t: number): Coords {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

function straight(a: Coords, b: Coords, n = 10): Coords[] {
  return Array.from({length: n + 1}, (_, i) => lerp(a, b, i / n));
}

/** Delhi<->Jaipur follows the real highway; other pairs are interpolated. */
function pathBetween(from: Coords, to: Coords): Coords[] {
  const corridor = DELHI_JAIPUR_CORRIDOR;
  const delhi = corridor[0];
  const jaipur = corridor[corridor.length - 1];
  const near = (a: Coords, b: Coords) => distanceKm(a, b) < 25;
  if (near(from, delhi) && near(to, jaipur)) {
    return [from, ...corridor.slice(1, -1), to];
  }
  if (near(from, jaipur) && near(to, delhi)) {
    return [from, ...[...corridor].reverse().slice(1, -1), to];
  }
  return straight(from, to);
}

type Projection = {along: number; lateral: number};

/** Where a station sits relative to the path: km along it and km off to the side. */
function project(path: Path, p: Coords): Projection {
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

type Candidate = {
  station: StationWithDistance;
  along: number;
  lateral: number;
  powerKw: number;
  connectorId: string;
  price: number | null;
};

function candidatesFor(
  stations: Station[],
  path: Path,
  vehicle: Vehicle,
  exclude: ReadonlySet<string>,
): Candidate[] {
  const out: Candidate[] = [];
  stations.forEach(s => {
    if (exclude.has(s.id) || !isCompatible(s, vehicle)) {
      return;
    }
    const {along, lateral} = project(path, s);
    if (lateral > MAX_LATERAL_KM) {
      return;
    }
    const conns = compatibleConnectors(s, vehicle);
    const best =
      conns.find(
        c =>
          c.status === 'available' &&
          c.powerKw ===
            Math.max(
              ...conns
                .filter(x => x.status === 'available')
                .map(x => x.powerKw),
            ),
      ) ?? [...conns].sort((a, b) => b.powerKw - a.powerKw)[0];
    out.push({
      station: {...s, distanceKm: lateral, detourMin: detourFor(lateral)},
      along,
      lateral,
      powerKw: effectivePowerKw(best, vehicle),
      connectorId: best.id,
      price: lowestPrice(s, vehicle),
    });
  });
  return out;
}

function scoreFor(
  c: Candidate,
  strategy: RouteStrategy,
  vehicle: Vehicle,
): number {
  const free = availableCount(c.station, vehicle) > 0 ? 1 : 0;
  const quality = c.station.reliabilityPct / 100;
  const trustPenalty =
    c.station.statusFeed.source === 'operator_feed' ? 0 : 0.15;
  switch (strategy) {
    case 'fastest':
      return (
        c.powerKw / 120 + free * 0.6 + c.along / 2000 - c.station.detourMin / 60
      );
    case 'cheapest':
      return (
        (c.price === null ? -1 : 1 - c.price / 30) + free * 0.3 + quality * 0.2
      );
    default:
      return (
        quality * 1.4 + free * 0.7 - trustPenalty - c.station.detourMin / 40
      );
  }
}

function pickBackup(
  chosen: Candidate,
  all: Candidate[],
  strategy: RouteStrategy,
  vehicle: Vehicle,
): Candidate {
  const pool = all.filter(c => c.station.id !== chosen.station.id);
  const near = pool.filter(c => Math.abs(c.along - chosen.along) <= 45);
  const list = near.length > 0 ? near : pool;
  if (list.length === 0) {
    // Every stop needs a backup, so a corridor with a single charger can't
    // be recommended at all.
    throw new ApiError('No backup charger is available on this route yet.');
  }
  return [...list].sort(
    (a, b) => scoreFor(b, strategy, vehicle) - scoreFor(a, strategy, vehicle),
  )[0];
}

function planOnce(
  request: RouteRequest,
  exclude: ReadonlySet<string>,
  now: number,
): Route {
  const from = findPlace(request.fromLabel);
  const to = findPlace(request.toLabel);
  if (!from || !to) {
    throw new ApiError('Choose a start and destination from the suggestions.');
  }
  if (from.name === to.name) {
    throw new ApiError('Start and destination are the same place.');
  }

  const waypoints = (request.via ?? [])
    .map(v => findPlace(v))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const legs: Coords[][] = [];
  const chain = [from, ...waypoints, to];
  for (let i = 0; i < chain.length - 1; i++) {
    legs.push(pathBetween(chain[i].coords, chain[i + 1].coords));
  }
  const polyline = legs.reduce<Coords[]>(
    (acc, leg) => (acc.length ? [...acc, ...leg.slice(1)] : leg),
    [],
  );
  const path = buildPath(polyline);

  const vehicle = request.vehicle;
  const pctPerKm = 100 / vehicle.rangeKm100;
  const reserve = request.safetyReservePct;
  const stations = loadStations();
  const cands = candidatesFor(stations, path, vehicle, exclude);

  const stops: RouteStop[] = [];
  let pos = 0;
  let soc = request.startSoc;

  for (let guardLoop = 0; guardLoop < 6; guardLoop++) {
    const needToEnd = (path.totalKm - pos) * pctPerKm;
    if (soc - needToEnd >= reserve) {
      break;
    }
    const reachKm = Math.max(0, (soc - reserve) / pctPerKm);
    const reachable = cands.filter(
      c =>
        c.along > pos + 3 &&
        c.along <= pos + reachKm &&
        c.along < path.totalKm - 2,
    );
    if (reachable.length === 0) {
      throw new ApiError(
        'No compatible charger is reachable with this battery level. Charge a little first or lower your reserve.',
      );
    }
    // Don't stop absurdly early: prefer the far half of what is reachable.
    const farHalf = reachable.filter(c => c.along >= pos + reachKm * 0.45);
    const pool = farHalf.length > 0 ? farHalf : reachable;
    const chosen = [...pool].sort(
      (a, b) =>
        scoreFor(b, request.strategy, vehicle) -
        scoreFor(a, request.strategy, vehicle),
    )[0];
    const backup = pickBackup(chosen, cands, request.strategy, vehicle);

    const arriveSoc = soc - (chosen.along - pos) * pctPerKm;
    const remainingPct = (path.totalKm - chosen.along) * pctPerKm;
    const need = remainingPct + reserve + 4;
    const chargeTo = clamp(
      need > MAX_CHARGE_TO ? MAX_CHARGE_TO : Math.ceil(need / 5) * 5,
      Math.min(arriveSoc + 12, MAX_CHARGE_TO),
      MAX_CHARGE_TO,
    );
    const chargeMin = minutesToCharge(
      arriveSoc,
      chargeTo,
      chosen.powerKw,
      vehicle.batteryKwh,
    );
    const kwh = energyToCharge(arriveSoc, chargeTo, vehicle.batteryKwh);
    const price = chosen.price ?? 18;

    stops.push({
      station: chosen.station,
      connectorId: chosen.connectorId,
      backup: backup.station,
      backupExtraMin: Math.max(
        3,
        Math.round(
          Math.abs(backup.along - chosen.along) * 0.9 +
            backup.station.detourMin -
            chosen.station.detourMin,
        ),
      ),
      arriveSoc: Math.round(arriveSoc),
      chargeToSoc: chargeTo,
      chargeMin,
      detourMin: chosen.station.detourMin,
      costInr: Math.round(kwh * price * (1 + GST_RATE)),
      wait: waitFor(chosen.station, vehicle),
    });

    pos = chosen.along;
    soc = chargeTo;
  }

  const arriveSoc = Math.round(soc - (path.totalKm - pos) * pctPerKm);
  if (arriveSoc < reserve - 0.5) {
    throw new ApiError(
      'This trip needs more charging stops than are available. Try another strategy.',
    );
  }
  const totalChargeMin = stops.reduce(
    (m, s) => m + s.chargeMin + s.detourMin,
    0,
  );
  const driveMin = Math.round(
    (path.totalKm / AVG_SPEED_KMH) * 60 + totalChargeMin,
  );

  return {
    id: `rt-${hash(
      `${request.fromLabel}|${request.toLabel}|${request.strategy}|${request.startSoc}`,
    ).toString(36)}`,
    fromLabel: from.name,
    toLabel: to.name,
    distanceKm: Math.round(path.totalKm),
    driveMin,
    startSoc: Math.round(request.startSoc),
    arriveSoc,
    safetyReservePct: reserve,
    strategy: request.strategy,
    polyline,
    stops,
    computedAt: now,
  };
}

function requestFromRoute(route: Route): RouteRequest {
  const vehicle = getActiveVehicle();
  if (!vehicle) {
    throw new ApiError('Add your vehicle first so we can plan for it.');
  }
  return {
    fromLabel: route.fromLabel,
    toLabel: route.toLabel,
    startSoc: route.startSoc,
    strategy: route.strategy,
    vehicle,
    safetyReservePct: route.safetyReservePct,
    avoidPaidParking: false,
  };
}

export function createRouteService(): RouteService {
  return {
    async plan(request) {
      await guard(700);
      return planOnce(request, new Set(), Date.now());
    },

    async energyPlan(request): Promise<EnergyPlan> {
      await guard(600);
      const route = planOnce(request, new Set(), Date.now());
      const legs: EnergyPlan['legs'] = [
        {label: route.fromLabel, socPercent: route.startSoc, kind: 'start'},
        ...route.stops.flatMap(s => [
          {
            label: s.station.name,
            socPercent: s.arriveSoc,
            kind: 'stop' as const,
          },
        ]),
        {label: route.toLabel, socPercent: route.arriveSoc, kind: 'arrive'},
      ];
      return {
        route,
        legs,
        lowestSocPercent: Math.min(...legs.map(l => l.socPercent)),
      };
    },

    async switchToBackup(route, stopIndex) {
      await guard(500);
      const stop = route.stops[stopIndex];
      if (!stop) {
        return route;
      }
      const request = requestFromRoute(route);
      // Re-plan without the failed station so the next backup is genuinely different.
      try {
        const replanned = planOnce(
          request,
          new Set([stop.station.id]),
          Date.now(),
        );
        return replanned;
      } catch {
        // Fall back to swapping in the previous backup without re-planning.
        const stops = route.stops.map((s, i) =>
          i === stopIndex
            ? {
                ...s,
                station: s.backup,
                connectorId:
                  compatibleConnectors(s.backup, request.vehicle)[0]?.id ??
                  s.connectorId,
                backup: s.station,
                detourMin: s.backup.detourMin,
              }
            : s,
        );
        return {...route, stops, computedAt: Date.now()};
      }
    },

    async suggestions(text) {
      await guard(120);
      const q = text.trim().toLowerCase();
      return PLACES.map(p => p.name).filter(
        n => !q || n.toLowerCase().includes(q),
      );
    },
  };
}
