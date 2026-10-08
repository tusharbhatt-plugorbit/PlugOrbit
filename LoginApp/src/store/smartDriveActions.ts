import type {
  ActiveTrip,
  ChoiceSignal,
  SmartDrivePrefs,
  TripOutcome,
} from '../intelligence/types';
import {appStore} from './appStore';

const MAX_OUTCOMES = 30;
const MAX_SIGNALS = 20;

/** Replace the trip being watched (or clear it). */
export function setTrip(trip: ActiveTrip | null): void {
  appStore.set(s => ({smartDrive: {...s.smartDrive, trip}}));
}

/** Keep the record of how a finished trip compared with the prediction. */
export function saveOutcome(outcome: TripOutcome): void {
  appStore.set(s => ({
    smartDrive: {
      ...s.smartDrive,
      outcomes: [outcome, ...s.smartDrive.outcomes].slice(0, MAX_OUTCOMES),
    },
  }));
}

/** What the driver's pick said about them. Feeds suggestions, never decisions. */
export function recordChoice(signal: ChoiceSignal): void {
  appStore.set(s => ({
    smartDrive: {
      ...s.smartDrive,
      signals: [...s.smartDrive.signals, signal].slice(-MAX_SIGNALS),
    },
  }));
}

export function dismissSuggestion(id: string): void {
  appStore.set(s => ({
    smartDrive: {
      ...s.smartDrive,
      dismissed: s.smartDrive.dismissed.includes(id)
        ? s.smartDrive.dismissed
        : [...s.smartDrive.dismissed, id],
    },
  }));
}

export function setSmartDrivePrefs(patch: Partial<SmartDrivePrefs>): void {
  appStore.set(s => ({
    smartDrive: {
      ...s.smartDrive,
      prefs: {...s.smartDrive.prefs, ...patch},
    },
  }));
}
