import {DEFAULT_SMART_DRIVE_CONFIG} from '../../intelligence/config';
import {buildOutcome} from '../../intelligence/analytics';
import {driveMinutes} from '../../intelligence/battery';
import {answerQuestion} from '../../intelligence/explain';
import {createTrip, processEvent} from '../../intelligence/monitor';
import {leansOf, profileFromPrefs} from '../../intelligence/preferences';
import type {
  ActiveTrip,
  NotificationDraft,
  ScoredStop,
  TripEvent,
  TripUpdate,
  World,
} from '../../intelligence/types';
import type {AppNotification, Station} from '../../domain/types';
import {appStore, getActiveVehicle} from '../../store/appStore';
import {
  dismissSuggestion,
  recordChoice,
  saveOutcome,
  setSmartDrivePrefs,
  setTrip,
} from '../../store/smartDriveActions';
import type {SmartDriveDemo, SmartDriveService} from '../types';
import {ApiError, OfflineError} from '../types';
import {buildStations, findPlace} from './data';
import {pathBetween} from './routeService';
import {guard, uid} from './runtime';

/** Longest single hop of a simulated drive, so messages arrive in order. */
const HOP_KM = 6;

type Overlay = {status: 'occupied' | 'offline'; queue: number};

// Presenter overlays on top of the mock chargers. In memory on purpose: a
// restart is a fresh, calm world.
const overlays = new Map<string, Overlay>();
let signalLost = false;
let lastWorld: World | null = null;

function applyOverlays(stations: Station[], now: number): Station[] {
  return stations.map(s => {
    const o = overlays.get(s.id);
    if (!o) {
      return s;
    }
    return {
      ...s,
      connectors: s.connectors.map(c => ({...c, status: o.status})),
      statusFeed: {source: 'operator_feed', updatedAt: now - 4000},
      ...(o.queue > 0 ? {queueLength: o.queue} : {}),
    };
  });
}

/**
 * The world as it is at `now`: every charger with a fresh feed timestamp, plus
 * whatever the presenter did. Offline we reuse the last snapshot, so cached
 * statuses age honestly instead of staying "fresh".
 * TODO(integration): charger status from operator / CMS feeds.
 */
function worldAt(now: number, offline: boolean): World {
  if (offline && lastWorld) {
    return {...lastWorld, now};
  }
  const world = {now, stations: applyOverlays(buildStations(now), now)};
  lastWorld = world;
  return world;
}

const tripNow = (trip: ActiveTrip) => Date.now() + trip.clockOffsetMs;

function currentTrip(): ActiveTrip {
  const trip = appStore.get().smartDrive.trip;
  if (!trip) {
    throw new ApiError('There’s no trip in progress. Start Smart Drive first.');
  }
  return trip;
}

function requireVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) {
    throw new ApiError('Add your vehicle first so we can plan for it.');
  }
  return vehicle;
}

const STOP_KINDS = new Set<NotificationDraft['kind']>([
  'stop_approaching',
  'stop_imminent',
  'near_charger',
  'better_charger',
  'charger_unavailable',
  'charger_getting_busy',
  'backup_lost',
  'enough_charge',
]);

function toAppNotification(d: NotificationDraft): AppNotification {
  return {
    id: uid('sd'),
    title: d.title,
    body: d.body,
    at: Date.now(),
    read: false,
    level: d.level,
    source: 'smart_drive',
    target: {route: STOP_KINDS.has(d.kind) ? 'SmartDriveStop' : 'SmartDrive'},
  };
}

/** Save the new trip state, the notifications, and keep the battery in step. */
function commit(update: TripUpdate): void {
  const {trip} = update;
  appStore.set(s => {
    const battery = trip.simulated
      ? {
          percent: Math.round(trip.currentSoC),
          source: 'trip_estimate' as const,
          updatedAt: Date.now(),
        }
      : s.battery;
    return {
      smartDrive: {...s.smartDrive, trip},
      battery,
      notifications: [
        ...update.notifications.map(toAppNotification),
        ...s.notifications,
      ],
    };
  });
}

const merge = (a: TripUpdate | null, b: TripUpdate): TripUpdate =>
  a === null
    ? b
    : {
        trip: b.trip,
        notifications: [...a.notifications, ...b.notifications],
        decisions: [...a.decisions, ...b.decisions],
        events: [...a.events, ...b.events],
      };

/** What would happen, without saving it. */
function evaluate(trip: ActiveTrip, event: TripEvent): TripUpdate {
  const vehicle = requireVehicle();
  const offline = trip.network === 'offline' || signalLost;
  return processEvent(trip, event, {
    vehicle,
    world: worldAt(event.at, offline),
    config: DEFAULT_SMART_DRIVE_CONFIG,
    quiet: appStore.get().smartDrive.prefs.verbosity === 'minimal',
  });
}

function run(trip: ActiveTrip, event: TripEvent): TripUpdate {
  const update = evaluate(trip, event);
  commit(update);
  return update;
}

/** The network as the trip sees it right now; emits loss / return events. */
async function syncNetwork(trip: ActiveTrip): Promise<ActiveTrip> {
  let reachable = !signalLost;
  if (reachable) {
    try {
      await guard(120);
    } catch (e) {
      if (!(e instanceof OfflineError)) {
        throw e;
      }
      reachable = false;
    }
  }
  const at = tripNow(trip);
  if (!reachable && trip.network === 'online') {
    return run(trip, {type: 'NETWORK_LOST', at}).trip;
  }
  if (reachable && trip.network === 'offline') {
    return run(trip, {type: 'NETWORK_RESTORED', at}).trip;
  }
  return trip;
}

function safeStops(trip: ActiveTrip): ScoredStop[] {
  const p = trip.plan;
  return [p.primary, p.backup, ...p.alternatives].filter(
    (s): s is ScoredStop => s !== null,
  );
}

function noteChoice(
  trip: ActiveTrip,
  chosen: ScoredStop,
  recommended: ScoredStop,
) {
  recordChoice({
    at: Date.now(),
    tripId: trip.tripId,
    chosenId: chosen.station.id,
    recommendedId: recommended.station.id,
    leans: leansOf(chosen, recommended),
  });
}

export function createSmartDriveService(): SmartDriveService {
  const advance: SmartDriveService['advance'] = async km => {
    let trip = await syncNetwork(currentTrip());
    if (trip.monitoringState === 'ended') {
      throw new ApiError('This trip has finished.');
    }
    // The car stops at the junction of the planned charger so the driver can
    // choose to charge; a second press drives on past it.
    let target = Math.min(trip.totalKm, trip.progressKm + km);
    const stop = trip.plan.primary;
    if (
      stop &&
      trip.phase !== 'at_stop' &&
      stop.alongKm > trip.progressKm + 0.2 &&
      target > stop.alongKm
    ) {
      target = stop.alongKm;
    }
    let combined: TripUpdate | null = null;
    while (
      trip.progressKm < target - 1e-6 &&
      trip.monitoringState !== 'ended'
    ) {
      const next = Math.min(target, trip.progressKm + HOP_KM);
      const minutes = driveMinutes(
        next - trip.progressKm,
        DEFAULT_SMART_DRIVE_CONFIG,
        trip.conditions,
      );
      const moved: ActiveTrip = {
        ...trip,
        clockOffsetMs: trip.clockOffsetMs + minutes * 60000,
      };
      const update = run(moved, {
        type: 'LOCATION_UPDATED',
        at: tripNow(moved),
        progressKm: next,
      });
      combined = merge(combined, update);
      trip = update.trip;
    }
    return combined ?? {trip, notifications: [], decisions: [], events: []};
  };

  const demo: SmartDriveDemo = {
    async occupy(stationId, queue = 6) {
      const trip = currentTrip();
      const id = stationId ?? trip.plan.primary?.station.id;
      if (!id) {
        throw new ApiError('No charger is planned yet.');
      }
      overlays.set(id, {status: 'occupied', queue});
      return run(trip, {type: 'TICK', at: tripNow(trip)});
    },
    async takeOffline(stationId) {
      const trip = currentTrip();
      const id = stationId ?? trip.plan.primary?.station.id;
      if (!id) {
        throw new ApiError('No charger is planned yet.');
      }
      overlays.set(id, {status: 'offline', queue: 0});
      return run(trip, {type: 'TICK', at: tripNow(trip)});
    },
    async driveToStop() {
      const trip = currentTrip();
      const stop = trip.plan.primary;
      if (!stop) {
        throw new ApiError('There’s no stop to drive to.');
      }
      return advance(Math.max(0, stop.alongKm - trip.progressKm));
    },
    async setSignal(online) {
      signalLost = !online;
      const trip = appStore.get().smartDrive.trip;
      if (!trip) {
        return null;
      }
      const synced = await syncNetwork(trip);
      return {trip: synced, notifications: [], decisions: [], events: []};
    },
    reset() {
      overlays.clear();
      signalLost = false;
      lastWorld = null;
    },
  };

  return {
    async start(input) {
      await guard(700);
      const vehicle = requireVehicle();
      const startSoc = input.startSoc ?? appStore.get().battery?.percent;
      if (startSoc === undefined) {
        throw new ApiError(
          'Set your battery first so we know where you start.',
        );
      }
      const from = findPlace(input.fromLabel);
      const to = findPlace(input.toLabel);
      if (!from || !to) {
        throw new ApiError(
          'Choose a start and destination from the suggestions.',
        );
      }
      if (from.name === to.name) {
        throw new ApiError('Start and destination are the same place.');
      }
      demo.reset();
      const prefs = appStore.get().tripPrefs;
      const now = Date.now();
      const trip = createTrip({
        tripId: uid('trip'),
        vehicle,
        origin: {label: from.name, coords: from.coords},
        destination: {label: to.name, coords: to.coords},
        polyline: pathBetween(from.coords, to.coords),
        startSoc,
        now,
        world: worldAt(now, false),
        config: DEFAULT_SMART_DRIVE_CONFIG,
        reservePct: prefs.minArrivalSocPct,
        profile: profileFromPrefs(prefs),
        preferAmenities: prefs.preferAmenities,
        simulated: true,
      });
      const withPrefs = {
        ...trip,
        smartDriveEnabled: appStore.get().smartDrive.prefs.enabled,
      };
      setTrip(withPrefs);
      return withPrefs;
    },

    async begin() {
      const trip = currentTrip();
      await guard(200);
      if (trip.phase !== 'ready') {
        return {trip, notifications: [], decisions: [], events: []};
      }
      return run(trip, {type: 'TRIP_STARTED', at: tripNow(trip)});
    },

    async tick() {
      const existing = appStore.get().smartDrive.trip;
      if (!existing || existing.monitoringState === 'ended') {
        return null;
      }
      if (existing.phase === 'ready') {
        return null;
      }
      const trip = await syncNetwork(existing);
      return run(trip, {type: 'TICK', at: tripNow(trip)});
    },

    advance,

    async report(event) {
      const trip = currentTrip();
      return run(trip, {...event, at: tripNow(trip)} as TripEvent);
    },

    async switchTo(stationId) {
      await guard(250);
      const trip = currentTrip();
      const chosen = safeStops(trip).find(s => s.station.id === stationId);
      if (!chosen) {
        throw new ApiError('That charger isn’t a safe option right now.');
      }
      if (
        trip.plan.primary &&
        chosen.station.id !== trip.plan.primary.station.id
      ) {
        noteChoice(trip, chosen, trip.plan.primary);
      }
      return run(trip, {
        type: 'USER_SWITCHED_CHARGER',
        at: tripNow(trip),
        stationId,
      });
    },

    async keepOriginal() {
      await guard(250);
      const trip = currentTrip();
      const change = trip.lastChange;
      if (!change || change.reason === 'safety') {
        throw new ApiError(
          'The original charger isn’t a safe choice any more.',
        );
      }
      // Ask the planner, rather than trusting a list: only if the original is
      // still safe will it come back as the plan.
      const update = evaluate(trip, {
        type: 'USER_KEPT_ORIGINAL',
        at: tripNow(trip),
      });
      const kept = update.trip.plan.primary;
      if (!kept || kept.station.id !== change.from) {
        throw new ApiError(
          'The original charger isn’t a safe option right now.',
        );
      }
      if (trip.plan.primary) {
        noteChoice(trip, kept, trip.plan.primary);
      }
      commit(update);
      return update;
    },

    async ask(question) {
      await guard(180);
      return answerQuestion(currentTrip(), question);
    },

    async setEnabled(enabled) {
      await guard(100);
      setSmartDrivePrefs({enabled});
      const trip = appStore.get().smartDrive.trip;
      if (trip && trip.monitoringState !== 'ended') {
        setTrip({...trip, smartDriveEnabled: enabled});
      }
    },

    async setVerbosity(verbosity) {
      await guard(100);
      setSmartDrivePrefs({verbosity});
    },

    async dismissSuggestion(id) {
      await guard(80);
      dismissSuggestion(id);
    },

    async end() {
      await guard(250);
      const trip = appStore.get().smartDrive.trip;
      if (!trip) {
        return null;
      }
      let outcome = null;
      if (trip.prediction) {
        const stationName = buildStations(Date.now()).find(
          s => s.id === trip.actuals.stationId,
        )?.name;
        const spent = appStore
          .get()
          .history.find(h => h.stationName === stationName);
        outcome = buildOutcome(
          trip,
          {costInr: spent ? spent.costInr : null},
          trip.endedAt ?? tripNow(trip),
        );
        saveOutcome(outcome);
      }
      setTrip(null);
      demo.reset();
      return outcome;
    },

    demo,
  };
}

/** Test helper: forget presenter overlays and the cached world. */
export function resetSmartDriveMock(): void {
  overlays.clear();
  signalLost = false;
  lastWorld = null;
}
