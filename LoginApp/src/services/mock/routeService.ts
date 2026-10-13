import {roadRoute, RoadGeometry} from '../roadRouting';
import {emergencyChargeRoute, EmergencyChargerNotFound} from '../emergencyCharge';
import {DEFAULT_SMART_DRIVE_CONFIG} from '../../intelligence/config';
import {openStateAt} from '../../intelligence/hours';
import {socAfterKm} from '../../intelligence/battery';
import {evaluateStation, evaluateArrival} from '../../intelligence/safety';
import {chooseConnector} from '../../intelligence/stopMetrics';
import {minutesToCharge, energyToCharge, GST_RATE} from '../../domain/charging';
import {
  availableCount,
  compatibleConnectors,
  effectivePowerKw,
  isCompatible,
  stationHealth,
} from '../../domain/rules';
import type {
  Route,
  RouteRequest,
  RouteStop,
  RouteStrategy,
  Station,
  StationConnector,
  StationWithDistance,
  Vehicle,
} from '../../domain/types';
import {getActiveVehicle} from '../../store/appStore';
import {distanceKm, Coords} from '../../utils/geo';
import {clamp} from '../../utils/format';
import {ROAD_FACTOR, buildPath, lerp, project} from '../../utils/path';
import type {Path} from '../../utils/path';
import type {EnergyPlan, RouteService} from '../types';
import {ApiError} from '../types';
import {DELHI_JAIPUR_CORRIDOR, PLACES, findPlace} from './data';
import {guard, hash} from './runtime';
import {detourFor, loadStations, loadRouteStations, waitFor, createStationService} from './stationService';

const AVG_SPEED_KMH = 66;
const MAX_LATERAL_KM = 14;
const MAX_CHARGE_TO = 80;
const MAX_STOPS = 6;
// A backup is a nearby alternative to the stop, not a different trip: at most
// this many extra minutes, and the driver must be able to reach it.
const BACKUP_MAX_EXTRA_MIN = 30;
// Backtracking to a charger behind the stop may use the safety reserve, but
// never the last of the battery.
const BACKUP_FLOOR_PCT = 5;
const NO_BACKUP_NOTE = `No compatible backup charger within a ${BACKUP_MAX_EXTRA_MIN} min detour that your battery could reach.`;

function straight(a: Coords, b: Coords, n = 10): Coords[] {
  return Array.from({length: n + 1}, (_, i) => lerp(a, b, i / n));
}

/** Delhi<->Jaipur follows the real highway; other pairs are interpolated. */
export function pathBetween(from: Coords, to: Coords): Coords[] {
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

type Candidate = {
  station: StationWithDistance;
  along: number;
  lateral: number;
  powerKw: number;
  connectorId: string;
  /** Price of the connector the stop would use; null when unpublished. */
  price: number | null;
};

/**
 * The connector a stop would really use: the fastest the car can draw among
 * the free ones (all of them when none is free), cheapest on a tie.
 */
function bestConnector(
  conns: StationConnector[],
  vehicle: Vehicle,
): StationConnector {
  const open = conns.filter(c => c.status === 'available');
  const pool = open.length > 0 ? open : conns;
  const price = (c: StationConnector) => c.pricePerKwh ?? Number.MAX_VALUE;
  return [...pool].sort(
    (a, b) =>
      effectivePowerKw(b, vehicle) - effectivePowerKw(a, vehicle) ||
      price(a) - price(b),
  )[0];
}

function candidatesFor(
  stations: Station[],
  path: Path,
  vehicle: Vehicle,
  exclude: ReadonlySet<string>,
): Candidate[] {
  const out: Candidate[] = [];
  stations.forEach(s => {
    if (exclude.has(s.id) || !isCompatible(s, vehicle) || openStateAt(s.hours, Date.now()) === 'closed') {
      return;
    }
    const {along, lateral} = project(path, s);
    if (lateral > MAX_LATERAL_KM) {
      return;
    }
    const best = bestConnector(compatibleConnectors(s, vehicle), vehicle);
    out.push({
      station: {...s, distanceKm: lateral, detourMin: detourFor(lateral)},
      along,
      lateral,
      powerKw: effectivePowerKw(best, vehicle),
      connectorId: best.id,
      price: best.pricePerKwh,
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

type BackupCtx = {
  strategy: RouteStrategy;
  vehicle: Vehicle;
  /** Battery the driver arrives at the stop with. */
  arriveSoc: number;
  pctPerKm: number;
  reserve: number;
  /** Km along the path of the previous stop; -Infinity before the first. */
  afterKm: number;
  totalKm: number;
};

/** Minutes to divert from `chosen` to `other` (one way), as the card shows. */
function extraMinFor(chosen: Candidate, other: Candidate): number {
  return Math.max(
    3,
    Math.round(
      Math.abs(other.along - chosen.along) * 0.9 +
        other.station.detourMin -
        chosen.station.detourMin,
    ),
  );
}

/**
 * The best nearby alternative to `chosen`, or null when nothing is a real
 * backup: a short detour, usable (compatible, not offline), after the previous
 * stop so switching keeps the stops in order, and reachable on the battery the
 * driver would arrive with. Far-away chargers are a different trip, not a
 * backup, so they are never returned.
 */
function pickBackup(
  chosen: Candidate,
  all: Candidate[],
  ctx: BackupCtx,
): Candidate | null {
  const options = all.filter(c => {
    if (c.station.id === chosen.station.id) {
      return false;
    }
    if (c.along <= ctx.afterKm + 3 || c.along >= ctx.totalKm - 2) {
      return false;
    }
    if (stationHealth(c.station, ctx.vehicle) === 'offline') {
      return false;
    }
    if (extraMinFor(chosen, c) > BACKUP_MAX_EXTRA_MIN) {
      return false;
    }
    const gapKm = Math.max(
      Math.abs(c.along - chosen.along),
      distanceKm(chosen.station, c.station) * ROAD_FACTOR,
    );
    const left = ctx.arriveSoc - gapKm * ctx.pctPerKm;
    // Ahead of the stop the backup becomes part of the plan, so it must keep
    // the reserve; backtracking may dip into it, but never to empty.
    return left >= (c.along < chosen.along ? BACKUP_FLOOR_PCT : ctx.reserve);
  });
  return (
    [...options].sort(
      (a, b) =>
        scoreFor(b, ctx.strategy, ctx.vehicle) -
        scoreFor(a, ctx.strategy, ctx.vehicle),
    )[0] ?? null
  );
}

type Resume = {
  /** Stops before the one being replaced stay exactly as they were. */
  keep: readonly RouteStop[];
  /** The backup the driver was shown: it becomes the next stop. */
  backupId: string;
};

function planOnce(
  request: RouteRequest,
  exclude: ReadonlySet<string>,
  now: number,
  resume?: Resume,
  road?: RoadGeometry,
  routeStations?: Station[],
  emergencyStationId?: string,
): Route {
  const from = request.fromCoords ? {name: request.fromLabel, coords: request.fromCoords} : findPlace(request.fromLabel);
  const to = request.toCoords ? {name: request.toLabel, coords: request.toCoords} : findPlace(request.toLabel);
  if (!from || !to) {
    throw new ApiError('Choose a start and destination from the suggestions.');
  }
  if (from.name === to.name) {
    throw new ApiError('Start and destination are the same place.');
  }

  const waypoints = (request.via ?? [])
    .map((v, index) => request.viaCoords?.[index] ? {name: v, coords: request.viaCoords[index]!} : findPlace(v))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const legs: Coords[][] = [];
  const chain = [from, ...waypoints, to];
  for (let i = 0; i < chain.length - 1; i++) {
    legs.push(pathBetween(chain[i].coords, chain[i + 1].coords));
  }
  const polyline = road?.points ?? legs.reduce<Coords[]>(
    (acc, leg) => (acc.length ? [...acc, ...leg.slice(1)] : leg),
    [],
  );
  const path = buildPath(polyline);
  if (road && path.totalKm > 0) {
    const scale = road.distanceKm / path.totalKm;
    path.cum = path.cum.map(km => km * scale);
    path.totalKm = road.distanceKm;
  }

  const vehicle = request.vehicle;
  const pctPerKm = 100 / vehicle.rangeKm100;
  const reserve = request.safetyReservePct;
  const stations = routeStations ?? loadStations();
  const cands = candidatesFor(stations, path, vehicle, exclude);

  const stops: RouteStop[] = [...(resume?.keep ?? [])];
  const previous = stops[stops.length - 1];
  let pos = previous ? project(path, previous.station).along : 0;
  let soc = previous ? previous.chargeToSoc : request.startSoc;
  let forcedId = resume?.backupId ?? emergencyStationId ?? null;

  for (let n = stops.length; n < MAX_STOPS; n++) {
    const needToEnd = (path.totalKm - pos) * pctPerKm;
    if (forcedId === null && soc - needToEnd >= reserve) {
      break;
    }
    const backupFor = (c: Candidate) =>
      pickBackup(c, cands, {
        strategy: request.strategy,
        vehicle,
        arriveSoc: soc - (c.along - pos) * pctPerKm,
        pctPerKm,
        reserve,
        afterKm: stops.length > 0 ? pos : -Infinity,
        totalKm: path.totalKm,
      });
    const ranked = (list: Candidate[]) =>
      [...list].sort(
        (a, b) =>
          scoreFor(b, request.strategy, vehicle) -
          scoreFor(a, request.strategy, vehicle),
      );

    let chosen: Candidate | undefined;
    let backup: Candidate | null = null;
    if (forcedId !== null) {
      // "Switch to backup": exactly the charger the driver was shown.
      chosen = cands.find(c => c.station.id === forcedId);
      forcedId = null;
      if (!chosen) {
        throw new ApiError('That backup charger is no longer on this route.');
      }
      backup = backupFor(chosen);
    } else {
      const reachKm = Math.max(0, (soc - reserve) / pctPerKm);
      const reachable = cands.filter(
        c =>
          c.along > pos + 3 &&
          c.along <= pos + reachKm &&
          c.along < path.totalKm - 2,
      );
      if (reachable.length === 0) {
        if (road || (emergencyStationId && stops.length > 0)) break;
        throw new ApiError(
          'No confirmed compatible charger was found within reach on this route. Check your battery and connector type, or choose another route. Stations with unpublished connector details cannot be recommended safely.',
        );
      }
      // Don't stop absurdly early: prefer the far half of what is reachable.
      const farHalf = reachable.filter(c => c.along >= pos + reachKm * 0.45);
      const pool = farHalf.length > 0 ? farHalf : reachable;
      // Every stop needs a backup, so prefer a stop that has a real one, even
      // a little earlier. Only when none does is a stop recommended without.
      const early = reachable.filter(c => c.along >= pos + reachKm * 0.25);
      for (const tier of [pool, early]) {
        for (const c of ranked(tier)) {
          const b = backupFor(c);
          if (b) {
            chosen = c;
            backup = b;
            break;
          }
        }
        if (chosen) {
          break;
        }
      }
      chosen = chosen ?? ranked(pool)[0];
    }

    const arriveSoc = soc - (chosen.along - pos) * pctPerKm;
    const remainingPct = (path.totalKm - chosen.along) * pctPerKm;
    const need = remainingPct + reserve + 4;
    // Whole percents only, and never "charge down" when we arrive above it.
    const chargeTo = Math.max(
      Math.round(
        clamp(
          need > MAX_CHARGE_TO ? MAX_CHARGE_TO : Math.ceil(need / 5) * 5,
          Math.min(arriveSoc + 12, MAX_CHARGE_TO),
          MAX_CHARGE_TO,
        ),
      ),
      Math.round(arriveSoc),
    );
    const chargeMin = minutesToCharge(
      arriveSoc,
      chargeTo,
      chosen.powerKw,
      vehicle.batteryKwh,
    );
    const kwh = energyToCharge(arriveSoc, chargeTo, vehicle.batteryKwh);

    stops.push({
      station: chosen.station,
      connectorId: chosen.connectorId,
      backup: backup ? backup.station : null,
      backupExtraMin: backup ? extraMinFor(chosen, backup) : 0,
      ...(backup ? {} : {backupNote: NO_BACKUP_NOTE}),
      arriveSoc: Math.round(arriveSoc),
      chargeToSoc: chargeTo,
      chargeMin,
      detourMin: chosen.station.detourMin,
      // The price of the connector this stop uses; never an invented one.
      costInr:
        chosen.price === null
          ? null
          : Math.round(kwh * chosen.price * (1 + GST_RATE)),
      wait: waitFor(chosen.station, vehicle),
    });

    pos = chosen.along;
    soc = chargeTo;
  }

  const arriveSoc = Math.round(soc - (path.totalKm - pos) * pctPerKm);
  if (arriveSoc < reserve - 0.5 && !emergencyStationId && !road) {
    throw new ApiError(
      'This trip needs more charging stops than are available. Try another strategy.',
    );
  }
  const totalChargeMin = stops.reduce(
    (m, s) => m + s.chargeMin + s.detourMin,
    0,
  );
  const driveMin = Math.round(
    (road?.durationMin ?? (path.totalKm / AVG_SPEED_KMH) * 60) + totalChargeMin,
  );

  return {
    id: `rt-${hash(
      `${request.fromLabel}|${request.toLabel}|${request.strategy}|${request.startSoc}`,
    ).toString(36)}`,
    fromCoords: from.coords,
    toCoords: to.coords,
    fromLabel: from.name,
    toLabel: to.name,
    distanceKm: Math.round(path.totalKm),
    driveMin,
    startSoc: Math.round(request.startSoc),
    arriveSoc,
    safetyReservePct: reserve,
    strategy: request.strategy,
    polyline,
    geometrySource: road ? "road" : "estimate",
    chargingComplete: arriveSoc >= reserve - 0.5,
    emergencyStationId,
    corridorStations: stations.filter(station => project(path, station).lateral <= MAX_LATERAL_KM && openStateAt(station.hours, now) !== 'closed').sort((a,b) => project(path,a).along-project(path,b).along),
    stops,
    ...(waypoints.length > 0 ? {via: waypoints.map(w => w.name), viaCoords: waypoints.map(w => w.coords)} : {}),
    computedAt: now,
  };
}

function requestFromRoute(route: Route): RouteRequest {
  const vehicle = getActiveVehicle();
  if (!vehicle) {
    throw new ApiError('Add your vehicle first so we can plan for it.');
  }
  return {
    fromCoords: route.fromCoords,
    toCoords: route.toCoords,
    fromLabel: route.fromLabel,
    toLabel: route.toLabel,
    startSoc: route.startSoc,
    strategy: route.strategy,
    vehicle,
    safetyReservePct: route.safetyReservePct,
    avoidPaidParking: false,
    via: route.via,
    viaCoords: route.viaCoords,
  };
}

export function createRouteService(useRoads = false): RouteService {
  async function geometry(request: RouteRequest): Promise<(RoadGeometry & {emergencyStation?: Station}) | undefined> {
    if (!useRoads) return undefined;
    const labels = [request.fromLabel, ...(request.via ?? []), request.toLabel];
    const places = labels.map((label, index) => {
      const coords = index === 0 ? request.fromCoords : index === labels.length - 1 ? request.toCoords : request.viaCoords?.[index - 1];
      return coords ? {name: label, coords} : findPlace(label);
    });
    if (places.some(p => !p)) throw new ApiError("Choose locations from the suggestions.");
    const coords = places.map(p => p!.coords);
    if (request.startSoc <= DEFAULT_SMART_DRIVE_CONFIG.batteryCriticalPct) {
      let emergency;
      try {emergency = await emergencyChargeRoute(coords[0], coords[1], request.vehicle, request.startSoc, Date.now());}
      catch (error) {if (error instanceof EmergencyChargerNotFound) return roadRoute(coords); throw error;}
      if (coords.length === 2) return {...emergency.road, emergencyStation: emergency.station};
      const rest = await roadRoute(coords.slice(1));
      return {points:[...emergency.road.points,...rest.points.slice(1)], distanceKm:emergency.road.distanceKm+rest.distanceKm,
        durationMin:emergency.road.durationMin+rest.durationMin, emergencyStation:emergency.station};
    }
    return roadRoute(coords);
  }
  async function stationsFor(road: (RoadGeometry & {emergencyStation?: Station}) | undefined) {
    if (!road) return undefined;
    const stations = await loadRouteStations(road.points);
    if (road.emergencyStation && !stations.some(s => s.id === road.emergencyStation!.id)) stations.push(road.emergencyStation);
    return stations;
  }
  return {
    async plan(request) {
      await guard(700);
      const road = await geometry(request);
      return planOnce(request, new Set(), Date.now(), undefined, road, await stationsFor(road), road?.emergencyStation?.id);
    },

    async chooseStation(route, stationId) {
      const request = requestFromRoute(route);
      const origin = request.fromCoords ?? findPlace(request.fromLabel)?.coords;
      const destination = request.toCoords ?? findPlace(request.toLabel)?.coords;
      if (!origin || !destination) throw new ApiError('Choose valid start and destination locations.');
      const station = await createStationService(useRoads).get(stationId, origin);
      if (evaluateStation(station, request.vehicle).length) throw new ApiError('This station is closed, incompatible, offline, or has unpublished connector details. Verify with the operator before choosing it.');
      const firstLeg = useRoads ? await roadRoute([origin, station]) : undefined;
      const km = firstLeg?.distanceKm ?? distanceKm(origin,station)*ROAD_FACTOR;
      const arrival = evaluateArrival(station,{etaAt:Date.now()+(firstLeg?.durationMin ?? km/AVG_SPEED_KMH*60)*60000,
        arriveSoc:socAfterKm(request.vehicle,request.startSoc,km,DEFAULT_SMART_DRIVE_CONFIG),connector:chooseConnector(station,request.vehicle)},
        Date.now(),request.startSoc<=DEFAULT_SMART_DRIVE_CONFIG.batteryCriticalPct?'battery_critical':'normal',request.safetyReservePct,DEFAULT_SMART_DRIVE_CONFIG);
      if (arrival.violations.length) throw new ApiError('This station cannot be reached safely on your starting battery or is closed at arrival. Choose a closer open compatible charger.');
      const via = (request.via ?? []).map((label,i)=>request.viaCoords?.[i] ?? findPlace(label)?.coords);
      if (via.some(p=>!p)) throw new ApiError('Choose valid intermediate destinations.');
      const onward = useRoads ? await roadRoute([station,...via.filter((p):p is Coords=>!!p),destination]) : undefined;
      const road = firstLeg && onward ? {points:[...firstLeg.points,...onward.points.slice(1)],distanceKm:firstLeg.distanceKm+onward.distanceKm,durationMin:firstLeg.durationMin+onward.durationMin} : undefined;
      const stations = await stationsFor(road) ?? loadStations();
      if (!stations.some(s=>s.id===station.id)) stations.push(station);
      return planOnce(request,new Set(),Date.now(),{keep:[],backupId:station.id},road,stations,station.id);
    },

    async energyPlan(request): Promise<EnergyPlan> {
      await guard(600);
      const road = await geometry(request);
      const route = planOnce(request, new Set(), Date.now(), undefined, road, await stationsFor(road), road?.emergencyStation?.id);
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
      if (!stop.backup) {
        throw new ApiError(
          'This stop has no backup charger planned. Pick another charger.',
        );
      }
      // Swap in exactly the backup the driver was shown. Earlier stops and
      // every waypoint stay; battery, cost and the new stop's own backup are
      // recomputed, and the charger that failed stays out of the new plan.
      const road = await geometry(requestFromRoute(route));
      return planOnce(
        requestFromRoute(route),
        new Set([stop.station.id]),
        Date.now(),
        {keep: route.stops.slice(0, stopIndex), backupId: stop.backup.id},
        road,
        road ? await loadRouteStations(road.points) : undefined,
      );
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
