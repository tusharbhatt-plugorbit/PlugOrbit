import {computeSessionMetrics} from '../domain/charging';
import {
  applyBattery,
  applyChargeEnded,
  beginCharging,
  finishCharging,
} from '../domain/tripEngine';
import type {ChargingSession, SessionSummary} from '../domain/types';
import {appStore} from './appStore';
import {commitTrip} from './tripDelivery';

/**
 * Keeps the trip in step with the charging session, without the session
 * screens knowing a trip exists. The session and payment services call these
 * at the three moments that matter; with no trip they do nothing.
 *
 *   session active   -> the trip is "charging"
 *   session stopped  -> "enough charge" (or an updated plan) is said
 *   session paid     -> back on the road from the new battery
 */

function liveTrip() {
  const trip = appStore.get().activeTrip;
  return trip && trip.phase !== 'ended' && trip.phase !== 'arrived'
    ? trip
    : null;
}

export function onSessionStarted(_session: ChargingSession): void {
  const trip = liveTrip();
  if (!trip) {
    return;
  }
  const out = beginCharging(trip, Date.now());
  commitTrip(trip, out.trip, out.events);
}

export function onSessionStopped(session: ChargingSession): void {
  const trip = liveTrip();
  if (!trip || trip.phase !== 'charging') {
    return;
  }
  const at = session.stoppedAt ?? Date.now();
  const soc = Math.round(computeSessionMetrics(session, at).socPercent);
  const out = applyChargeEnded(trip, soc, Date.now());
  commitTrip(trip, out.trip, out.events);
}

export function onSessionSettled(summary: SessionSummary): void {
  const trip = liveTrip();
  if (!trip || trip.phase !== 'charging') {
    return;
  }
  const out = finishCharging(
    trip,
    {
      endSoc: summary.endSoc,
      energyKwh: summary.energyKwh,
      costInr: summary.costInr,
      chargeMin: summary.durationMin,
    },
    Date.now(),
  );
  commitTrip(trip, out.trip, out.events);
}

/** The driver corrected the battery by hand while a trip is running. */
export function onBatteryEdited(percent: number): void {
  const trip = liveTrip();
  if (!trip || (trip.phase !== 'driving' && trip.phase !== 'at_charger')) {
    return;
  }
  const out = applyBattery(trip, percent, Date.now());
  commitTrip(trip, out.trip, out.events);
}
