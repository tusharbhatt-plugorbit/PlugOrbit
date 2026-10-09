import {stationHealth} from '../domain/rules';
import type {Vehicle} from '../domain/types';
import {clamp} from '../utils/format';
import type {Coords} from '../utils/geo';
import {buildPath, pointAt} from '../utils/path';
import type {Path} from '../utils/path';
import {pctPerKm} from './battery';
import type {SmartDriveConfig} from './config';
import {planCharging} from './chargingPlan';
import {decideNotifications} from './notifications';
import {
  ActiveTrip,
  ChargingPlan,
  Decision,
  DriveConditions,
  EMPTY_ACTUALS,
  LogEntry,
  PlaceRef,
  PreferenceProfile,
  StopPrediction,
  TripEvent,
  TripPhase,
  TripUpdate,
  World,
} from './types';

/**
 * TripMonitorService.
 *
 * A pure reducer: (trip, event, world) -> (trip, notifications). It owns no
 * timers and no I/O, so the same code can run on the phone, in a background
 * task, or on a server watching thousands of trips. Whoever hosts it feeds it
 * events (a location fix, a battery reading, a ticking clock, a session
 * starting) and a snapshot of the world, and gets back the new state and what
 * the driver, if anyone, should hear.
 */

const LOG_LIMIT = 40;

export type MonitorContext = {
  vehicle: Vehicle;
  world: World;
  config: SmartDriveConfig;
  /** Quiet verbosity: only plan changes and safety alerts get through. */
  quiet?: boolean;
};

export type CreateTripInput = {
  tripId: string;
  userId?: string;
  vehicle: Vehicle;
  origin: PlaceRef;
  destination: PlaceRef;
  polyline: readonly Coords[];
  startSoc: number;
  now: number;
  world: World;
  config: SmartDriveConfig;
  reservePct?: number;
  profile?: PreferenceProfile;
  preferAmenities?: boolean;
  conditions?: DriveConditions;
  simulated?: boolean;
};

/** Copy a plan's headline numbers onto the flat trip fields the UI reads. */
export function applyPlan(trip: ActiveTrip, plan: ChargingPlan): ActiveTrip {
  const p = plan.primary;
  return {
    ...trip,
    plan,
    distanceRemainingKm: plan.remainingKm,
    eta: plan.destination.etaAt,
    expectedDestinationSoC: plan.destination.socWithoutCharging,
    chargingRequired: plan.chargingRequired,
    primaryStop: p,
    backupStop: plan.backup,
    expectedPrimaryArrival: p ? p.metrics.etaAt : null,
    expectedPrimaryArrivalSoC: p ? p.metrics.arriveSoc : null,
    recommendedTargetSoC: p ? p.metrics.targetSoc : null,
    estimatedChargingDuration: p ? p.metrics.chargeMinutes : null,
    estimatedWait: p ? p.metrics.wait : null,
    estimatedTotalStopTime: p ? p.metrics.totalStopMin : null,
    estimatedCost: p ? p.metrics.cost : null,
    chargeConfidence: p ? p.chargeConfidence : null,
    dataConfidence: p ? p.dataConfidence : null,
    routeRisk: plan.routeRisk,
    lastRecalculatedAt: plan.computedAt,
  };
}

function planLine(plan: ChargingPlan): string {
  if (!plan.chargingRequired || !plan.primary) {
    return plan.readiness === 'good_to_drive'
      ? 'Your battery covers the trip, so no stop is planned.'
      : 'No safe charger found yet.';
  }
  return `Picked ${plan.primary.station.name}, ${Math.round(
    plan.primary.metrics.distanceFromDriverKm,
  )} km ahead, with ${
    plan.backup ? plan.backup.station.name : 'no backup yet'
  } as the backup.`;
}

/** Build a trip and its first plan. The driver has not set off yet ('ready'). */
export function createTrip(input: CreateTripInput): ActiveTrip {
  const path = buildPath(input.polyline);
  const config = input.config;
  const reservePct = input.reservePct ?? config.minimumSafetyReservePct;
  const plan = planCharging({
    now: input.now,
    vehicle: input.vehicle,
    path,
    progressKm: 0,
    soc: input.startSoc,
    stations: input.world.stations,
    config,
    reservePct,
    profile: input.profile,
    preferAmenities: input.preferAmenities,
    conditions: input.conditions,
  });
  const base: ActiveTrip = {
    tripId: input.tripId,
    userId: input.userId ?? 'local-user',
    vehicleId: input.vehicle.id,
    origin: input.origin,
    destination: input.destination,
    polyline: [...input.polyline],
    totalKm: path.totalKm,
    startedAt: input.now,
    startSoC: input.startSoc,
    currentSoC: input.startSoc,
    progressKm: 0,
    position: {
      coords: path.points[0],
      source: input.simulated === false ? 'device' : 'simulated',
      at: input.now,
    },
    distanceRemainingKm: path.totalKm,
    eta: plan.destination.etaAt,
    expectedDestinationSoC: plan.destination.socWithoutCharging,
    chargingRequired: plan.chargingRequired,
    primaryStop: null,
    backupStop: null,
    expectedPrimaryArrival: null,
    expectedPrimaryArrivalSoC: null,
    recommendedTargetSoC: null,
    estimatedChargingDuration: null,
    estimatedWait: null,
    estimatedTotalStopTime: null,
    estimatedCost: null,
    chargeConfidence: null,
    dataConfidence: null,
    smartDriveEnabled: true,
    monitoringState: 'monitoring',
    routeRisk: plan.routeRisk,
    lastRecalculatedAt: input.now,
    plan,
    phase: 'ready',
    network: 'online',
    lastOnlineAt: input.now,
    conditions: input.conditions ?? {},
    profile: input.profile ?? 'balanced',
    preferAmenities: input.preferAmenities ?? false,
    reservePct,
    pinnedPrimaryId: null,
    visitedStopIds: [],
    lastChange: null,
    session: null,
    arrivedAtStopAt: null,
    prediction: null,
    actuals: EMPTY_ACTUALS,
    notified: {},
    log: [{at: input.now, kind: 'replanned', text: planLine(plan)}],
    counters: {checks: 1, told: 0, silent: 0, critical: 0},
    simulated: input.simulated !== false,
    clockOffsetMs: 0,
    endedAt: null,
  };
  return applyPlan(base, plan);
}

// ------------------------------------------------------------- state change --

function snapshotPrediction(
  trip: ActiveTrip,
  at: number,
  stationId: string,
): StopPrediction | null {
  const stop = [trip.plan.primary, trip.plan.backup].find(
    s => s?.station.id === stationId,
  );
  if (!stop) {
    return null;
  }
  const w = stop.metrics.wait;
  return {
    stationId,
    at,
    arriveSocExpected: stop.metrics.arriveSoc.expected,
    waitMinutes:
      w.basis === 'none'
        ? {min: 0, max: 0}
        : {min: w.minMinutes, max: w.maxMinutes},
    chargeMinutes: stop.metrics.chargeMinutes,
    targetSoc: stop.metrics.targetSoc,
    costInr: stop.metrics.cost.totalInr,
  };
}

function reduce(
  t: ActiveTrip,
  event: TripEvent,
  path: Path,
  vehicle: Vehicle,
): ActiveTrip {
  switch (event.type) {
    case 'TRIP_STARTED':
      return {...t, phase: 'driving', startedAt: event.at};
    case 'BATTERY_UPDATED':
      return {...t, currentSoC: clamp(event.soc, 0, 100)};
    case 'LOCATION_UPDATED': {
      const progress = clamp(event.progressKm, 0, t.totalKm);
      const delta = Math.max(0, progress - t.progressKm);
      const soc =
        event.soc ??
        clamp(t.currentSoC - delta * pctPerKm(vehicle, t.conditions), 0, 100);
      return {
        ...t,
        progressKm: progress,
        currentSoC: soc,
        position: {
          coords: pointAt(path, progress),
          source: t.simulated ? 'simulated' : 'device',
          at: event.at,
        },
        phase: t.phase === 'continuing' && delta > 0.4 ? 'driving' : t.phase,
      };
    }
    case 'ROUTE_CHANGED':
      return {...t, conditions: event.conditions};
    case 'SESSION_STARTED':
      return {
        ...t,
        currentSoC: event.startSoc,
        phase: 'charging',
        session: {
          stationId: event.stationId,
          startedAt: event.at,
          startSoc: event.startSoc,
          targetSoc: event.targetSoc,
          reachedTargetAt: null,
        },
        arrivedAtStopAt: t.arrivedAtStopAt ?? event.at,
        prediction:
          t.prediction ?? snapshotPrediction(t, event.at, event.stationId),
        actuals: {
          ...t.actuals,
          stationId: event.stationId,
          arriveSoc: event.startSoc,
          waitMin:
            t.arrivedAtStopAt === null
              ? null
              : Math.max(0, (event.at - t.arrivedAtStopAt) / 60000),
          startedOk: true,
        },
      };
    case 'TARGET_SOC_REACHED':
      return {
        ...t,
        currentSoC: clamp(event.soc, 0, 100),
        session: t.session && {...t.session, reachedTargetAt: event.at},
      };
    case 'SESSION_ENDED':
      return {
        ...t,
        currentSoC: clamp(event.soc, 0, 100),
        session: null,
        phase: 'continuing',
        visitedStopIds: t.session
          ? [...t.visitedStopIds, t.session.stationId]
          : t.visitedStopIds,
        actuals: {
          ...t.actuals,
          endSoc: clamp(event.soc, 0, 100),
          chargeMin: t.session
            ? Math.max(0, (event.at - t.session.startedAt) / 60000)
            : t.actuals.chargeMin,
        },
      };
    case 'PAYMENT_FAILED':
      return {...t, actuals: {...t.actuals, paymentOk: false}};
    case 'NETWORK_LOST':
      return {...t, network: 'offline', monitoringState: 'paused_offline'};
    case 'NETWORK_RESTORED':
      return {
        ...t,
        network: 'online',
        monitoringState: 'monitoring',
        lastOnlineAt: event.at,
      };
    case 'USER_SWITCHED_CHARGER':
      return {
        ...t,
        pinnedPrimaryId: event.stationId,
        lastChange: t.lastChange && {...t.lastChange, acknowledged: true},
      };
    case 'USER_KEPT_ORIGINAL':
      return {
        ...t,
        pinnedPrimaryId: t.lastChange?.from ?? t.pinnedPrimaryId,
        lastChange: t.lastChange && {...t.lastChange, acknowledged: true},
      };
    case 'DESTINATION_REACHED':
      return {
        ...t,
        progressKm: t.totalKm,
        phase: 'arrived',
        monitoringState: 'ended',
        endedAt: event.at,
      };
    default:
      return t;
  }
}

function nextPhase(
  t: ActiveTrip,
  plan: ChargingPlan,
  config: SmartDriveConfig,
): TripPhase {
  if (t.phase === 'arrived' || t.progressKm >= t.totalKm - 0.2) {
    return 'arrived';
  }
  if (t.session) {
    return 'charging';
  }
  if (t.phase === 'ready' || t.phase === 'continuing') {
    return t.phase;
  }
  const p = plan.primary;
  if (p) {
    const gap = p.alongKm - t.progressKm;
    if (gap <= 0.3 && gap >= -0.5) {
      return 'at_stop';
    }
    if (p.metrics.distanceFromDriverKm <= config.approachKm) {
      return 'approaching_stop';
    }
  }
  return 'driving';
}

/** Changes in the chargers we are relying on, noticed by comparing snapshots. */
export function deriveWorldEvents(
  prev: ActiveTrip,
  world: World,
  vehicle: Vehicle,
): TripEvent[] {
  const events: TripEvent[] = [];
  const watched = [
    {stop: prev.plan.primary, primary: true},
    {stop: prev.plan.backup, primary: false},
  ];
  watched.forEach(({stop, primary}) => {
    if (!stop) {
      return;
    }
    const current = world.stations.find(s => s.id === stop.station.id);
    if (!current) {
      return;
    }
    const before = stationHealth(stop.station, vehicle);
    const after = stationHealth(current, vehicle);
    if (before === after) {
      return;
    }
    events.push({
      type: 'CHARGER_STATUS_CHANGED',
      at: world.now,
      stationId: stop.station.id,
      from: before,
      to: after,
    });
    if (after === 'offline') {
      events.push({
        type: 'CHARGER_BECAME_OFFLINE',
        at: world.now,
        stationId: stop.station.id,
      });
    }
    if (after === 'busy' && primary) {
      events.push({
        type: 'PRIMARY_CHARGER_OCCUPIED',
        at: world.now,
        stationId: stop.station.id,
      });
    }
  });
  return events;
}

// ------------------------------------------------------------------- reducer --

/**
 * Handle one event: update state, re-plan from the new reality, decide whether
 * the driver needs to hear anything, and keep the ledger of what we did.
 */
export function processEvent(
  trip: ActiveTrip,
  event: TripEvent,
  ctx: MonitorContext,
): TripUpdate {
  const {vehicle, world, config} = ctx;
  if (trip.monitoringState === 'ended') {
    return {trip, notifications: [], decisions: [], events: [event]};
  }
  const now = event.at;
  const path = buildPath(trip.polyline);
  const events: TripEvent[] = [event];

  let t = reduce(trip, event, path, vehicle);

  // Arriving is a fact about position, whatever event reported it.
  let effective: TripEvent = event;
  if (
    event.type !== 'DESTINATION_REACHED' &&
    t.phase !== 'arrived' &&
    t.progressKm >= t.totalKm - 0.2
  ) {
    effective = {type: 'DESTINATION_REACHED', at: now};
    events.push(effective);
    t = reduce(t, effective, path, vehicle);
  }

  events.push(...deriveWorldEvents(trip, world, vehicle));

  const holdIncumbent =
    t.network === 'offline' || t.phase === 'at_stop' || t.phase === 'charging';
  const plan = planCharging({
    now,
    vehicle,
    path,
    progressKm: t.progressKm,
    soc: t.currentSoC,
    stations: world.stations,
    config,
    reservePct: t.reservePct,
    profile: t.profile,
    preferAmenities: t.preferAmenities,
    conditions: t.conditions,
    incumbentId: trip.plan.primary?.station.id ?? null,
    incumbentBackupId: trip.plan.backup?.station.id ?? null,
    recentlyLeft: trip.lastChange
      ? {stationId: trip.lastChange.from, at: trip.lastChange.at}
      : null,
    pinnedId: t.pinnedPrimaryId,
    holdIncumbent,
    excludeIds: t.visitedStopIds,
  });
  t = applyPlan(t, plan);
  t = {...t, phase: nextPhase(t, plan, config)};

  if (plan.switched) {
    t = {
      ...t,
      lastChange: {...plan.switched, at: now, acknowledged: false},
      // A fresh recommendation replaces any earlier "keep" instruction, unless
      // the old pin is the very thing that went wrong.
      pinnedPrimaryId:
        t.pinnedPrimaryId === plan.switched.from ? null : t.pinnedPrimaryId,
    };
    if (plan.switched.reason !== 'safety') {
      events.push({
        type: 'BACKUP_BECAME_BETTER',
        at: now,
        fromStationId: plan.switched.from,
        toStationId: plan.switched.to,
      });
    }
  }
  if (
    plan.primary &&
    plan.primary.metrics.etaMin <= config.nearMinutes &&
    plan.primary.alongKm - t.progressKm <= 10 &&
    t.phase !== 'charging'
  ) {
    events.push({
      type: 'USER_NEAR_CHARGER',
      at: now,
      stationId: plan.primary.station.id,
      minutesAway: plan.primary.metrics.etaMin,
    });
  }
  if (t.phase === 'at_stop' && !t.prediction && plan.primary) {
    t = {
      ...t,
      arrivedAtStopAt: t.arrivedAtStopAt ?? now,
      prediction: snapshotPrediction(trip, now, plan.primary.station.id),
    };
  }

  const decisions: Decision[] = decideNotifications({
    prev: trip,
    next: t,
    event: effective,
    config,
    quiet: ctx.quiet === true,
    now,
  });
  const told = decisions.filter(d => d.notify && d.draft);

  const entries: LogEntry[] = [];
  if (event.type === 'USER_SWITCHED_CHARGER') {
    const chosen = [plan.primary, plan.backup, ...plan.alternatives].find(
      s => s?.station.id === event.stationId,
    );
    entries.push({
      at: now,
      kind: 'replanned',
      text: `You chose ${
        chosen ? chosen.station.name : 'another charger'
      }. Planning around it.`,
    });
  }
  if (plan.switched && plan.primary) {
    entries.push({
      at: now,
      kind: 'replanned',
      text: `Switched your stop to ${plan.primary.station.name}${
        plan.switched.minutesSaved > 0
          ? `, saving about ${plan.switched.minutesSaved} min`
          : ''
      }.`,
    });
  }
  decisions
    .filter(d => !d.notify && !d.noise)
    .slice(0, 2)
    .forEach(d =>
      entries.push({
        at: now,
        kind: 'silent',
        text: `${d.noticed}. ${d.why}`,
      }),
    );
  told.forEach(d =>
    entries.push({at: now, kind: 'notified', text: d.draft?.title ?? ''}),
  );

  const notified = {...t.notified};
  told.forEach(d => {
    if (d.draft) {
      notified[d.draft.dedupeKey] = now;
    }
  });
  const fresh = entries.filter(
    (e, i) =>
      e.text !==
      (i === 0 ? t.log[t.log.length - 1]?.text : entries[i - 1].text),
  );
  t = {
    ...t,
    notified,
    log: [...t.log, ...fresh].slice(-LOG_LIMIT),
    counters: {
      checks: t.counters.checks + 1,
      told: t.counters.told + told.length,
      silent: t.counters.silent + decisions.filter(d => !d.notify).length,
      critical:
        t.counters.critical +
        told.filter(d => d.draft?.level === 'critical').length,
    },
  };

  return {
    trip: t,
    notifications: told.flatMap(d => (d.draft ? [d.draft] : [])),
    decisions,
    events,
  };
}

/** A convenience for hosts: "just reassess now". */
export function tickTrip(
  trip: ActiveTrip,
  ctx: MonitorContext,
  at: number = ctx.world.now,
): TripUpdate {
  return processEvent(trip, {type: 'TICK', at}, ctx);
}
