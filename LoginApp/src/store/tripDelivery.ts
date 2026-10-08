import type {ActiveTrip} from '../domain/activeTrip';
import {CoDriverEvent, deliveryFor} from '../domain/coDriver';
import {buildOfflineSnapshot} from '../domain/offlineTrip';
import type {AppNotification, Station} from '../domain/types';
import {appStore, TripRecord} from './appStore';
import {emitTripToast} from './tripEvents';

const INBOX_LIMIT = 100;
const HISTORY_LIMIT = 10;

/**
 * The one door every trip change goes through: it writes the new trip, decides
 * (by the event's level and the driver's preferences) what reaches the inbox
 * and what is said out loud, and keeps the offline copy of the plan fresh.
 *
 * `prev` is the trip as it was before the change, so a critical alert's
 * cooldown is measured against earlier alerts, not against itself.
 */
export function commitTrip(
  prev: ActiveTrip | null,
  next: ActiveTrip | null,
  events: readonly CoDriverEvent[],
  options: {now?: number; latest?: Readonly<Record<string, Station>>} = {},
): void {
  const now = options.now ?? Date.now();
  const state = appStore.get();
  const prefs = state.smartDrivePrefs;
  const inboxKeys = state.notifications
    .map(n => n.eventKey)
    .filter((k): k is string => typeof k === 'string');

  const added: AppNotification[] = [];
  const toasts: CoDriverEvent[] = [];
  events.forEach(e => {
    const d = deliveryFor(
      e,
      prefs,
      inboxKeys,
      prev?.lastCriticalAt ?? null,
      now,
    );
    if (d.inbox) {
      added.push({
        id: `n-${e.key}`,
        title: e.title,
        body: e.body,
        at: e.at,
        read: false,
        target: e.target,
        level: e.level,
        eventKey: e.key,
      });
    }
    if (d.toast) {
      toasts.push(e);
    }
  });

  // The saved plan is refreshed while there is signal, and whenever the stop
  // it describes changes; never from an offline trip (that would stamp old
  // statuses with a new time).
  const stopChanged =
    prev?.primaryStop?.stationId !== next?.primaryStop?.stationId ||
    prev?.stopIndex !== next?.stopIndex;
  const needsSnapshot =
    next !== null &&
    next.phase !== 'ended' &&
    next.monitoringStatus !== 'offline' &&
    (options.latest !== undefined ||
      stopChanged ||
      state.offlineTrip === null ||
      state.offlineTrip.tripId !== next.tripId);

  // While driving, the stored battery follows the trip's projection, so the
  // next charge starts from the right level. A level the driver just entered is
  // never overwritten: it already equals the projection.
  const follow =
    next !== null &&
    (next.phase === 'driving' || next.phase === 'at_charger') &&
    state.battery !== null &&
    Math.round(state.battery.percent) !== Math.round(next.currentSoc);

  appStore.set(s => ({
    ...(follow && next
      ? {
          battery: {
            percent: Math.round(next.currentSoc),
            source: 'estimate' as const,
            updatedAt: now,
          },
        }
      : {}),
    activeTrip: next,
    notifications:
      added.length > 0
        ? [...added, ...s.notifications].slice(0, INBOX_LIMIT)
        : s.notifications,
    ...(needsSnapshot && next
      ? {offlineTrip: buildOfflineSnapshot(next, now, options.latest)}
      : {}),
  }));
  toasts.forEach(emitTripToast);
}

/** The trip is over (arrived, or the driver ended it): archive and clear. */
export function archiveTrip(trip: ActiveTrip, now = Date.now()): void {
  const record: TripRecord = {
    tripId: trip.tripId,
    origin: trip.origin,
    destination: trip.destination,
    endedAt: now,
    distanceKm: Math.round(trip.km),
    stops: trip.stats.stopsCompleted,
    energyKwh: Math.round(trip.stats.energyKwh * 10) / 10,
    costInr: Math.round(trip.stats.costInr),
    arrivedWithSoc: trip.currentSoc,
    completed: trip.phase === 'arrived',
  };
  appStore.set(s => ({
    activeTrip: null,
    offlineTrip: null,
    activeRoute: null,
    chosen: null,
    completedTrips: [record, ...s.completedTrips].slice(0, HISTORY_LIMIT),
  }));
}
