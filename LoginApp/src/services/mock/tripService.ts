import type {ActiveTrip, PendingSwitch} from '../../domain/activeTrip';
import {
  applyOffline,
  applyPosition,
  applyRouteChange,
  applyStatusCheck,
  createTrip,
  dismissSwitch,
  setSmartDrive,
} from '../../domain/tripEngine';
import {coDriverEvents} from '../../domain/coDriver';
import type {Station, StationWithDistance} from '../../domain/types';
import {appStore, getActiveVehicle} from '../../store/appStore';
import {onBatteryEdited} from '../../store/tripCoordinator';
import {archiveTrip, commitTrip} from '../../store/tripDelivery';
import {chooseStop} from '../../store/tripActions';
import type {OfflineTripService, TripService} from '../types';
import {ApiError, OfflineError} from '../types';
import {createRouteService} from './routeService';
import {createStationService, waitFor} from './stationService';

/** A trip is already being co-driven. */
export class TripInProgressError extends Error {
  constructor(
    message = 'You already have a trip in progress. End it before starting another.',
  ) {
    super(message);
    this.name = 'TripInProgressError';
  }
}

const running = (t: ActiveTrip | null): t is ActiveTrip =>
  t !== null && t.phase !== 'ended';

/**
 * Mock trip service: Smart Drive over the mock stations and route service. The
 * decisions are the real engine's (`domain/tripEngine`); only the data feeding
 * it is mocked. Positions arrive through `advance`, so a GPS feed can replace
 * the simulated drive without touching anything else.
 */
export function createTripService(): TripService {
  const stations = createStationService();
  const routes = createRouteService();

  /**
   * Re-plan the route onto the suggested backup and carry the trip over. The
   * trip is re-read after the (slow) re-plan, so a position update or a
   * decision made meanwhile is never overwritten.
   */
  async function performSwitch(
    started: ActiveTrip,
    pending: PendingSwitch,
    auto: boolean,
  ): Promise<ActiveTrip> {
    const next = await routes.switchToBackup(started.route, started.stopIndex);
    const cur = appStore.get().activeTrip;
    if (
      !running(cur) ||
      cur.tripId !== started.tripId ||
      cur.stopIndex !== started.stopIndex
    ) {
      throw new ApiError(
        'Your trip moved on while we were switching. Nothing was changed.',
      );
    }
    const out = applyRouteChange(cur, next, {
      now: Date.now(),
      auto,
      from: pending,
    });
    chooseStop(next, cur.stopIndex);
    commitTrip(cur, out.trip, out.events);
    return out.trip;
  }

  return {
    async start({route, smartDrive, replace = false}) {
      const vehicle = getActiveVehicle();
      if (!vehicle) {
        throw new ApiError('Add your car first so we can co-drive for it.');
      }
      const existing = appStore.get().activeTrip;
      if (running(existing) && !replace) {
        throw new TripInProgressError();
      }
      const now = Date.now();
      const out = createTrip({route, vehicle, smartDrive, now});
      // The route screens and the presenter's "occupied" switch follow the
      // trip's first stop.
      chooseStop(route, 0);
      commitTrip(null, out.trip, out.events, {now});
      return out.trip;
    },

    async refresh() {
      const before = appStore.get().activeTrip;
      if (
        !running(before) ||
        (before.phase !== 'driving' && before.phase !== 'at_charger')
      ) {
        return before;
      }
      const stop = before.primaryStop;
      let primary: StationWithDistance | null = null;
      let backup: StationWithDistance | null = null;
      try {
        if (stop) {
          [primary, backup] = await Promise.all([
            stations.get(stop.stationId),
            stop.backup ? stations.get(stop.backup.stationId) : null,
          ]);
        }
      } catch (e) {
        const cur = appStore.get().activeTrip;
        if (running(cur) && e instanceof OfflineError) {
          const out = applyOffline(cur, Date.now());
          commitTrip(cur, out.trip, out.events);
          return out.trip;
        }
        // Trouble on our side: keep the last good picture rather than alarm.
        return appStore.get().activeTrip;
      }

      // Apply what we saw to the trip AS IT IS NOW, not as it was when we asked.
      const cur = appStore.get().activeTrip;
      if (
        !running(cur) ||
        cur.tripId !== before.tripId ||
        cur.primaryStop?.stationId !== stop?.stationId
      ) {
        return cur;
      }
      const now = Date.now();
      const prefs = appStore.get().smartDrivePrefs;
      const out = applyStatusCheck(
        cur,
        {now, primary, backup, waitOf: (s, v) => waitFor(s, v, now)},
        prefs.autoSwitch,
      );
      const latest: Record<string, Station> = {};
      if (primary) {
        latest[primary.id] = primary;
      }
      if (backup) {
        latest[backup.id] = backup;
      }

      if (out.autoSwitch) {
        try {
          commitTrip(cur, out.trip, out.events, {now, latest});
          return await performSwitch(out.trip, out.autoSwitch, true);
        } catch {
          // Couldn't move on our own (no signal, or the plan changed): fall back
          // to asking, so the driver is never left unaware.
          const pending = out.autoSwitch;
          const asked = appStore.get().activeTrip;
          if (running(asked) && asked.tripId === cur.tripId) {
            const ask = {
              ...asked,
              pendingSwitch: pending,
              monitoringStatus: 'switch_available' as const,
            };
            commitTrip(asked, ask, [
              coDriverEvents.switchSuggested({
                tripId: ask.tripId,
                at: now,
                fromStationId: pending.fromStationId,
                fromName: pending.fromName,
                toName: pending.toName,
                aheadKm: pending.aheadKm,
                reason: pending.reason,
              }),
            ]);
            return ask;
          }
          return asked;
        }
      }
      commitTrip(cur, out.trip, out.events, {now, latest});
      return out.trip;
    },

    async advance(km) {
      const cur = appStore.get().activeTrip;
      if (!running(cur)) {
        return cur;
      }
      const out = applyPosition(cur, km, {
        now: Date.now(),
        remindKm: appStore.get().smartDrivePrefs.remindKm,
      });
      if (out.trip !== cur) {
        commitTrip(cur, out.trip, out.events);
      }
      return out.trip;
    },

    async acceptSwitch() {
      const cur = appStore.get().activeTrip;
      if (!running(cur)) {
        throw new ApiError(
          'There’s no trip to change. Start a trip and we’ll watch the charger.',
        );
      }
      const stop = cur.primaryStop;
      // Normally the driver is accepting a suggestion. They may also ask for
      // their backup themselves (a charger that looks wrong when they get there).
      const pending: PendingSwitch | null =
        cur.pendingSwitch ??
        (stop && stop.backup
          ? {
              fromStationId: stop.stationId,
              fromName: stop.stationName,
              toStationId: stop.backup.stationId,
              toName: stop.backup.stationName,
              reason: 'occupied',
              aheadKm:
                stop.backup.alongKm - cur.km > 0.5
                  ? Math.round((stop.backup.alongKm - cur.km) * 10) / 10
                  : null,
              savedMin: null,
              createdAt: Date.now(),
            }
          : null);
      if (!pending) {
        throw new ApiError(
          'This stop has no backup planned. Pick another charger.',
        );
      }
      return performSwitch(cur, pending, false);
    },

    async dismissSwitch() {
      const cur = appStore.get().activeTrip;
      if (!running(cur)) {
        return cur;
      }
      const next = dismissSwitch(cur);
      commitTrip(cur, next, []);
      return next;
    },

    async setSmartDrive(enabled) {
      const cur = appStore.get().activeTrip;
      if (!running(cur)) {
        return cur;
      }
      const next = setSmartDrive(cur, enabled);
      commitTrip(cur, next, []);
      return next;
    },

    async updateBattery(percent) {
      const rounded = Math.min(100, Math.max(0, Math.round(percent)));
      appStore.set({
        battery: {percent: rounded, source: 'manual', updatedAt: Date.now()},
      });
      onBatteryEdited(rounded);
      return appStore.get().activeTrip;
    },

    async finish() {
      const cur = appStore.get().activeTrip;
      if (cur) {
        archiveTrip(cur, Date.now());
      }
    },
  };
}

export function createOfflineTripService(): OfflineTripService {
  return {
    load: () => appStore.get().offlineTrip,
    clear: () => appStore.set({offlineTrip: null}),
  };
}
