import {
  availableCount,
  compatibleConnectors,
  hasUnconfirmedConnectors,
} from './rules';
import {dataTrust} from './trust';
import type {Confidence, Station, Vehicle} from './types';

/**
 * "Is it free now?" and "will it be free when I get there?" are different
 * questions, and a charger 30 minutes away can change in between.
 *
 * What exists in Phase 1 is the first answer, plus a rule-based RISK note that
 * says when "free now" is fragile (one bay left, a feed that isn't live, a long
 * drive). It is not a probability and is never worded like one.
 *
 * The second answer, `PredictedAvailabilityAtArrival`, has a slot in the data
 * model and a pluggable `AvailabilityPredictor`, but no predictor ships: the
 * default returns null, so nothing in the UI can claim a forecast that does not
 * exist. A real occupancy model replaces `NO_PREDICTION` and nothing else
 * changes.
 */

export type PredictedAvailabilityAtArrival = {
  /** Chance at least one compatible bay is free on arrival, 0-1. */
  probability: number;
  etaMin: number;
  basis: 'history' | 'model';
  confidence: Confidence;
};

export type AvailabilityPredictor = (input: {
  station: Station;
  vehicle: Vehicle | null;
  etaMin: number;
  now: number;
}) => PredictedAvailabilityAtArrival | null;

/** Phase 1: there is no occupancy model, so there is no prediction. */
export const NO_PREDICTION: AvailabilityPredictor = () => null;

export type ArrivalRisk = 'low' | 'medium' | 'high' | 'unknown';

export type ArrivalOutlook = {
  etaMin: number;
  /** Compatible bays free now, or null when the status is unknown. */
  freeNow: number | null;
  total: number;
  risk: ArrivalRisk;
  /** "2 of 4 free now". */
  headline: string;
  /** Why "free now" may not hold on arrival, in driver words. */
  note: string | null;
  predicted: PredictedAvailabilityAtArrival | null;
};

export function arrivalOutlook(
  station: Station,
  vehicle: Vehicle | null,
  etaMin: number,
  now: number,
  predictor: AvailabilityPredictor = NO_PREDICTION,
): ArrivalOutlook {
  const usable = compatibleConnectors(station, vehicle);
  const total = usable.length;
  const trust = dataTrust(station.statusFeed, now);
  const predicted = predictor({station, vehicle, etaMin, now});
  const base = {etaMin, total, predicted};

  const knows =
    !hasUnconfirmedConnectors(station) &&
    total > 0 &&
    trust !== 'unknown' &&
    usable.some(c => c.status !== 'unknown');
  if (!knows) {
    return {
      ...base,
      freeNow: null,
      risk: 'unknown',
      headline: 'Availability unknown',
      note: 'We can’t see this charger’s bays, so check when you arrive.',
    };
  }

  const free = availableCount(station, vehicle);
  if (free === 0) {
    return {
      ...base,
      freeNow: 0,
      risk: 'high',
      headline: 'No free bay right now',
      note: 'A bay may free up before you arrive, but we can’t promise it.',
    };
  }

  let risk: ArrivalRisk = 'low';
  let note: string | null = null;
  if (trust !== 'live') {
    risk = 'medium';
    note = 'This status isn’t live, so confirm it when you arrive.';
  }
  if (free === 1 && etaMin >= 15) {
    risk = 'medium';
    note = 'Only one bay is free, so this could change before you arrive.';
  } else if (free <= 2 && etaMin >= 40) {
    risk = 'medium';
    note =
      'It’s a long drive away, so the bays could change before you arrive.';
  }
  return {
    ...base,
    freeNow: free,
    risk,
    headline: `${free} of ${total} free now`,
    note,
  };
}
