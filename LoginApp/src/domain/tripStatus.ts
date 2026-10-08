import type {ActiveTrip} from './activeTrip';
import {batteryStatus} from './battery';
import {kmToDestination, kmToStop} from './tripEngine';
import type {BatteryReading, Vehicle} from './types';
import {formatDistanceRound} from './wording';

/**
 * The one calm sentence that answers "what do I need to know right now?".
 * Home, the trip screen and the notification copy all read it from here, so
 * they can never contradict each other. It also reassures: most of the time the
 * answer is "nothing, you're fine", and it says so.
 */

export type StatusTone = 'good' | 'watch' | 'warn' | 'critical';

export type StatusAction =
  | 'add_vehicle'
  | 'set_battery'
  | 'plan'
  | 'charge_nearby'
  | 'battery_critical'
  | 'open_trip';

export type DriverStatus = {
  tone: StatusTone;
  headline: string;
  detail: string;
  /** What the status card's button does, when it has one. */
  action: StatusAction | null;
};

const round5 = (km: number) => Math.max(5, Math.round(km / 5) * 5);

/** What PlugOrbit is doing for the trip right now, in a sentence. */
export function tripStatus(trip: ActiveTrip, remindKm: number): DriverStatus {
  const stop = trip.primaryStop;
  if (trip.pendingSwitch) {
    const p = trip.pendingSwitch;
    return {
      tone: 'warn',
      headline: 'We’ve found a better charging stop.',
      detail:
        p.aheadKm !== null
          ? `${p.toName} is ${formatDistanceRound(
              p.aheadKm,
            )} ahead on your route.`
          : `${p.toName} is a better option.`,
      action: 'open_trip',
    };
  }
  switch (trip.phase) {
    case 'at_charger':
      return {
        tone: 'good',
        headline: `You’re at ${stop?.stationName ?? 'the charger'}.`,
        detail: 'Scan the charger to start.',
        action: 'open_trip',
      };
    case 'charging':
      return {
        tone: 'good',
        headline: `Charging at ${stop?.stationName ?? 'the charger'}.`,
        detail: stop ? `Heading to ${stop.chargeToSoc}%.` : 'Almost there.',
        action: 'open_trip',
      };
    case 'arrived':
      return {
        tone: 'good',
        headline: `You’ve arrived in ${trip.destination}.`,
        detail: `About ${trip.currentSoc}% left.`,
        action: 'open_trip',
      };
    case 'ended':
      return {
        tone: 'good',
        headline: 'Trip finished.',
        detail: '',
        action: 'plan',
      };
    default:
      break;
  }
  if (!stop) {
    return {
      tone: 'good',
      headline: 'Your trip is on track.',
      detail: `No charging needed. You’ll arrive with about ${trip.expectedArrivalSoc}%.`,
      action: 'open_trip',
    };
  }
  const away = kmToStop(trip) ?? 0;
  if (away <= remindKm) {
    return {
      tone: 'watch',
      headline: `Charging stop in ${formatDistanceRound(away)}.`,
      detail: stop.backup
        ? `${stop.stationName}. Your backup is ready.`
        : `${stop.stationName}. No close backup, so we’re keeping watch.`,
      action: 'open_trip',
    };
  }
  return {
    tone: 'good',
    headline: 'You’re good for now.',
    detail: `No charging needed for ~${formatDistanceRound(
      round5(away),
    )}. We’ll tell you when it’s time to charge.`,
    action: 'open_trip',
  };
}

/** Home's top status: the trip if there is one, otherwise the battery. */
export function driverStatus(input: {
  vehicle: Vehicle | null;
  battery: BatteryReading | null;
  trip: ActiveTrip | null;
  reservePct: number;
  remindKm: number;
}): DriverStatus {
  const {vehicle, battery, trip, reservePct, remindKm} = input;
  if (!vehicle) {
    return {
      tone: 'watch',
      headline: 'Add your car to get started.',
      detail: 'We plan around your battery and the plugs your car can use.',
      action: 'add_vehicle',
    };
  }
  if (!battery) {
    return {
      tone: 'watch',
      headline: 'Tell us your battery level.',
      detail: 'Then we can say when and where you’ll need to charge.',
      action: 'set_battery',
    };
  }
  if (trip && trip.phase !== 'ended') {
    return tripStatus(trip, remindKm);
  }
  const b = batteryStatus(vehicle, battery.percent, reservePct);
  return {
    tone: b.tone,
    headline: b.headline,
    detail: b.detail,
    action:
      b.band === 'critical'
        ? 'battery_critical'
        : b.band === 'low'
        ? 'charge_nearby'
        : 'plan',
  };
}

/** "Km left" line for the trip hero. */
export function distanceLeftLabel(trip: ActiveTrip): string {
  return formatDistanceRound(kmToDestination(trip));
}
