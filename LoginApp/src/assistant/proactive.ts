import {computeSessionMetrics} from '../domain/charging';
import type {AppNotification} from '../domain/types';
import type {Store} from '../store/createStore';
import {AppState, appStore} from '../store/appStore';
import type {AssistantController} from './controller';
import {assistantStore, markProactive, patchJourney} from './store';
import type {FallbackLink} from './types';

/**
 * Orbit raises its own hand, sparingly.
 *
 * The WHAT and WHEN of a travel alert is decided by the Smart Drive engine
 * (src/intelligence): thresholds, reserve checks, stop proximity, charger
 * status, per-trip dedupe, Guided/Assist modes. Those alerts arrive in the app
 * store as notifications. This module only decides how Orbit relays them in
 * conversation, on top of the engine's own rules:
 *
 *  - only alerts that matter are spoken (action, important, critical); the
 *    rest stay quiet in the transcript;
 *  - the same alert is not repeated within a cooldown, even across restarts;
 *  - at most a few are spoken per hour, except critical ones;
 *  - nothing old is replayed when the app starts;
 *  - a conversation in progress is never talked over (the controller queues).
 *
 * The wording is the engine's, from verified numbers; no language model
 * rewrites a safety alert. A follow-up question ("what are my options?") is
 * answered by the model, which sees the alert in its context.
 */

export const COOLDOWN_MS = {
  info: 30 * 60_000,
  action: 10 * 60_000,
  important: 5 * 60_000,
  critical: 2 * 60_000,
} as const;
export const MAX_SPOKEN_PER_HOUR = 6;
/** An alert older than this when we first see it is not worth announcing. */
export const MAX_AGE_MS = 2 * 60_000;
const SPOKEN_LEVELS = new Set(['action', 'important', 'critical']);

export type Verdict = 'speak' | 'show' | 'skip';

/** Pure policy: what to do with one engine notification. */
export function judge(
  n: AppNotification,
  ctx: {seen: Record<string, number>; spokenAt: readonly number[]; now: number},
): {verdict: Verdict; key: string} {
  const level = n.level ?? 'info';
  const key = `${level}|${n.title}|${n.body}`;
  if (ctx.now - n.at > MAX_AGE_MS) {
    return {verdict: 'skip', key};
  }
  const last = ctx.seen[key];
  if (last !== undefined && ctx.now - last < COOLDOWN_MS[level]) {
    return {verdict: 'skip', key};
  }
  if (!SPOKEN_LEVELS.has(level)) {
    return {verdict: 'show', key};
  }
  const recent = ctx.spokenAt.filter(t => ctx.now - t < 3_600_000).length;
  if (level !== 'critical' && recent >= MAX_SPOKEN_PER_HOUR) {
    return {verdict: 'show', key};
  }
  return {verdict: 'speak', key};
}

const TRIP_LINKS: Record<string, FallbackLink> = {
  SmartDrive: {label: 'Open trip', icon: 'route', route: 'SmartDrive'},
  SmartDriveStop: {
    label: 'See the stop',
    icon: 'plug-zap',
    route: 'SmartDriveStop',
  },
};

export type ProactiveOptions = {
  app?: Store<AppState>;
  now?: () => number;
  /** The mock charging meter is an estimate; say so. */
  demo?: boolean;
  /** How often to look at a running charging session. */
  sessionPollMs?: number;
};

/** Start watching the app. Returns a function that stops it. */
export function startProactive(
  controller: AssistantController,
  options: ProactiveOptions = {},
): () => void {
  const app = options.app ?? appStore;
  const now = options.now ?? Date.now;
  const spokenAt: number[] = [];
  const handled = new Set(app.get().notifications.map(n => n.id));
  let prevTrip = app.get().smartDrive.trip;
  const announcedSessions = new Set<string>();

  const onNotifications = (list: AppNotification[]) => {
    // Oldest first, so the transcript reads in order.
    [...list].reverse().forEach(n => {
      if (handled.has(n.id) || n.source !== 'smart_drive') {
        return;
      }
      handled.add(n.id);
      const at = now();
      const {verdict, key} = judge(n, {
        seen: assistantStore.get().proactiveSeen,
        spokenAt,
        now: at,
      });
      if (verdict === 'skip') {
        return;
      }
      markProactive(key, at);
      const link = n.target ? TRIP_LINKS[n.target.route] : undefined;
      if (verdict === 'speak') {
        spokenAt.push(at);
      }
      controller.notice(`${n.title}. ${n.body}`.replace(/\.\.\s/, '. '), {
        level: n.level,
        kind: `smart_drive_${n.level ?? 'info'}`,
        speak: verdict === 'speak',
        fallbacks: link ? [link] : undefined,
      });
    });
  };

  const onTrip = (trip: AppState['smartDrive']['trip']) => {
    if (trip === prevTrip) {
      return;
    }
    const before = prevTrip;
    prevTrip = trip;
    if (!trip || before?.tripId === trip.tripId) {
      return;
    }
    // A journey the driver started becomes what the assistant remembers.
    patchJourney(
      {destination: trip.destination.label, origin: trip.origin.label},
      now(),
    );
    const replaced = before && before.monitoringState !== 'ended';
    if (replaced && before.destination.label !== trip.destination.label) {
      const stop = trip.primaryStop?.station.name;
      const plan =
        trip.chargingRequired && stop
          ? `You'll need to charge at ${stop}.`
          : `No charging stop is needed at your current battery.`;
      controller.notice(
        `Destination changed to ${trip.destination.label}. ${plan}`,
        {
          level: 'info',
          kind: 'destination_changed',
          speak: assistantStore.get().settings.drivingMode,
        },
      );
    }
  };

  const onSession = () => {
    const s = app.get().session;
    if (!s || s.status !== 'active' || announcedSessions.has(s.id)) {
      return;
    }
    if (computeSessionMetrics(s, now()).reachedTarget) {
      announcedSessions.add(s.id);
      const how =
        options.demo ?? true ? ', according to the app’s estimated meter' : '';
      controller.notice(
        `Charging has reached your ${s.targetSoc} percent target${how}.`,
        {
          level: 'action',
          kind: 'charging_complete',
          speak: true,
          fallbacks: [
            {label: 'Open session', icon: 'zap', route: 'SmartDrive'},
          ],
        },
      );
    }
  };

  let lastNotifications = app.get().notifications;
  let lastSession = app.get().session;
  const unsubscribe = app.subscribe(() => {
    const s = app.get();
    if (s.notifications !== lastNotifications) {
      lastNotifications = s.notifications;
      onNotifications(s.notifications);
    }
    onTrip(s.smartDrive.trip);
    if (s.session !== lastSession) {
      lastSession = s.session;
      onSession();
    }
  });
  // A running session reaches its target with the clock, not with a store change.
  const timer = setInterval(onSession, options.sessionPollMs ?? 15_000);

  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
