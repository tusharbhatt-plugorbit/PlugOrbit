import {REPORTED_FREE_WAIT, availableCount} from '../domain/rules';
import {compatibleConnectors} from '../domain/rules';
import {dataTrust} from '../domain/trust';
import type {Station, Vehicle, WaitEstimate} from '../domain/types';
import type {SmartDriveConfig} from './config';
import type {AvailabilityOutlook} from './types';

/**
 * Expected wait when the driver ARRIVES (not now). The rule is the same one the
 * rest of the app keeps: "no wait" is a claim only a live operator feed can
 * back, and only for a short horizon. Everything else is a range with a
 * confidence, never a single minute count.
 */
export function expectedWait(
  station: Station,
  vehicle: Vehicle | null,
  now: number,
  etaAt: number,
  config: Pick<SmartDriveConfig, 'liveHorizonMin'>,
): WaitEstimate {
  const usable = compatibleConnectors(station, vehicle);
  const live = dataTrust(station.statusFeed, now) === 'live';
  const minutesAway = Math.max(0, (etaAt - now) / 60000);

  if (availableCount(station, vehicle) > 0) {
    // A bay is free now. That only stays true for a short while.
    return live && minutesAway <= config.liveHorizonMin
      ? {minMinutes: 0, maxMinutes: 0, confidence: 'high', basis: 'live_queue'}
      : REPORTED_FREE_WAIT;
  }
  if (usable.length > 0 && usable.every(c => c.status === 'offline')) {
    return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
  }
  const occupied = usable.filter(c => c.status === 'occupied').length;
  if (occupied === 0) {
    // Nothing is known to be free or busy: say so.
    return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
  }
  // Every bay is taken. A DC session usually runs 30-40 minutes, so a bay frees
  // up on average some 8-28 minutes from now; more bays share the queue.
  const bays = Math.max(1, usable.length);
  const share = 1 / Math.sqrt(bays);
  const min = Math.max(2, Math.round(8 * share));
  const max = Math.round(28 * share);
  // Cars already waiting each add a share of a session (only a live operator
  // feed reports a queue; without one we assume none rather than invent it).
  const queued = live ? Math.max(0, station.queueLength ?? 0) : 0;
  const queueMin = Math.round((queued * 25 * 0.7) / bays);
  const queueMax = Math.round((queued * 25 * 1.3) / bays);
  // The longer until arrival, the more of that queue will have cleared on its own.
  const clears = Math.min(1, minutesAway / 40);
  const trimmedMin = Math.max(
    0,
    Math.round((min + queueMin) * (1 - clears * 0.8)),
  );
  const trimmedMax = Math.max(
    trimmedMin + 3,
    Math.round((max + queueMax) * (1 - clears * 0.5)),
  );
  return {
    minMinutes: trimmedMin,
    maxMinutes: trimmedMax,
    confidence: live && minutesAway <= config.liveHorizonMin ? 'medium' : 'low',
    basis: 'history',
  };
}

/** Midpoint of a wait range in minutes, for ranking only (never displayed). */
export function waitMid(w: WaitEstimate): number {
  if (w.basis === 'none') {
    return 8;
  }
  return (w.minMinutes + w.maxMinutes) / 2;
}

/**
 * A future model (Phase 3) implements this and returns an outlook for the
 * moment the driver arrives. Until one is registered, `outlookAtArrival` uses
 * transparent rules and says it is doing so.
 */
export interface AvailabilityModel {
  predict(
    station: Station,
    vehicle: Vehicle | null,
    now: number,
    etaAt: number,
  ): AvailabilityOutlook | null;
}

/**
 * "Is it likely to be available when this driver gets there?"
 *
 * NOT a prediction model. A rules-based read of the current status that gets
 * more cautious the further ahead the arrival is, and gives up beyond an hour
 * rather than guess. `basis` says which one produced the answer.
 */
export function outlookAtArrival(
  station: Station,
  vehicle: Vehicle | null,
  now: number,
  etaAt: number,
  config: Pick<SmartDriveConfig, 'liveHorizonMin'>,
  model?: AvailabilityModel,
): AvailabilityOutlook {
  const modelled = model?.predict(station, vehicle, now, etaAt) ?? null;
  if (modelled) {
    return modelled;
  }
  const usable = compatibleConnectors(station, vehicle);
  const free = availableCount(station, vehicle);
  const trust = dataTrust(station.statusFeed, now);
  const minutesAway = Math.max(0, (etaAt - now) / 60000);

  const current: AvailabilityOutlook['currentAvailability'] =
    usable.length === 0 || usable.every(c => c.status === 'unknown')
      ? 'unknown'
      : usable.every(c => c.status === 'offline')
      ? 'offline'
      : free > 0
      ? 'available'
      : 'occupied';

  const base = {
    currentAvailability: current,
    expectedArrivalTime: etaAt,
  };
  if (current === 'unknown' || current === 'offline' || minutesAway > 60) {
    return {
      ...base,
      predictedAvailabilityAtArrival: null,
      predictionConfidence: null,
      basis: 'none',
    };
  }
  if (current === 'available') {
    const near = minutesAway <= config.liveHorizonMin;
    const confidence =
      trust === 'live' && near ? (free >= 2 ? 'high' : 'medium') : 'low';
    return {
      ...base,
      predictedAvailabilityAtArrival:
        confidence === 'low' ? 'uncertain' : 'likely_available',
      predictionConfidence: confidence,
      basis: 'rules',
    };
  }
  // Occupied now.
  const near = minutesAway <= config.liveHorizonMin;
  return {
    ...base,
    predictedAvailabilityAtArrival: near ? 'likely_busy' : 'uncertain',
    predictionConfidence: trust === 'live' && near ? 'medium' : 'low',
    basis: 'rules',
  };
}
