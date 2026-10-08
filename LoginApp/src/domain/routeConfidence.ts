import type {ConfidenceReason} from './chargeConfidence';
import {dataTrust} from './trust';
import type {Confidence, Route} from './types';

/**
 * ROUTE CONFIDENCE: how comfortable the whole trip is, to take range anxiety
 * off the table before the driver leaves. Built only from what the plan shows:
 * battery margins at each stop, whether every stop has a backup, the longest
 * stretch between chargers, and how trustworthy the stops' statuses are.
 */

export type RouteConfidence = {
  level: Confidence;
  /** "High", "Medium" or "Low". */
  label: string;
  headline: string;
  /** Strongest first, at most 4. */
  reasons: ConfidenceReason[];
};

const LABEL: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const HEADLINE: Record<Confidence, string> = {
  high: 'You’re set for this trip.',
  medium: 'This trip works, with a few things to watch.',
  low: 'This trip is tight. Charge a little first if you can.',
};

/** Battery used on one stretch above this share is a long gap between chargers. */
const LONG_GAP_PCT = 55;
const VERY_LONG_GAP_PCT = 70;
const COMFORTABLE_ARRIVAL_PCT = 15;
const TIGHT_ARRIVAL_PCT = 8;

export function routeConfidence(route: Route, now: number): RouteConfidence {
  const good: ConfidenceReason[] = [];
  const watch: ConfidenceReason[] = [];
  let level: Confidence = 'high';
  const lower = (to: Confidence) => {
    if (to === 'low' || (to === 'medium' && level === 'high')) {
      level = to;
    }
  };

  if (route.stops.length === 0) {
    if (route.arriveSoc >= route.safetyReservePct + COMFORTABLE_ARRIVAL_PCT) {
      good.push({
        text: `No charging stop needed: you arrive with about ${route.arriveSoc}%`,
        tone: 'good',
      });
    } else {
      lower('medium');
      watch.push({
        text: `No stop planned, but you arrive with only about ${route.arriveSoc}%`,
        tone: 'warn',
      });
    }
    return finish(level, good, watch);
  }

  // ---- battery margins ---------------------------------------------------
  const lowestArrival = Math.min(
    route.arriveSoc,
    ...route.stops.map(s => s.arriveSoc),
  );
  if (lowestArrival < TIGHT_ARRIVAL_PCT) {
    lower('low');
    watch.push({
      text: `Your battery gets down to about ${lowestArrival}% before charging`,
      tone: 'warn',
    });
  } else if (lowestArrival < COMFORTABLE_ARRIVAL_PCT) {
    lower('medium');
    watch.push({
      text: `Your battery gets down to about ${lowestArrival}% before charging`,
      tone: 'warn',
    });
  } else {
    good.push({
      text: `Safe battery margins: never below about ${lowestArrival}%`,
      tone: 'good',
    });
  }

  // ---- backups -------------------------------------------------------------
  const unbacked = route.stops.filter(s => !s.backup).length;
  if (unbacked === 0) {
    good.push({
      text:
        route.stops.length === 1
          ? 'Your charging stop has a backup'
          : `All ${route.stops.length} charging stops have a backup`,
      tone: 'good',
    });
  } else {
    lower('medium');
    watch.push({
      text:
        unbacked === route.stops.length
          ? 'No stop has a backup close enough'
          : `${unbacked} of ${route.stops.length} stops have no close backup`,
      tone: 'warn',
    });
  }

  // ---- the longest stretch between chargers ----------------------------------
  const points = [route.startSoc];
  route.stops.forEach(s => points.push(s.arriveSoc, s.chargeToSoc));
  points.push(route.arriveSoc);
  let longest = 0;
  for (let i = 0; i + 1 < points.length; i += 2) {
    longest = Math.max(longest, points[i] - points[i + 1]);
  }
  if (longest > VERY_LONG_GAP_PCT) {
    lower('low');
    watch.push({
      text: 'A long stretch between chargers uses most of your battery',
      tone: 'warn',
    });
  } else if (longest > LONG_GAP_PCT) {
    lower('medium');
    watch.push({
      text: 'One stretch between chargers is long',
      tone: 'warn',
    });
  }

  // ---- how much we can see of the chargers ------------------------------------
  const blind = route.stops.filter(
    s => dataTrust(s.station.statusFeed, now) === 'unknown',
  ).length;
  if (blind > 0) {
    lower('medium');
    watch.push({
      text:
        blind === 1
          ? 'We can’t see the status of one planned charger'
          : `We can’t see the status of ${blind} planned chargers`,
      tone: 'warn',
    });
  }
  const shaky = route.stops.filter(
    s => s.station.reliabilityPct > 0 && s.station.reliabilityPct < 75,
  ).length;
  if (shaky > 0) {
    lower('medium');
    watch.push({
      text: 'A planned charger has a patchy reliability record',
      tone: 'warn',
    });
  } else if (
    route.stops.every(
      s =>
        s.station.reliabilityPct >= 85 || s.station.successfulSessionsPct >= 85,
    )
  ) {
    good.push({text: 'Dependable chargers along the way', tone: 'good'});
  }

  return finish(level, good, watch);
}

function finish(
  level: Confidence,
  good: ConfidenceReason[],
  watch: ConfidenceReason[],
): RouteConfidence {
  // What needs attention leads when it isn't high; the reassurance leads when it is.
  const ordered = level === 'high' ? [...good, ...watch] : [...watch, ...good];
  return {
    level,
    label: LABEL[level],
    headline: HEADLINE[level],
    reasons: ordered.slice(0, 4),
  };
}
