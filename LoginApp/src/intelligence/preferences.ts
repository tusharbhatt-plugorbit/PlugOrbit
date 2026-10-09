import type {TripPreferences} from '../domain/types';
import {rangeMid} from './stopMetrics';
import type {
  ChoiceLean,
  ChoiceSignal,
  PreferenceProfile,
  ScoredStop,
} from './types';

/**
 * DriverPreferenceModel.
 *
 * Watches which charger the driver chooses versus which we recommended, and
 * notices a pattern. It NEVER changes anything on its own: it can only propose
 * a change to the preferences the driver can already see and edit (Trip
 * preferences), and the proposal waits for a tap. Learning is a suggestion, not
 * a silent override, and it never touches the safety rules.
 */

const MIN_SIGNALS = 4;
const MIN_COUNT = 3;
const MIN_SHARE = 0.7;
const WINDOW = 12;

/** What choosing `chosen` over `recommended` says about this driver. */
export function leansOf(
  chosen: ScoredStop,
  recommended: ScoredStop,
): ChoiceLean[] {
  const leans: ChoiceLean[] = [];
  const quicker =
    rangeMid(chosen.metrics.totalStopMin) <=
      rangeMid(recommended.metrics.totalStopMin) - 4 ||
    chosen.metrics.expectedKw >= recommended.metrics.expectedKw + 8;
  if (quicker) {
    leans.push('faster');
  }
  const a = chosen.metrics.cost.totalInr;
  const b = recommended.metrics.cost.totalInr;
  if (a !== null && b !== null && a <= b - 25) {
    leans.push('cheaper');
  }
  if (
    chosen.components.reliability >=
    recommended.components.reliability + 0.05
  ) {
    leans.push('reliable');
  }
  if (
    chosen.station.amenities.length >=
    recommended.station.amenities.length + 2
  ) {
    leans.push('amenities');
  }
  return leans;
}

export type PreferenceSuggestion = {
  /** Stable id, so a dismissed suggestion stays dismissed. */
  id: ChoiceLean;
  title: string;
  detail: string;
  evidence: {count: number; total: number};
  /** What accepting it changes in Trip preferences. */
  apply: Partial<TripPreferences>;
};

const COPY: Record<
  ChoiceLean,
  {
    title: string;
    detail: (n: number, t: number) => string;
    apply: Partial<TripPreferences>;
  }
> = {
  faster: {
    title: 'You usually pick faster chargers',
    detail: (n, t) =>
      `In ${n} of your last ${t} choices you took the quicker stop. Make “Fastest” your default?`,
    apply: {strategy: 'fastest'},
  },
  cheaper: {
    title: 'You usually pick the cheaper charger',
    detail: (n, t) =>
      `In ${n} of your last ${t} choices you took the lower price. Make “Cheapest” your default?`,
    apply: {strategy: 'cheapest'},
  },
  reliable: {
    title: 'You usually pick the most reliable charger',
    detail: (n, t) =>
      `In ${n} of your last ${t} choices you took the surest option. Make “Reliable” your default?`,
    apply: {strategy: 'reliable'},
  },
  amenities: {
    title: 'You like stops with food and washrooms',
    detail: (n, t) =>
      `In ${n} of your last ${t} choices you picked the stop with more around it. Prefer these stops from now on?`,
    apply: {preferAmenities: true},
  },
};

/** Suggestions the evidence supports and the driver has not already adopted. */
export function suggestionsFrom(
  signals: readonly ChoiceSignal[],
  current: TripPreferences,
  dismissed: readonly string[],
): PreferenceSuggestion[] {
  const recent = signals.slice(-WINDOW);
  if (recent.length < MIN_SIGNALS) {
    return [];
  }
  const out: PreferenceSuggestion[] = [];
  (Object.keys(COPY) as ChoiceLean[]).forEach(lean => {
    const count = recent.filter(s => s.leans.includes(lean)).length;
    if (count < MIN_COUNT || count / recent.length < MIN_SHARE) {
      return;
    }
    if (dismissed.includes(lean)) {
      return;
    }
    const {apply} = COPY[lean];
    const already =
      (apply.strategy !== undefined && apply.strategy === current.strategy) ||
      (apply.preferAmenities === true && current.preferAmenities);
    if (already) {
      return;
    }
    out.push({
      id: lean,
      title: COPY[lean].title,
      detail: COPY[lean].detail(count, recent.length),
      evidence: {count, total: recent.length},
      apply,
    });
  });
  return out.sort((a, b) => b.evidence.count - a.evidence.count);
}

/**
 * The profile the planner uses, from preferences the driver set. The trip
 * strategy picks the main tilt; "prefer amenities" is a separate comfort boost.
 */
export function profileFromPrefs(prefs: TripPreferences): PreferenceProfile {
  switch (prefs.strategy) {
    case 'fastest':
      return 'fastest';
    case 'cheapest':
      return 'cheapest';
    default:
      return 'balanced';
  }
}
