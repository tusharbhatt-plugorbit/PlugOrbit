import type {ActiveTrip, Range, TripOutcome} from './types';

/**
 * AnalyticsService: the feedback loop.
 *
 * Every finished trip records what we PREDICTED at the charger next to what
 * HAPPENED, so prediction can be measured against reality. Today this is just
 * stored (and summarised on screen); it is the training data and the scoreboard
 * for the Phase 3 models.
 */

export type ActualExtras = {
  /** Billed total from the finished session, when there was one. */
  costInr?: number | null;
  /** The driver's rating of the stop, 1-5. */
  rating?: number | null;
};

const within = (value: number, r: Range, slack: number): boolean =>
  value >= r.min - slack && value <= r.max + slack;

export function buildOutcome(
  trip: ActiveTrip,
  extras: ActualExtras = {},
  endedAt: number = trip.endedAt ?? trip.lastRecalculatedAt,
): TripOutcome {
  const p = trip.prediction;
  const a = trip.actuals;
  const cost = extras.costInr ?? null;
  const followed =
    p !== null && a.stationId !== null && p.stationId === a.stationId;
  return {
    tripId: trip.tripId,
    endedAt,
    vehicleId: trip.vehicleId,
    from: trip.origin.label,
    to: trip.destination.label,
    plannedStationId: p ? p.stationId : null,
    actualStationId: a.stationId,
    followedPlan: followed,
    predicted: {
      arriveSoc: p ? Math.round(p.arriveSocExpected) : null,
      waitMinutes: p ? p.waitMinutes : null,
      chargeMinutes: p ? p.chargeMinutes : null,
      targetSoc: p ? p.targetSoc : null,
      costInr: p ? p.costInr : null,
    },
    actual: {
      arriveSoc: a.arriveSoc === null ? null : Math.round(a.arriveSoc),
      waitMinutes: a.waitMin === null ? null : Math.round(a.waitMin),
      chargeMinutes: a.chargeMin === null ? null : Math.round(a.chargeMin),
      endSoc: a.endSoc === null ? null : Math.round(a.endSoc),
      costInr: cost,
      startedOk: a.startedOk,
      paymentOk: a.paymentOk,
      rating: extras.rating ?? null,
    },
    error: {
      arriveSocPts:
        p && a.arriveSoc !== null
          ? Math.round((a.arriveSoc - p.arriveSocExpected) * 10) / 10
          : null,
      waitInRange:
        p && a.waitMin !== null ? within(a.waitMin, p.waitMinutes, 2) : null,
      chargeInRange:
        p && a.chargeMin !== null
          ? within(a.chargeMin, p.chargeMinutes, 3)
          : null,
      costInr:
        p && p.costInr !== null && cost !== null ? cost - p.costInr : null,
    },
    copilot: {
      checks: trip.counters.checks,
      told: trip.counters.told,
      silent: trip.counters.silent,
      switched: trip.log.filter(
        l => l.kind === 'replanned' && /^Switched/.test(l.text),
      ).length,
    },
  };
}

export type AccuracySummary = {
  trips: number;
  /** Mean absolute error of the predicted arrival battery, in points. */
  arriveSocErrPts: number | null;
  /** Share of trips where the real wait fell inside the predicted range. */
  waitWithinRangePct: number | null;
  chargeWithinRangePct: number | null;
  costErrInr: number | null;
};

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

const share = (xs: boolean[]): number | null =>
  xs.length === 0
    ? null
    : Math.round((xs.filter(Boolean).length / xs.length) * 100);

/** How good the predictions have been. Null where there is nothing to compare. */
export function accuracyOf(outcomes: readonly TripOutcome[]): AccuracySummary {
  const nums = (f: (o: TripOutcome) => number | null) =>
    outcomes.map(f).filter((x): x is number => x !== null);
  const bools = (f: (o: TripOutcome) => boolean | null) =>
    outcomes.map(f).filter((x): x is boolean => x !== null);
  const arrive = mean(nums(o => o.error.arriveSocPts).map(Math.abs));
  const cost = mean(nums(o => o.error.costInr).map(Math.abs));
  return {
    trips: outcomes.length,
    arriveSocErrPts: arrive === null ? null : Math.round(arrive * 10) / 10,
    waitWithinRangePct: share(bools(o => o.error.waitInRange)),
    chargeWithinRangePct: share(bools(o => o.error.chargeInRange)),
    costErrInr: cost === null ? null : Math.round(cost),
  };
}
