import {computeSessionMetrics} from '../domain/charging';
import type {ChargingSession} from '../domain/types';
import type {ActiveTrip, TripEvent} from './types';

/** An event before the host stamps it with the time. */
export type EventInput = TripEvent extends infer E
  ? E extends {at: number}
    ? Omit<E, 'at'>
    : never
  : never;

/**
 * Turns what happened in the existing charging flow (start, progress, stop,
 * payment) into Smart Drive events, so charging and the co-pilot stay in step
 * without the charging screens knowing Smart Drive exists.
 *
 * Idempotent: it only returns what is NEW relative to the trip, so calling it
 * on every tick is safe. `wallNow` is the real clock the session is timed
 * against; the trip's own clock is the host's concern.
 */
export function sessionEvents(
  trip: ActiveTrip | null,
  session: ChargingSession | null,
  wallNow: number,
): EventInput[] {
  if (!trip || trip.monitoringState === 'ended' || trip.phase === 'ready') {
    return [];
  }
  const out: EventInput[] = [];

  if (session && session.status === 'active') {
    if (!trip.session) {
      out.push({
        type: 'SESSION_STARTED',
        stationId: session.stationId,
        startSoc: session.startSoc,
        targetSoc: session.targetSoc,
      });
      return out;
    }
    const m = computeSessionMetrics(session, wallNow);
    if (Math.abs(m.socPercent - trip.currentSoC) >= 1) {
      out.push({type: 'BATTERY_UPDATED', soc: m.socPercent});
    }
    if (m.reachedTarget && trip.session.reachedTargetAt === null) {
      out.push({type: 'TARGET_SOC_REACHED', soc: m.socPercent});
    }
    return out;
  }

  if (trip.session) {
    // The charging flow moved on: stopped, awaiting payment, paid or cleared.
    const finalSoc = session
      ? computeSessionMetrics(session, wallNow).socPercent
      : trip.currentSoC;
    out.push({type: 'SESSION_ENDED', soc: finalSoc});
  }
  if (
    session?.status === 'payment_failed' &&
    trip.actuals.paymentOk !== false
  ) {
    out.push({type: 'PAYMENT_FAILED'});
  }
  return out;
}
