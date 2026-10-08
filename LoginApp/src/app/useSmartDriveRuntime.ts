import {useCallback, useEffect, useRef} from 'react';
import {sessionEvents} from '../intelligence/sessionBridge';
import {useServices} from '../services';
import {appStore, useApp} from '../store/appStore';
import {showToast} from '../ui';

/** How often the co-pilot reassesses a trip that is under way. */
const TICK_MS = 10_000;

/**
 * Keeps Smart Drive alive for as long as a trip is: reassesses on a timer,
 * feeds it what happens in the charging flow, and surfaces the few messages that
 * deserve to interrupt.
 *
 * TODO(integration): on a real build this loop lives on the SERVER. The phone
 * sends location and battery and receives push notifications, so monitoring
 * carries on when the app is closed or the phone is asleep.
 */
export function useSmartDriveRuntime(): void {
  const {smartDrive} = useServices();
  const watching = useApp(s => {
    const t = s.smartDrive.trip;
    return t !== null && t.monitoringState !== 'ended' && t.phase !== 'ready';
  });
  const sessionKey = useApp(s =>
    s.session ? `${s.session.id}:${s.session.status}` : 'none',
  );
  const busy = useRef(false);

  const step = useCallback(async () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      const {smartDrive: sd, session} = appStore.get();
      // What the charging flow did since we last looked, then a fresh look.
      for (const event of sessionEvents(sd.trip, session, Date.now())) {
        await smartDrive.report(event);
      }
      await smartDrive.tick();
    } catch {
      // A background check must never take the app down; the next one retries.
    } finally {
      busy.current = false;
    }
  }, [smartDrive]);

  useEffect(() => {
    if (!watching) {
      return;
    }
    step();
    const id = setInterval(step, TICK_MS);
    return () => clearInterval(id);
  }, [watching, step]);

  // Charging started, stopped or failed: react now, not at the next tick.
  useEffect(() => {
    if (watching) {
      step();
    }
  }, [sessionKey, watching, step]);

  // Only plan changes and safety alerts get a banner; the rest wait in the bell.
  const notifications = useApp(s => s.notifications);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(notifications.map(n => n.id));
      return;
    }
    notifications.forEach(n => {
      if (seen.current?.has(n.id)) {
        return;
      }
      seen.current?.add(n.id);
      if (
        n.source === 'smart_drive' &&
        (n.level === 'important' || n.level === 'critical')
      ) {
        showToast(n.title, n.level === 'critical' ? 'warn' : 'info', 5000);
      }
    });
  }, [notifications]);
}
