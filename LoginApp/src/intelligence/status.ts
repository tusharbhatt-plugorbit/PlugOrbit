import {usableRangeKm} from '../domain/socEstimate';
import type {Vehicle} from '../domain/types';
import {PHRASES, kmLabel} from './copy';
import type {ActiveTrip} from './types';

export type StatusTone = 'good' | 'watch' | 'alert';

/** The one-line reassurance the driver sees first. */
export type CopilotStatus = {
  tone: StatusTone;
  headline: string;
  detail: string;
};

/**
 * The status line for a trip in progress. The point of this screen is to take
 * anxiety away, so the default answer is "no action needed" and it only turns
 * amber or red when something truly needs the driver.
 */
export function tripStatus(trip: ActiveTrip): CopilotStatus {
  const plan = trip.plan;
  const primary = plan.primary;

  if (trip.phase === 'arrived') {
    return {
      tone: 'good',
      headline: 'You’ve arrived.',
      detail: `${trip.destination.label} reached.`,
    };
  }
  if (plan.mode === 'battery_critical') {
    return {
      tone: 'alert',
      headline: 'Battery is getting low.',
      detail: primary
        ? `We’ve prioritised the safest reachable charger, ${kmLabel(
            primary.metrics.distanceFromDriverKm,
          )} away.`
        : 'We’re looking for the nearest charger you can reach.',
    };
  }
  if (plan.readiness === 'charge_first') {
    return {
      tone: 'alert',
      headline: 'Charge before you set off.',
      detail: 'Your battery won’t reach a charger on this route yet.',
    };
  }
  if (plan.readiness === 'limited_options') {
    return {
      tone: 'alert',
      headline: 'Reliable charging options are limited here.',
      detail: primary
        ? `The safest option is ${kmLabel(
            primary.metrics.distanceFromDriverKm,
          )} ahead.`
        : 'We’re looking for a charger you can reach.',
    };
  }
  if (trip.network === 'offline') {
    return {
      tone: 'watch',
      headline: 'You’re offline.',
      detail: 'Your charging plan is still available.',
    };
  }
  switch (trip.phase) {
    case 'ready':
      return {
        tone: 'good',
        headline: PHRASES.goodToDrive,
        detail: plan.chargingRequired
          ? 'No charging needed right now. We’ll tell you before you need to stop.'
          : 'Your battery covers the whole trip.',
      };
    case 'charging':
      return {
        tone: 'good',
        headline: 'Charging.',
        detail: 'We’ll tell you the moment you have enough to carry on.',
      };
    case 'continuing':
      return {
        tone: 'good',
        headline: PHRASES.readyToGo,
        detail: 'Drive safe. We’ll keep watching the road ahead.',
      };
    case 'at_stop':
      return {
        tone: 'watch',
        headline: 'You’ve reached your stop.',
        detail: primary
          ? `${primary.station.name}. Head to ${primary.metrics.connectorLabel} to start.`
          : 'Pick a connector to start.',
      };
    case 'approaching_stop':
      return {
        tone: 'watch',
        headline: primary
          ? `Charging stop coming up in ${kmLabel(
              primary.metrics.distanceFromDriverKm,
            )}.`
          : 'Charging stop coming up.',
        detail: plan.backup
          ? PHRASES.backupReady
          : 'No backup nearby, so we’re watching it closely.',
      };
    default:
      break;
  }
  if (plan.chargingRequired && primary) {
    return plan.backup
      ? {
          tone: 'good',
          headline: PHRASES.onTrack,
          detail: `Next stop: ${primary.station.name}, ${kmLabel(
            primary.metrics.distanceFromDriverKm,
          )} ahead. ${PHRASES.backupReady}`,
        }
      : {
          tone: 'watch',
          headline: PHRASES.onTrack,
          detail: `Next stop: ${primary.station.name}. No backup nearby, so we’re watching it closely.`,
        };
  }
  return {
    tone: 'good',
    headline: PHRASES.onTrack,
    detail: PHRASES.noActionNeeded,
  };
}

/** Home's status with no trip: derived from the battery alone. */
export function idleStatus(args: {
  soc: number | null;
  vehicle: Vehicle | null;
  reservePct: number;
  criticalPct: number;
}): CopilotStatus {
  const {soc, vehicle} = args;
  if (!vehicle) {
    return {
      tone: 'watch',
      headline: 'Add your car to get started.',
      detail: 'We plan every charge around your battery and connectors.',
    };
  }
  if (soc === null) {
    return {
      tone: 'watch',
      headline: 'Set your battery to get started.',
      detail: 'Then tell us where you’re going and we’ll take it from there.',
    };
  }
  if (soc <= args.criticalPct) {
    return {
      tone: 'alert',
      headline: 'Battery is getting low.',
      detail: 'Tap to find the safest charger you can reach.',
    };
  }
  return {
    tone: 'good',
    headline: PHRASES.goodToDrive,
    detail: `About ${usableRangeKm(
      vehicle,
      soc,
      args.reservePct,
    )} km before your ${args.reservePct}% reserve.`,
  };
}
