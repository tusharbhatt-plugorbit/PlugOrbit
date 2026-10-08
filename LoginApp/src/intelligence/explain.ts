import {formatInr} from '../utils/format';
import {DEFAULT_SMART_DRIVE_CONFIG, SmartDriveConfig} from './config';
import {PHRASES, kmLabel, topReasons} from './copy';
import {tripImpactMid} from './recommendation';
import type {ActiveTrip, ReasonCode, ScoredStop} from './types';

/**
 * Layer 5: the conversation layer EXPLAINS decisions; it never makes them.
 *
 * Every answer is built from the numbers the deterministic engines already
 * produced (the plan's scored options), so it cannot contradict the safety
 * rules or invent a charger. Phase 1 uses templates. A language model can later
 * rephrase these same facts, but the facts and the safe set stay here.
 */

export type QuestionId =
  | 'why_here'
  | 'skip'
  | 'cheaper'
  | 'faster'
  | 'backup'
  | 'battery';

export const QUESTIONS: ReadonlyArray<{id: QuestionId; label: string}> = [
  {id: 'why_here', label: 'Why are we stopping here?'},
  {id: 'skip', label: 'Can I skip this charger?'},
  {id: 'cheaper', label: 'Find me something cheaper'},
  {id: 'faster', label: 'Is there a faster option?'},
  {id: 'backup', label: 'What if it doesn’t work?'},
  {id: 'battery', label: 'How much battery will I have?'},
];

export type CopilotAnswer = {
  question: QuestionId;
  text: string;
  reasons: ReasonCode[];
  /** A single decision the driver can take from the answer. */
  action: {kind: 'switch'; stationId: string; label: string} | null;
};

function join(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function safeSet(trip: ActiveTrip): ScoredStop[] {
  const {plan} = trip;
  return [plan.primary, plan.backup, ...plan.alternatives].filter(
    (s): s is ScoredStop => s !== null,
  );
}

const noStop = (q: QuestionId): CopilotAnswer => ({
  question: q,
  text: trip_covered(),
  reasons: [],
  action: null,
});

function trip_covered(): string {
  return `No charging stop is planned: your battery covers the trip. ${PHRASES.noActionNeeded}`;
}

export function answerQuestion(
  trip: ActiveTrip,
  question: QuestionId,
  config: SmartDriveConfig = DEFAULT_SMART_DRIVE_CONFIG,
): CopilotAnswer {
  const primary = trip.plan.primary;
  if (!primary || !trip.plan.chargingRequired) {
    if (question === 'battery') {
      return {
        question,
        text: `You’ll arrive with about ${Math.round(
          trip.plan.destination.socWithoutCharging.expected,
        )}%, above your ${trip.reservePct}% reserve. No stop needed.`,
        reasons: [],
        action: null,
      };
    }
    return noStop(question);
  }
  const impact = (s: ScoredStop) => tripImpactMid(s, config);
  const others = safeSet(trip).filter(s => s.station.id !== primary.station.id);

  switch (question) {
    case 'why_here': {
      const field = safeSet(trip);
      const closest = field.reduce((a, b) =>
        b.metrics.distanceFromDriverKm < a.metrics.distanceFromDriverKm ? b : a,
      );
      if (closest.station.id === primary.station.id) {
        return {
          question,
          text: `${
            primary.station.name
          } is the closest reliable charger on your route. ${join(
            topReasons(primary.reasons, 3),
          )}.`,
          reasons: primary.reasons,
          action: null,
        };
      }
      const phrases: string[] = [];
      if (
        primary.dataConfidence === 'live' &&
        primary.components.availability > closest.components.availability + 0.1
      ) {
        phrases.push('better live availability');
      }
      if (
        primary.components.reliability >
        closest.components.reliability + 0.03
      ) {
        phrases.push('a stronger recent reliability record');
      }
      if (primary.continuation.stopsAfter < closest.continuation.stopsAfter) {
        phrases.push('lets you finish with fewer stops');
      }
      if (primary.metrics.expectedKw > closest.metrics.expectedKw + 5) {
        phrases.push('charges your car faster');
      }
      if (phrases.length === 0) {
        phrases.push('a better overall mix of speed, reliability and cost');
      }
      const saved = impact(closest) - impact(primary);
      return {
        question,
        text: `This station is slightly farther than the closest option, but it has ${join(
          phrases,
        )}.${
          saved >= 3
            ? ` It should get you back on the road about ${Math.round(
                saved,
              )} minutes sooner.`
            : ''
        }`,
        reasons: primary.reasons,
        action: null,
      };
    }

    case 'skip': {
      const next = others
        .filter(s => s.alongKm > primary.alongKm + 1)
        .sort((a, b) => a.alongKm - b.alongKm)[0];
      if (!next) {
        return {
          question,
          text: 'Skipping isn’t a good idea: there’s no other charger you could safely reach after this one. I recommend keeping this stop.',
          reasons: [],
          action: null,
        };
      }
      const arrive = Math.round(next.metrics.arriveSoc.expected);
      return {
        question,
        text:
          arrive < trip.reservePct + 8
            ? `You can, but the next reliable option would put you at an estimated ${arrive}% battery on arrival. I recommend keeping this stop.`
            : `You can skip it. ${next.station.name} would be your next stop and you’d arrive with about ${arrive}%.`,
        reasons: [],
        action: null,
      };
    }

    case 'cheaper': {
      const mine = primary.metrics.cost.totalInr;
      if (mine === null) {
        return {
          question,
          text: 'This charger hasn’t published a price, so I can’t tell you whether another would be cheaper.',
          reasons: [],
          action: null,
        };
      }
      const cheaper = others
        .filter(s => s.metrics.cost.totalInr !== null)
        .sort(
          (a, b) =>
            (a.metrics.cost.totalInr as number) -
            (b.metrics.cost.totalInr as number),
        )[0];
      const save = cheaper
        ? mine - (cheaper.metrics.cost.totalInr as number)
        : 0;
      if (!cheaper || save < 20) {
        return {
          question,
          text: 'This is already the lowest-cost reliable option on your route.',
          reasons: [],
          action: null,
        };
      }
      const extra = Math.round(impact(cheaper) - impact(primary));
      return {
        question,
        text: `I found an option ${formatInr(save)} cheaper, ${
          extra >= 3
            ? `but it adds around ${extra} minutes to your trip`
            : 'and it takes about the same time'
        }. Want me to switch?`,
        reasons: [],
        action: {
          kind: 'switch',
          stationId: cheaper.station.id,
          label: `Switch to ${cheaper.station.name}`,
        },
      };
    }

    case 'faster': {
      const quickest = [...others].sort((a, b) => impact(a) - impact(b))[0];
      const gain = quickest
        ? Math.round(impact(primary) - impact(quickest))
        : 0;
      if (!quickest || gain < 3) {
        return {
          question,
          text: 'No other reliable option gets you moving sooner.',
          reasons: [],
          action: null,
        };
      }
      const dearer =
        quickest.metrics.cost.totalInr !== null &&
        primary.metrics.cost.totalInr !== null
          ? quickest.metrics.cost.totalInr - primary.metrics.cost.totalInr
          : 0;
      return {
        question,
        text: `${
          quickest.station.name
        } could get you moving about ${gain} minutes sooner${
          dearer >= 20 ? `, for about ${formatInr(dearer)} more` : ''
        }. Want me to switch?`,
        reasons: [],
        action: {
          kind: 'switch',
          stationId: quickest.station.id,
          label: `Switch to ${quickest.station.name}`,
        },
      };
    }

    case 'backup': {
      const b = trip.plan.backup;
      if (!b) {
        return {
          question,
          text: 'I couldn’t find a safe backup for this stop, so I’m watching it more closely and will tell you the moment that changes.',
          reasons: [],
          action: null,
        };
      }
      return {
        question,
        text: `${b.station.name} is your backup, ${
          b.extraMin <= 2 ? 'about the same time' : `${b.extraMin} minutes more`
        }. From ${primary.station.name} you’d reach it with about ${Math.round(
          b.fromPrimarySoc.expected,
        )}% battery, ${kmLabel(b.metrics.distanceFromDriverKm)} from you now.${
          b.independent
            ? ''
            : ' It shares a site or operator with your main stop.'
        }`,
        reasons: b.reasons,
        action: null,
      };
    }

    default: {
      const m = primary.metrics;
      return {
        question,
        text: `You’ll reach ${primary.station.name} with about ${Math.round(
          m.arriveSoc.expected,
        )}%. I recommend charging to ${m.targetSoc}%: ${
          m.targetReason === 'finish_trip'
            ? `enough to finish with ${trip.reservePct}% to spare`
            : m.targetReason === 'reach_next_stop'
            ? 'enough to reach your next stop comfortably'
            : 'as much as is sensible here, since the options beyond it are limited'
        }${
          m.savedVsCapMin
            ? `, which saves about ${m.savedVsCapMin} min compared with charging to ${config.maxChargeToPct}%`
            : ''
        }.`,
        reasons: [],
        action: null,
      };
    }
  }
}
