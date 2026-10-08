import type {
  ActiveTrip,
  BackupPlan,
  PendingSwitch,
  StopPlan,
  TripLogEntry,
} from './activeTrip';
import {chargeConfidence} from './chargeConfidence';
import {chargeTargetFor} from './chargingPlan';
import {CoDriverEvent, coDriverEvents, NotificationLevel} from './coDriver';
import {stopCostBreakdown} from './costBreakdown';
import {BATTERY_CRITICAL_PCT} from './battery';
import {chooseConnector, scoreCharger, ScoredCharger} from './recommendation';
import {routeConfidence} from './routeConfidence';
import {buildPath, project} from './routeGeometry';
import {
  availableCount,
  compatibleConnectors,
  hasUnconfirmedConnectors,
} from './rules';
import {tripImpact} from './tripImpact';
import {dataTrust, isStale} from './trust';
import type {
  Route,
  Station,
  StationWithDistance,
  TrustLevel,
  Vehicle,
  WaitEstimate,
} from './types';
import {estimateVehicleCharge} from './vehicleCharging';

/**
 * THE TRIP STATE MACHINE (the "tripMonitorService" core).
 *
 * Pure functions: (trip, what happened) -> (new trip, what PlugOrbit should say).
 * Services feed them real data (positions, station statuses) and deliver the
 * events; nothing here touches the network, the clock or the store, so every
 * decision is testable and a real GPS / operator feed only has to call the same
 * functions.
 *
 *   driving --(within reach)--> at_charger --(plug in)--> charging
 *      ^                                                      |
 *      +-------------------(paid, back on the road)----------+
 *   driving --(destination)--> arrived --> ended
 */

export const TRIP_SPEED_KMH = 66;
/** Inside this many km the stop is "close": the approaching message fires. */
export const APPROACH_KM = 8;
/** Inside this many km the driver is at the charger. */
export const ARRIVE_RADIUS_KM = 0.4;
/** A short wait isn't worth leaving the planned stop for. */
const SHORT_WAIT_MIN = 8;
const LOG_LIMIT = 40;

export type Out = {trip: ActiveTrip; events: CoDriverEvent[]};

// ---------------------------------------------------------------- stop health --

export type StopHealth = {
  state: 'ok' | 'watch' | 'unusable';
  cause: 'occupied' | 'offline' | 'unconfirmed' | null;
  freeBays: number | null;
  trust: TrustLevel;
};

/**
 * Can the planned stop be relied on right now? `unusable` means no free bay or
 * out of service; `watch` means we can't confirm it (no status, or an old one).
 */
export function stopHealth(
  station: Station,
  vehicle: Vehicle | null,
  now: number,
): StopHealth {
  const trust = dataTrust(station.statusFeed, now);
  const usable = compatibleConnectors(station, vehicle);
  if (hasUnconfirmedConnectors(station) || usable.length === 0) {
    return {state: 'watch', cause: 'unconfirmed', freeBays: null, trust};
  }
  if (usable.every(c => c.status === 'offline')) {
    return {state: 'unusable', cause: 'offline', freeBays: 0, trust};
  }
  if (trust === 'unknown' || usable.every(c => c.status === 'unknown')) {
    return {state: 'watch', cause: 'unconfirmed', freeBays: null, trust};
  }
  const free = availableCount(station, vehicle);
  if (free === 0) {
    return {state: 'unusable', cause: 'occupied', freeBays: 0, trust};
  }
  if (trust === 'estimated' && isStale(station.statusFeed, now)) {
    return {state: 'watch', cause: 'unconfirmed', freeBays: free, trust};
  }
  return {state: 'ok', cause: null, freeBays: free, trust};
}

export type SwitchDecision = {
  switch: boolean;
  reason: PendingSwitch['reason'] | null;
  savedMin: number | null;
};

/**
 * Stay or switch? Leave a planned stop only when it is out of service, or has
 * no free bay and waiting would cost more than the backup does, or can't be
 * confirmed while the backup can. A short wait never justifies a change, and
 * a backup that is itself unusable is never offered.
 */
export function decideSwitch(input: {
  primary: {health: StopHealth; wait: WaitEstimate};
  backup: {
    health: StopHealth;
    wait: WaitEstimate;
    /** Live cost of switching from where the car is now (see `switchCostMin`). */
    extraMin: number;
    /** The battery gets the car there with a safe margin. */
    reachable: boolean;
  } | null;
}): SwitchDecision {
  const {primary, backup} = input;
  const stay: SwitchDecision = {switch: false, reason: null, savedMin: null};
  if (primary.health.state === 'ok' || !backup) {
    return stay;
  }
  if (backup.health.state !== 'ok' || !backup.reachable) {
    return stay;
  }
  if (primary.health.cause === 'offline') {
    return {switch: true, reason: 'offline', savedMin: null};
  }
  if (primary.health.cause === 'occupied') {
    if (primary.wait.basis === 'none') {
      // No queue information: an occupied charger we can't size is a gamble.
      return {switch: true, reason: 'occupied', savedMin: null};
    }
    const waitHere = primary.wait.maxMinutes;
    if (waitHere < SHORT_WAIT_MIN) {
      return stay;
    }
    const costThere =
      backup.extraMin +
      (backup.wait.basis === 'none' ? 0 : backup.wait.maxMinutes);
    return waitHere - costThere >= 2
      ? {switch: true, reason: 'occupied', savedMin: waitHere - costThere}
      : stay;
  }
  // The planned stop can't be confirmed; the backup can, live, for a small hop.
  return backup.health.trust === 'live' && backup.extraMin <= 10
    ? {switch: true, reason: 'unreliable', savedMin: null}
    : stay;
}

/** The battery a driver must still have on reaching a backup, percent. */
const BACKUP_FLOOR_PCT = 5;

/**
 * What switching to the backup costs from where the car is NOW. Not the
 * planner's worst case ("you only find out on arrival"): a backup still ahead on
 * the road, before the planned stop, costs almost nothing, while one already
 * passed means going back and returning.
 */
export function switchCost(
  trip: ActiveTrip,
  stop: StopPlan,
  backup: BackupPlan,
): {extraMin: number; aheadKm: number; reachable: boolean} {
  const ahead = backup.alongKm - trip.km;
  const driveKm =
    ahead >= 0 ? Math.max(0, backup.alongKm - stop.alongKm) : -2 * ahead;
  const extraMin = Math.max(
    0,
    Math.round(
      (driveKm / trip.speedKmh) * 60 +
        Math.max(0, backup.detourMin - stop.detourMin),
    ),
  );
  const soc =
    ahead >= 0
      ? socAt(trip.anchor, backup.alongKm, trip.vehicle)
      : socAt(trip.anchor, trip.km, trip.vehicle) -
        -ahead * pctPerKm(trip.vehicle);
  return {extraMin, aheadKm: ahead, reachable: soc >= BACKUP_FLOOR_PCT};
}

// ------------------------------------------------------------------ planning --

const pctPerKm = (v: Pick<Vehicle, 'rangeKm100'>) => 100 / v.rangeKm100;
const socAt = (
  anchor: {km: number; soc: number},
  km: number,
  v: Pick<Vehicle, 'rangeKm100'>,
) => Math.max(0, anchor.soc - (km - anchor.km) * pctPerKm(v));

function connectorLabelOf(
  station: Station,
  vehicle: Vehicle,
  preferId?: string,
): string {
  const usable = compatibleConnectors(station, vehicle);
  const c =
    usable.find(x => x.id === preferId) ??
    chooseConnector(station, vehicle) ??
    station.connectors[0];
  return c ? `${c.label} • ${c.type}` : 'Connector unconfirmed';
}

function backupPlanOf(
  route: Route,
  stopIndex: number,
  vehicle: Vehicle,
): BackupPlan | null {
  const stop = route.stops[stopIndex];
  if (!stop || !stop.backup) {
    return null;
  }
  const path = buildPath(route.polyline);
  return {
    stationId: stop.backup.id,
    stationName: stop.backup.name,
    operator: stop.backup.operator,
    latitude: stop.backup.latitude,
    longitude: stop.backup.longitude,
    alongKm: project(path, stop.backup).along,
    extraMin: stop.backupExtraMin,
    detourMin: stop.backup.detourMin,
    connectorLabel: connectorLabelOf(stop.backup, vehicle),
  };
}

export type PlannedStop = {plan: StopPlan; scored: ScoredCharger | null};

/**
 * One stop of the route, with every number projected from where the car and
 * battery really are now (the anchor), not from the original plan. Also scores
 * it with the engine so the reason a driver reads is the engine's.
 */
export function planStop(
  route: Route,
  stopIndex: number,
  anchor: {km: number; soc: number},
  vehicle: Vehicle,
  now: number,
): PlannedStop | null {
  const stop = route.stops[stopIndex];
  if (!stop) {
    return null;
  }
  const path = buildPath(route.polyline);
  const alongKm = project(path, stop.station).along;
  const arriveSoc = Math.round(socAt(anchor, alongKm, vehicle));
  const remainingPct = (path.totalKm - alongKm) * pctPerKm(vehicle);
  const chargeToSoc = chargeTargetFor(
    arriveSoc,
    remainingPct,
    route.safetyReservePct,
  );
  const connector =
    stop.station.connectors.find(c => c.id === stop.connectorId) ??
    chooseConnector(stop.station, vehicle) ??
    stop.station.connectors[0];
  const charge = estimateVehicleCharge(
    connector,
    vehicle,
    arriveSoc,
    chargeToSoc,
  );
  const cost = stopCostBreakdown({
    station: stop.station,
    connector,
    vehicle,
    fromSoc: arriveSoc,
    toSoc: chargeToSoc,
  });
  const impact = tripImpact({
    detourMin: stop.detourMin,
    wait: stop.wait,
    chargeMin: charge.minutes,
  });
  const confidence = chargeConfidence(stop.station, vehicle, now);
  const plan: StopPlan = {
    stopIndex,
    stationId: stop.station.id,
    stationName: stop.station.name,
    operator: stop.station.operator,
    latitude: stop.station.latitude,
    longitude: stop.station.longitude,
    connectorId: connector.id,
    connectorLabel: `${connector.label} • ${connector.type}`,
    alongKm,
    arriveSoc,
    chargeToSoc,
    chargeMin: charge.minutes,
    costInr: cost.totalInr,
    detourMin: stop.detourMin,
    impact,
    confidence: confidence.level,
    backup: backupPlanOf(route, stopIndex, vehicle),
    backupNote: stop.backupNote ?? null,
  };
  const scored = scoreCharger(
    {
      station: stop.station,
      roadKm: Math.max(0, alongKm - anchor.km),
      detourMin: stop.detourMin,
      etaMin: (Math.max(0, alongKm - anchor.km) / TRIP_SPEED_KMH) * 60,
      arriveSoc,
      chargeToSoc,
      connectorId: connector.id,
    },
    {
      intent: 'plan_trip',
      vehicle,
      socPercent: anchor.soc,
      reservePct: route.safetyReservePct,
      now,
      speedKmh: TRIP_SPEED_KMH,
      waitOf: () => stop.wait,
    },
    null,
  );
  return {plan, scored: 'score' in scored ? scored : null};
}

/**
 * Every stop of a route explained from the start: each stop is projected from
 * the charge the stop before it ends on. This is what the trip summary shows
 * before the driver leaves; the same `planStop` then keeps it right en route.
 */
export function planAllStops(
  route: Route,
  vehicle: Vehicle,
  now: number,
): PlannedStop[] {
  const out: PlannedStop[] = [];
  let anchor = {km: 0, soc: route.startSoc};
  route.stops.forEach((_, i) => {
    const planned = planStop(route, i, anchor, vehicle, now);
    if (planned) {
      out.push(planned);
      anchor = {km: planned.plan.alongKm, soc: planned.plan.chargeToSoc};
    }
  });
  return out;
}

/** Battery at the destination if the driver follows the remaining plan. */
function projectArrivalSoc(
  trip: Pick<ActiveTrip, 'route' | 'stopIndex' | 'anchor' | 'vehicle'>,
  firstTarget: number | null,
): number {
  const {route, anchor, vehicle} = trip;
  const path = buildPath(route.polyline);
  let km = anchor.km;
  let soc = anchor.soc;
  route.stops.slice(trip.stopIndex).forEach((s, i) => {
    const along = project(path, s.station).along;
    const arrive = soc - (along - km) * pctPerKm(vehicle);
    const rem = (path.totalKm - along) * pctPerKm(vehicle);
    soc =
      i === 0 && firstTarget !== null
        ? firstTarget
        : chargeTargetFor(arrive, rem, route.safetyReservePct);
    km = along;
  });
  return Math.round(Math.max(0, soc - (path.totalKm - km) * pctPerKm(vehicle)));
}

function driveEtaAt(trip: ActiveTrip, now: number): number {
  const driveMin = ((trip.totalKm - trip.km) / trip.speedKmh) * 60;
  const stopsMin = trip.route.stops
    .slice(trip.stopIndex)
    .reduce((n, s) => n + s.chargeMin + s.detourMin, 0);
  return now + Math.round(driveMin + stopsMin) * 60_000;
}

/** Recompute everything derived from position, battery and the current stop. */
function refresh(trip: ActiveTrip, now: number): ActiveTrip {
  const planned = planStop(
    trip.route,
    trip.stopIndex,
    trip.anchor,
    trip.vehicle,
    now,
  );
  const plan = planned?.plan ?? null;
  const next: ActiveTrip = {
    ...trip,
    currentSoc: Math.round(socAt(trip.anchor, trip.km, trip.vehicle)),
    primaryStop: plan,
    backupStop: plan?.backup ?? null,
    recommendationReason: plan
      ? planned?.scored?.reasons.slice(0, 2).join(' ') ||
        `${plan.stationName} is the most dependable stop on your route.`
      : 'You have enough battery to get there.',
    dataConfidence: plan?.confidence ?? null,
    chargingTargetSoc: plan?.chargeToSoc ?? null,
    estimatedChargeMin: plan?.chargeMin ?? null,
    estimatedCostInr: plan?.costInr ?? null,
    totalTripImpact: plan?.impact ?? null,
    chargingRequired: trip.route.stops.length > trip.stopIndex,
  };
  next.expectedArrivalSoc = projectArrivalSoc(next, plan?.chargeToSoc ?? null);
  next.etaAt = driveEtaAt(next, now);
  return next;
}

// -------------------------------------------------------------------- events --

function absorb(trip: ActiveTrip, raised: readonly CoDriverEvent[]): Out {
  const fresh = raised.filter(e => !trip.emitted.includes(e.key));
  if (fresh.length === 0) {
    return {trip, events: []};
  }
  const log: TripLogEntry[] = [
    ...trip.log,
    ...fresh.map(e => ({
      id: `${e.at}-${e.kind}`,
      at: e.at,
      kind: e.kind,
      level: e.level as NotificationLevel,
      title: e.title,
      body: e.body,
    })),
  ].slice(-LOG_LIMIT);
  const critical = fresh.find(e => e.level === 'critical');
  return {
    trip: {
      ...trip,
      log,
      emitted: [...trip.emitted, ...fresh.map(e => e.key)].slice(-120),
      lastCriticalAt: critical ? critical.at : trip.lastCriticalAt,
    },
    events: fresh,
  };
}

// -------------------------------------------------------------------- create --

export function createTrip(input: {
  route: Route;
  vehicle: Vehicle;
  smartDrive: boolean;
  now: number;
}): Out {
  const {route, vehicle, now} = input;
  const tripId = `trip-${now.toString(36)}`;
  const base: ActiveTrip = {
    tripId,
    vehicle,
    startedAt: now,
    startingSoc: route.startSoc,
    currentSoc: route.startSoc,
    origin: route.fromLabel,
    destination: route.toLabel,
    route,
    totalKm: buildPath(route.polyline).totalKm,
    km: 0,
    anchor: {km: 0, soc: route.startSoc},
    speedKmh: TRIP_SPEED_KMH,
    etaAt: now,
    expectedArrivalSoc: route.arriveSoc,
    chargingRequired: route.stops.length > 0,
    stopIndex: 0,
    primaryStop: null,
    backupStop: null,
    recommendationReason: '',
    dataConfidence: null,
    chargingTargetSoc: null,
    estimatedChargeMin: null,
    estimatedCostInr: null,
    totalTripImpact: null,
    tripRisk: routeConfidence(route, now).level,
    smartDriveEnabled: input.smartDrive,
    monitoringStatus: route.stops.length > 0 ? 'monitoring' : 'idle',
    lastCheckedAt: null,
    offlineSince: null,
    phase: 'driving',
    pendingSwitch: null,
    dismissedSwitches: [],
    lastFreeBays: null,
    log: [],
    emitted: [],
    lastCriticalAt: null,
    stats: {stopsCompleted: 0, energyKwh: 0, costInr: 0, chargeMin: 0},
    endedAt: null,
  };
  return absorb(refresh(base, now), [
    coDriverEvents.tripStarted({
      tripId,
      destination: route.toLabel,
      chargingRequired: route.stops.length > 0,
      at: now,
    }),
  ]);
}

// ------------------------------------------------------------------ position --

export type PositionContext = {
  now: number;
  /** "Charging stop coming up" distance, km. */
  remindKm: number;
  /** The latest look at the planned charger, for the "you're close" message. */
  primary?: StationWithDistance | null;
};

/** The car moved. Advances the trip and raises the right reminder, once. */
export function applyPosition(
  trip: ActiveTrip,
  km: number,
  ctx: PositionContext,
): Out {
  if (trip.phase !== 'driving') {
    return {trip, events: []};
  }
  const cap = trip.primaryStop ? trip.primaryStop.alongKm : trip.totalKm;
  const next = Math.min(Math.max(km, trip.km), cap);
  let t: ActiveTrip = {...trip, km: next};
  const raised: CoDriverEvent[] = [];

  const stop = t.primaryStop;
  if (stop) {
    const away = stop.alongKm - next;
    if (away <= ARRIVE_RADIUS_KM) {
      t = {
        ...t,
        km: stop.alongKm,
        phase: 'at_charger',
        monitoringStatus: 'idle',
      };
    } else if (away <= APPROACH_KM) {
      const conn = ctx.primary
        ? compatibleConnectors(ctx.primary, t.vehicle).find(
            c => c.id === stop.connectorId,
          )
        : undefined;
      raised.push(
        coDriverEvents.approaching({
          tripId: t.tripId,
          at: ctx.now,
          stationId: stop.stationId,
          stationName: stop.stationName,
          minutes: (away / t.speedKmh) * 60,
          connectorLabel: conn ? conn.label : null,
          // "Currently available" is a claim about NOW: only a live status
          // may make it.
          connectorFree:
            !!conn &&
            conn.status === 'available' &&
            dataTrust(ctx.primary!.statusFeed, ctx.now) === 'live',
        }),
      );
    } else if (away <= ctx.remindKm) {
      raised.push(
        coDriverEvents.stopUpcoming({
          tripId: t.tripId,
          at: ctx.now,
          stationId: stop.stationId,
          stationName: stop.stationName,
          distanceKm: away,
          arriveSoc: stop.arriveSoc,
          chargeToSoc: stop.chargeToSoc,
          stopMin: stop.chargeMin,
        }),
      );
    }
  } else if (t.totalKm - next <= ARRIVE_RADIUS_KM) {
    t = {...t, km: t.totalKm, phase: 'arrived', monitoringStatus: 'idle'};
  }

  t = refresh(t, ctx.now);
  if (t.phase === 'arrived') {
    raised.push(
      coDriverEvents.destinationArrived({
        tripId: t.tripId,
        at: ctx.now,
        destination: t.destination,
        soc: t.currentSoc,
      }),
    );
  }
  if (t.currentSoc <= BATTERY_CRITICAL_PCT && t.phase === 'driving') {
    raised.push(
      coDriverEvents.batteryCritical({
        tripId: t.tripId,
        at: ctx.now,
        soc: t.currentSoc,
      }),
    );
  }
  return absorb(t, raised);
}

// -------------------------------------------------------------------- status --

export type StatusContext = {
  now: number;
  primary: StationWithDistance | null;
  backup: StationWithDistance | null;
  waitOf: (station: Station, vehicle: Vehicle) => WaitEstimate;
};

export type StatusOut = Out & {
  /** Set when Smart Drive may switch on its own: the caller applies it. */
  autoSwitch: PendingSwitch | null;
};

/**
 * Look at the planned stop and its backup again. Raises "getting busy",
 * suggests (or, for Smart Drive with permission, performs) a switch when the
 * stop can no longer be relied on, and clears the suggestion if it recovers.
 */
export function applyStatusCheck(
  trip: ActiveTrip,
  ctx: StatusContext,
  autoSwitchAllowed: boolean,
): StatusOut {
  const {now} = ctx;
  const stop = trip.primaryStop;
  const events: CoDriverEvent[] = [];
  const back = (t: ActiveTrip, raised: CoDriverEvent[]): ActiveTrip => {
    const wasOffline = t.monitoringStatus === 'offline';
    const r = absorb(
      {
        ...t,
        lastCheckedAt: now,
        offlineSince: null,
        monitoringStatus: t.pendingSwitch
          ? 'switch_available'
          : t.phase === 'driving' || t.phase === 'at_charger'
          ? stop
            ? 'monitoring'
            : 'idle'
          : 'idle',
      },
      wasOffline
        ? [coDriverEvents.backOnline({tripId: t.tripId, at: now}), ...raised]
        : raised,
    );
    events.push(...r.events);
    return r.trip;
  };

  if (
    !stop ||
    !ctx.primary ||
    (trip.phase !== 'driving' && trip.phase !== 'at_charger')
  ) {
    return {trip: back(trip, []), events, autoSwitch: null};
  }

  const health = stopHealth(ctx.primary, trip.vehicle, now);
  const raised: CoDriverEvent[] = [];
  let pending: PendingSwitch | null = trip.pendingSwitch;
  let auto: PendingSwitch | null = null;

  // Filling up: one fewer free bay and almost none left.
  if (
    health.freeBays !== null &&
    trip.lastFreeBays !== null &&
    health.freeBays < trip.lastFreeBays &&
    health.freeBays === 1
  ) {
    raised.push(
      coDriverEvents.availabilityChanged({
        tripId: trip.tripId,
        at: now,
        stationId: stop.stationId,
        stationName: stop.stationName,
        freeBays: health.freeBays,
      }),
    );
  }

  if (health.state === 'ok') {
    pending = null;
  } else {
    const backupHealth = ctx.backup
      ? stopHealth(ctx.backup, trip.vehicle, now)
      : null;
    const cost = stop.backup ? switchCost(trip, stop, stop.backup) : null;
    const decision = decideSwitch({
      primary: {health, wait: ctx.waitOf(ctx.primary, trip.vehicle)},
      backup:
        ctx.backup && backupHealth && cost
          ? {
              health: backupHealth,
              wait: ctx.waitOf(ctx.backup, trip.vehicle),
              extraMin: cost.extraMin,
              reachable: cost.reachable,
            }
          : null,
    });
    if (decision.switch && decision.reason && stop.backup) {
      const candidate: PendingSwitch = {
        fromStationId: stop.stationId,
        fromName: stop.stationName,
        toStationId: stop.backup.stationId,
        toName: stop.backup.stationName,
        reason: decision.reason,
        aheadKm:
          cost && cost.aheadKm > 0.5
            ? Math.round(cost.aheadKm * 10) / 10
            : null,
        savedMin: decision.savedMin,
        createdAt: pending?.createdAt ?? now,
      };
      const declined =
        candidate.reason !== 'offline' &&
        trip.dismissedSwitches.includes(
          `${candidate.fromStationId}:${candidate.toStationId}`,
        );
      if (declined) {
        // The driver already said "I'll wait": don't offer the same move again
        // unless the charger goes offline, which changes the answer.
        pending = null;
      } else if (autoSwitchAllowed && trip.smartDriveEnabled) {
        auto = candidate;
        pending = null;
      } else {
        pending = candidate;
        raised.push(
          coDriverEvents.switchSuggested({
            tripId: trip.tripId,
            at: now,
            fromStationId: stop.stationId,
            fromName: stop.stationName,
            toName: stop.backup.stationName,
            aheadKm: candidate.aheadKm,
            reason: candidate.reason,
          }),
        );
      }
    } else {
      pending = null;
      if (health.state === 'unusable') {
        // Nothing better to move to. Say so; if the battery is tight, say it loudly.
        const tight = stop.arriveSoc < 15;
        raised.push(
          tight
            ? coDriverEvents.noReliableCharger({tripId: trip.tripId, at: now})
            : coDriverEvents.availabilityChanged({
                tripId: trip.tripId,
                at: now,
                stationId: stop.stationId,
                stationName: stop.stationName,
                freeBays: health.freeBays ?? 0,
              }),
        );
      }
    }
  }

  const updated: ActiveTrip = {
    ...trip,
    pendingSwitch: pending,
    lastFreeBays: health.freeBays ?? trip.lastFreeBays,
  };
  return {trip: back(updated, raised), events, autoSwitch: auto};
}

/** Signal lost: keep the plan, say so once, never present it as live. */
export function applyOffline(trip: ActiveTrip, now: number): Out {
  if (trip.monitoringStatus === 'offline' || trip.phase === 'ended') {
    return {trip, events: []};
  }
  return absorb({...trip, monitoringStatus: 'offline', offlineSince: now}, [
    coDriverEvents.offline({tripId: trip.tripId, at: now}),
  ]);
}

// ------------------------------------------------------------------- changes --

/** The driver corrected the battery reading. Re-projects the whole plan. */
export function applyBattery(
  trip: ActiveTrip,
  percent: number,
  now: number,
): Out {
  const t = refresh(
    {...trip, anchor: {km: trip.km, soc: Math.round(percent)}},
    now,
  );
  const raised: CoDriverEvent[] = [];
  if (t.currentSoc <= BATTERY_CRITICAL_PCT && t.phase === 'driving') {
    raised.push(
      coDriverEvents.batteryCritical({
        tripId: t.tripId,
        at: now,
        soc: t.currentSoc,
      }),
    );
  } else if (t.primaryStop && t.primaryStop.arriveSoc < 3) {
    raised.push(coDriverEvents.noReliableCharger({tripId: t.tripId, at: now}));
  } else {
    raised.push(
      coDriverEvents.planUpdated({
        tripId: t.tripId,
        at: now,
        detail: t.primaryStop
          ? `You’ll reach ${t.primaryStop.stationName} with about ${t.primaryStop.arriveSoc}%.`
          : `You’ll arrive with about ${t.expectedArrivalSoc}%.`,
      }),
    );
  }
  return absorb(t, raised);
}

/**
 * The route was re-planned onto the backup. The stop at `stopIndex` is now the
 * station that used to be the backup; everything is re-projected from there.
 */
export function applyRouteChange(
  trip: ActiveTrip,
  route: Route,
  ctx: {now: number; auto: boolean; from: PendingSwitch},
): Out {
  let moved: ActiveTrip = {
    ...trip,
    route,
    pendingSwitch: null,
    dismissedSwitches: [],
    lastFreeBays: null,
    monitoringStatus: 'monitoring',
    tripRisk: routeConfidence(route, ctx.now).level,
  };
  // A new stop the car has already passed means driving back to it: that costs
  // battery, and from then on the road ahead starts at that stop.
  const next = planStop(
    route,
    moved.stopIndex,
    moved.anchor,
    moved.vehicle,
    ctx.now,
  );
  if (next && next.plan.alongKm < moved.km) {
    const back = moved.km - next.plan.alongKm;
    moved = {
      ...moved,
      km: next.plan.alongKm,
      anchor: {
        km: next.plan.alongKm,
        soc: Math.max(
          0,
          socAt(moved.anchor, moved.km, moved.vehicle) -
            back * pctPerKm(moved.vehicle),
        ),
      },
    };
  }
  const t = refresh(moved, ctx.now);
  const now = ctx.now;
  return absorb(t, [
    coDriverEvents.stopChanged({
      tripId: t.tripId,
      at: now,
      fromStationId: ctx.from.fromStationId,
      fromName: ctx.from.fromName,
      toName: t.primaryStop?.stationName ?? ctx.from.toName,
      aheadKm: ctx.from.aheadKm,
      auto: ctx.auto,
    }),
  ]);
}

export function setSmartDrive(trip: ActiveTrip, enabled: boolean): ActiveTrip {
  return {...trip, smartDriveEnabled: enabled};
}

export function dismissSwitch(trip: ActiveTrip): ActiveTrip {
  const p = trip.pendingSwitch;
  return {
    ...trip,
    dismissedSwitches: p
      ? [...trip.dismissedSwitches, `${p.fromStationId}:${p.toStationId}`]
      : trip.dismissedSwitches,
    pendingSwitch: null,
    monitoringStatus: trip.phase === 'driving' ? 'monitoring' : 'idle',
  };
}

// ------------------------------------------------------------------ charging --

export function beginCharging(trip: ActiveTrip, now: number): Out {
  if (trip.phase === 'charging' || trip.phase === 'ended') {
    return {trip, events: []};
  }
  return absorb(
    {...trip, phase: 'charging', monitoringStatus: 'idle', pendingSwitch: null},
    [
      coDriverEvents.chargingStarted({
        tripId: trip.tripId,
        at: now,
        stationName: trip.primaryStop?.stationName ?? 'the charger',
      }),
    ],
  );
}

/** Charging stopped at `soc`: is that enough to get on with the trip? */
export function applyChargeEnded(
  trip: ActiveTrip,
  soc: number,
  now: number,
): Out {
  const stop = trip.primaryStop;
  const finalStop = trip.stopIndex + 1 >= trip.route.stops.length;
  const enough = stop ? soc >= stop.chargeToSoc - 3 : true;
  return absorb(trip, [
    enough
      ? coDriverEvents.enoughCharge({
          tripId: trip.tripId,
          at: now,
          soc,
          finalStop,
        })
      : coDriverEvents.planUpdated({
          tripId: trip.tripId,
          at: now,
          detail: `You stopped at ${Math.round(
            soc,
          )}%. We’ve updated your plan for the road ahead.`,
        }),
  ]);
}

/** The stop is paid for: back on the road from `endSoc`. */
export function finishCharging(
  trip: ActiveTrip,
  done: {endSoc: number; energyKwh: number; costInr: number; chargeMin: number},
  now: number,
): Out {
  const t = refresh(
    {
      ...trip,
      phase: 'driving',
      stopIndex: trip.stopIndex + 1,
      anchor: {km: trip.km, soc: Math.round(done.endSoc)},
      monitoringStatus: 'monitoring',
      pendingSwitch: null,
      lastFreeBays: null,
      stats: {
        stopsCompleted: trip.stats.stopsCompleted + 1,
        energyKwh: trip.stats.energyKwh + done.energyKwh,
        costInr: trip.stats.costInr + done.costInr,
        chargeMin: trip.stats.chargeMin + done.chargeMin,
      },
    },
    now,
  );
  const settled = t.primaryStop ? t : {...t, monitoringStatus: 'idle' as const};
  return absorb(settled, [
    coDriverEvents.readyToContinue({
      tripId: t.tripId,
      at: now,
      soc: done.endSoc,
    }),
  ]);
}

export function endTrip(trip: ActiveTrip, now: number): ActiveTrip {
  return {
    ...trip,
    phase: 'ended',
    monitoringStatus: 'idle',
    pendingSwitch: null,
    endedAt: now,
  };
}

// ----------------------------------------------------------------- selectors --

/** Km until the planned charger, or null when no stop is left. */
export function kmToStop(trip: ActiveTrip): number | null {
  return trip.primaryStop
    ? Math.max(0, trip.primaryStop.alongKm - trip.km)
    : null;
}

export function kmToDestination(trip: ActiveTrip): number {
  return Math.max(0, trip.totalKm - trip.km);
}

/** Share of the journey driven, 0-1. */
export function tripProgress(trip: ActiveTrip): number {
  return trip.totalKm <= 0 ? 0 : Math.min(1, trip.km / trip.totalKm);
}
