import {useEffect} from 'react';
import {AppState as RNAppState} from 'react-native';
import type {CoDriverEvent} from '../domain/coDriver';
import {useServices} from '../services';
import {appStore, useApp} from '../store/appStore';
import {useDemo} from '../store/demoStore';
import {onTripToast} from '../store/tripEvents';
import {showToast} from '../ui';

/** How often the planned charger and its backup are looked at again. */
export const WATCH_INTERVAL_MS = 8_000;
/** The simulated drive: km added per tick, and how often. */
export const AUTO_DRIVE_KM = 1.5;
export const AUTO_DRIVE_TICK_MS = 1_000;

const TONE: Record<CoDriverEvent['level'], 'info' | 'warn' | 'danger'> = {
  informational: 'info',
  action: 'info',
  important: 'warn',
  critical: 'danger',
};

/**
 * The co-driver's heartbeat. It renders nothing; while a trip is running and
 * the app is in the foreground it
 *  - keeps watching the planned charger and its backup (Smart Drive),
 *  - drives the simulated GPS when "auto-drive" is on (a real feed calls the same
 *    `trip.advance`), and
 *  - turns the events that deserve a word into a brief message.
 * Real background delivery (push while the app is closed) needs a notification
 * service and is listed as pending in the docs.
 */
export function TripMonitorHost(): null {
  const {trip: tripService} = useServices();
  const running = useApp(
    s =>
      s.activeTrip !== null &&
      (s.activeTrip.phase === 'driving' || s.activeTrip.phase === 'at_charger'),
  );
  const autoDrive = useDemo(s => s.autoDrive);

  useEffect(
    () =>
      onTripToast(e => {
        showToast(
          `${e.title} ${e.body}`,
          TONE[e.level],
          e.level === 'critical' ? 7000 : 5000,
        );
      }),
    [],
  );

  useEffect(() => {
    if (!running) {
      return;
    }
    let foreground = RNAppState.currentState !== 'background';
    const sub = RNAppState.addEventListener('change', next => {
      foreground = next === 'active';
    });
    const watch = setInterval(() => {
      if (foreground) {
        tripService.refresh().catch(() => undefined);
      }
    }, WATCH_INTERVAL_MS);
    return () => {
      clearInterval(watch);
      sub.remove();
    };
  }, [running, tripService]);

  useEffect(() => {
    if (!running || !autoDrive) {
      return;
    }
    const drive = setInterval(() => {
      const trip = appStore.get().activeTrip;
      if (trip) {
        tripService.advance(trip.km + AUTO_DRIVE_KM).catch(() => undefined);
      }
    }, AUTO_DRIVE_TICK_MS);
    return () => clearInterval(drive);
  }, [running, autoDrive, tripService]);

  return null;
}
