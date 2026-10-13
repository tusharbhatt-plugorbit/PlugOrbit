import {waitLabel} from '../domain/rules';
import {timeAgo} from '../domain/trust';
import type {SmartDriveConfig} from './config';
import {PHRASES, kmLabel, minutesLabel, pctLabel} from './copy';
import {mayClaimLive} from './safety';
import type {
  ActiveTrip,
  Decision,
  NotificationAction,
  NotificationDraft,
  NotificationKind,
  NotificationLevel,
  ScoredStop,
  TripEvent,
} from './types';

/**
 * ProactiveNotificationService.
 *
 * The engines calculate all the time; the driver should hear about almost none
 * of it. For every change the monitor notices, this asks one question:
 *
 *     does this change what the driver should DO?
 *       no  -> stay silent (and write down that we chose to)
 *       yes -> how urgent? -> one calm message
 *
 * Levels: INFO (nothing to do), ACTION (something is coming up), IMPORTANT
 * (the plan changed), CRITICAL (safety; rare, and capped per trip).
 */

const LEVEL_RANK: Record<NotificationLevel, number> = {
  info: 0,
  action: 1,
  important: 2,
  critical: 3,
};

/** A passed-over improvement smaller than this is not even worth noting. */
const HELD_WORTH_MENTIONING_MIN = 3;

/** At most this many critical alerts per trip: they must stay rare. */
export const MAX_CRITICAL_PER_TRIP = 3;

export type NotifyInput = {
  prev: ActiveTrip;
  next: ActiveTrip;
  event: TripEvent;
  config: SmartDriveConfig;
  /** "Quiet" verbosity: only IMPORTANT and CRITICAL get through. */
  quiet: boolean;
  now: number;
};

type Candidate = {
  draft: NotificationDraft;
  /** Higher wins between candidates of the same level. */
  priority: number;
  /** null = once per trip and station; otherwise minutes before repeating. */
  cooldownMin: number | null;
  noticed: string;
};

const cta = (
  label: string,
  action: NotificationAction,
): NotificationDraft['cta'] => ({label, action});

function connectorStatus(stop: ScoredStop) {
  return stop.station.connectors.find(c => c.id === stop.metrics.connectorId)
    ?.status;
}

/**
 * What we may truthfully say about the bay we picked. "Currently available" is
 * only ever said on a fresh operator feed; anything older says how old it is.
 */
/** Whether a message whose key starts with `prefix` went out in the last minutes. */
function toldRecently(
  trip: ActiveTrip,
  prefix: string,
  now: number,
  withinMin = 15,
): boolean {
  return Object.entries(trip.notified).some(
    ([key, at]) => key.startsWith(prefix) && now - at < withinMin * 60000,
  );
}

export function availabilityLine(stop: ScoredStop, now: number): string {
  const status = connectorStatus(stop);
  const age = timeAgo(stop.station.statusFeed.updatedAt, now);
  if (status === 'available') {
    // Judged from the feed and the clock, not from a label cached when the plan
    // was made: a reading that has gone stale must stop saying "currently".
    return mayClaimLive(stop.station, now)
      ? 'Your selected connector is currently available.'
      : `Your selected connector was last reported free ${age}. We’ll check again as you arrive.`;
  }
  if (status === 'occupied') {
    return `It’s busy right now. Expected wait ${waitLabel(
      stop.metrics.wait,
    )}.`;
  }
  if (status === 'offline') {
    return 'It’s reported offline, so we’re checking your backup.';
  }
  return 'We can’t see its status, so we’ll check again when you arrive.';
}

function draft(
  kind: NotificationKind,
  level: NotificationLevel,
  title: string,
  body: string,
  action: NotificationDraft['cta'],
  key: string,
  stationId: string | null,
  at: number,
): NotificationDraft {
  return {
    kind,
    level,
    title,
    body,
    cta: action,
    dedupeKey: key,
    stationId,
    at,
  };
}

/** How long ago the freshest status we hold for the plan was updated. */
function lastStatusAge(trip: ActiveTrip, now: number): string {
  const stamps = [trip.plan.primary, trip.plan.backup]
    .map(s => s?.station.statusFeed.updatedAt ?? null)
    .filter((t): t is number => t !== null);
  return timeAgo(stamps.length ? Math.max(...stamps) : trip.lastOnlineAt, now);
}

export function decideNotifications(input: NotifyInput): Decision[] {
  const {prev, next, event, config, now} = input;
  if (!next.smartDriveEnabled) {
    return [];
  }
  const candidates: Candidate[] = [];
  const silent: Decision[] = [];
  const say = (c: Candidate) => candidates.push(c);
  const stayQuiet = (noticed: string, why: string) =>
    silent.push({at: now, noticed, notify: false, why, draft: null});

  const plan = next.plan;
  const primary = plan.primary;
  const prevPrimary = prev.plan.primary;
  const tripKey = next.tripId;

  // ------------------------------------------------------ trip start / ready
  if (event.type === 'TRIP_STARTED') {
    if (plan.readiness === 'charge_first') {
      say({
        draft: draft(
          'ready_to_drive',
          'action',
          'Charge before you set off',
          'Your battery won’t reach a charger on this route yet. We’ll point you to the nearest one.',
          cta('Charge nearby', 'charge_nearby'),
          `ready:${tripKey}`,
          null,
          now,
        ),
        priority: 5,
        cooldownMin: null,
        noticed: 'The battery cannot reach a charger on this route',
      });
    } else if (plan.readiness === 'limited_options') {
      say({
        draft: draft(
          'limited_options',
          'important',
          'Reliable charging options are limited here.',
          'We’ll keep watching and tell you the moment there is a safer choice.',
          cta('See plan', 'open_trip'),
          `ready:${tripKey}`,
          null,
          now,
        ),
        priority: 5,
        cooldownMin: null,
        noticed: 'Few safe chargers on this route',
      });
    } else {
      say({
        draft: draft(
          'ready_to_drive',
          'info',
          PHRASES.goodToDrive,
          plan.chargingRequired
            ? 'No charging needed right now. We’ll tell you before you need to stop.'
            : 'Your battery covers the whole trip. No action needed.',
          cta('View trip', 'open_trip'),
          `ready:${tripKey}`,
          null,
          now,
        ),
        priority: 1,
        cooldownMin: null,
        noticed: 'Trip started and the plan is sound',
      });
    }
  }

  // ---------------------------------------------------------- battery & safety
  const enteredCritical =
    plan.mode === 'battery_critical' &&
    (prev.plan.mode !== 'battery_critical' || event.type === 'TRIP_STARTED');
  if (enteredCritical) {
    const lowBattery = plan.modeReason === 'low_battery';
    say({
      draft: draft(
        lowBattery ? 'battery_critical' : 'limited_options',
        'critical',
        lowBattery
          ? 'Battery is getting low.'
          : 'Reliable charging options are limited here.',
        primary
          ? lowBattery
            ? `We’ve prioritised the safest reachable charger, ${kmLabel(
                primary.metrics.distanceFromDriverKm,
              )} away.`
            : `The safest option is ${kmLabel(
                primary.metrics.distanceFromDriverKm,
              )} ahead.`
          : 'We’re looking for the nearest charger you can reach.',
        cta('See charger', 'open_trip'),
        `critical:${tripKey}:${plan.modeReason ?? 'mode'}`,
        primary?.station.id ?? null,
        now,
      ),
      priority: 10,
      cooldownMin: config.cooldownMin.critical,
      noticed: lowBattery
        ? 'Battery crossed the critical level'
        : 'No charger can be reached while keeping the reserve',
    });
  } else if (
    plan.limitedOptions &&
    !prev.plan.limitedOptions &&
    plan.chargingRequired &&
    plan.mode === 'normal' &&
    event.type !== 'TRIP_STARTED' &&
    // Once the driver is at the stop there is nothing to do about it, and a
    // plan change carries its own message.
    (next.phase === 'driving' || next.phase === 'approaching_stop') &&
    !plan.switched &&
    // A plan-change message just went out and already says where to go.
    !toldRecently(next, 'switch:', now)
  ) {
    say({
      draft: draft(
        'limited_options',
        'important',
        'Reliable charging options are limited here.',
        primary
          ? `The safest option is ${kmLabel(
              primary.metrics.distanceFromDriverKm,
            )} ahead.`
          : 'We’re looking for a charger you can reach.',
        cta('See plan', 'open_trip'),
        `limited:${tripKey}`,
        primary?.station.id ?? null,
        now,
      ),
      priority: 6,
      cooldownMin: config.cooldownMin.limited,
      noticed: 'The options ahead narrowed',
    });
  }

  // ----------------------------------------------------------- plan changed
  if (plan.switched && prevPrimary && primary) {
    const info = plan.switched;
    if (info.reason === 'safety') {
      const wasOffline = plan.ruledOut.some(
        r => r.stationId === info.from && r.codes.includes('CHARGER_OFFLINE'),
      );
      say({
        draft: draft(
          'charger_unavailable',
          'important',
          'We’ve changed your charging stop.',
          wasOffline
            ? `${
                prevPrimary.station.name
              } is offline right now. Your new stop is ${
                primary.station.name
              }, ${kmLabel(primary.metrics.distanceFromDriverKm)} ahead.`
            : `We couldn’t confirm ${
                prevPrimary.station.name
              }, so we’ve prepared another option: ${
                primary.station.name
              }, ${kmLabel(primary.metrics.distanceFromDriverKm)} ahead.`,
          cta('Switch route', 'switch_route'),
          `switch:${primary.station.id}`,
          primary.station.id,
          now,
        ),
        priority: 9,
        cooldownMin: null,
        noticed: `${prevPrimary.station.name} is no longer a safe choice`,
      });
    } else {
      say({
        draft: draft(
          'better_charger',
          'important',
          'We’ve found a better charging stop.',
          `Your original charger may still be busy when you arrive. ${
            primary.station.name
          } is ${kmLabel(
            primary.metrics.distanceFromDriverKm,
          )} ahead on your route${
            info.minutesSaved > 0
              ? `, and should save about ${info.minutesSaved} min`
              : ''
          }.`,
          cta('Switch route', 'switch_route'),
          `switch:${primary.station.id}`,
          primary.station.id,
          now,
        ),
        priority: 8,
        cooldownMin: null,
        noticed: `${primary.station.name} now beats ${prevPrimary.station.name}`,
      });
    }
  } else if (plan.held && plan.held.minutesSaved >= HELD_WORTH_MENTIONING_MIN) {
    stayQuiet(
      `${plan.held.stationName} would save about ${plan.held.minutesSaved} min`,
      'That is not enough to change a plan you already have. Staying put.',
    );
  }

  // Same primary, getting busier.
  if (
    primary &&
    prevPrimary &&
    primary.station.id === prevPrimary.station.id &&
    primary.metrics.wait.maxMinutes > prevPrimary.metrics.wait.maxMinutes
  ) {
    if (primary.metrics.wait.maxMinutes >= config.busyNotifyWaitMin) {
      say({
        draft: draft(
          'charger_getting_busy',
          'info',
          'Your planned charger is getting busy.',
          `Expected wait ${waitLabel(primary.metrics.wait)}. ${
            next.plan.backup
              ? PHRASES.backupReady
              : 'We’re checking other options.'
          }`,
          cta('View stop', 'open_trip'),
          `busy:${primary.station.id}`,
          primary.station.id,
          now,
        ),
        priority: 3,
        cooldownMin: config.cooldownMin.busy,
        noticed: `${primary.station.name} is getting busier`,
      });
    } else {
      stayQuiet(
        `${primary.station.name} is getting busier`,
        'It is still your best option and the wait is short. No need to interrupt.',
      );
    }
  }

  if (prev.plan.backup && !plan.backup && primary && !plan.switched) {
    say({
      draft: draft(
        'backup_lost',
        'important',
        'Your backup is no longer available.',
        'Your main charger is still good. We’re looking for another backup.',
        cta('View stop', 'open_trip'),
        `backup_lost:${prev.plan.backup.station.id}`,
        prev.plan.backup.station.id,
        now,
      ),
      priority: 4,
      cooldownMin: null,
      noticed: 'The backup stopped being a safe option',
    });
  } else if (
    prev.plan.backup &&
    plan.backup &&
    prev.plan.backup.station.id !== plan.backup.station.id
  ) {
    stayQuiet(
      'Your backup changed',
      `${plan.backup.station.name} is now the better Plan B. Your main stop is unchanged.`,
    );
  }

  // ------------------------------------------------------ approaching a stop
  if (primary && next.phase !== 'charging' && next.phase !== 'continuing') {
    const km = primary.metrics.distanceFromDriverKm;
    const id = primary.station.id;
    // "Coming up" is for the stage before "N minutes away": once the driver is
    // within near range that message supersedes it.
    if (
      km <= config.approachKm &&
      primary.metrics.etaMin > config.nearMinutes &&
      next.notified[`near:${id}`] === undefined
    ) {
      say({
        draft: draft(
          'stop_approaching',
          'action',
          `Charging stop coming up in ${kmLabel(km)}.`,
          `We’ve selected ${
            primary.station.name
          }. Expected battery on arrival: ${pctLabel(
            primary.metrics.arriveSoc.expected,
          )}. Recommended charge: ${pctLabel(
            primary.metrics.arriveSoc.expected,
          )} → ${pctLabel(primary.metrics.targetSoc)}, ${minutesLabel(
            primary.metrics.chargeMinutes,
          )}. ${plan.backup ? PHRASES.backupReady : ''}`.trim(),
          cta('View stop', 'open_trip'),
          `approach:${id}`,
          id,
          now,
        ),
        priority: 4,
        cooldownMin: null,
        noticed: `${primary.station.name} is ${kmLabel(km)} ahead`,
      });
    }
    if (primary.metrics.etaMin <= config.nearMinutes && km <= 10) {
      say({
        draft: draft(
          'near_charger',
          'action',
          `You’re ${Math.max(1, primary.metrics.etaMin)} ${
            primary.metrics.etaMin <= 1 ? 'minute' : 'minutes'
          } away.`,
          availabilityLine(primary, now),
          cta('View stop', 'open_trip'),
          `near:${id}`,
          id,
          now,
        ),
        priority: 6,
        cooldownMin: null,
        noticed: `Almost at ${primary.station.name}`,
      });
    }
    // Under a kilometre the driver is already at the exit: the "minutes away"
    // message covered it and there is nothing left to act on.
    if (km <= config.imminentKm && km > 1) {
      say({
        draft: draft(
          'stop_imminent',
          'action',
          `Charging stop in ${kmLabel(km)}.`,
          `${primary.station.name} is next. ${availabilityLine(primary, now)}`,
          cta('View stop', 'open_trip'),
          `imminent:${id}`,
          id,
          now,
        ),
        priority: 7,
        cooldownMin: null,
        noticed: `${primary.station.name} is about to be your stop`,
      });
    }
  }

  // ---------------------------------------------------------------- charging
  if (event.type === 'SESSION_STARTED') {
    say({
      draft: draft(
        'charging_started',
        'info',
        'Charging started.',
        `We’ll let you know when you have enough to carry on. Target ${pctLabel(
          event.targetSoc,
        )}.`,
        cta('View trip', 'open_trip'),
        `started:${tripKey}:${event.stationId}`,
        event.stationId,
        now,
      ),
      priority: 2,
      cooldownMin: null,
      noticed: 'Charging began',
    });
  }
  // "Enough" means enough to finish with the reserve AND the comfort buffer:
  // the very margin the recommended target was built with, so we never say it
  // before the number we told the driver to aim for.
  const enoughFor = (t: ActiveTrip) =>
    t.plan.destination.socWithoutCharging.low >=
    t.reservePct + config.comfortBufferPct;
  const enoughNow =
    event.type === 'TARGET_SOC_REACHED' ||
    (next.phase === 'charging' && enoughFor(next) && !enoughFor(prev));
  if (enoughNow && next.session) {
    const soc = Math.round(next.currentSoC);
    say({
      draft: draft(
        'enough_charge',
        'action',
        `You’re at ${soc}%.`,
        'That’s enough for the rest of your trip.',
        cta('Continue trip', 'continue_trip'),
        `enough:${tripKey}:${next.session.stationId}`,
        next.session.stationId,
        now,
      ),
      priority: 6,
      cooldownMin: null,
      noticed: 'You have enough battery to finish',
    });
  }
  if (event.type === 'SESSION_ENDED') {
    say({
      draft: draft(
        'ready_to_continue',
        'action',
        'You’re ready to continue.',
        plan.chargingRequired && primary
          ? `Next stop: ${primary.station.name}, ${kmLabel(
              primary.metrics.distanceFromDriverKm,
            )} ahead.`
          : `You’ll reach ${next.destination.label} with about ${pctLabel(
              plan.destination.socWithoutCharging.expected,
            )}.`,
        cta('Continue trip', 'continue_trip'),
        `continue:${tripKey}:${Math.round(event.at)}`,
        null,
        now,
      ),
      priority: 6,
      cooldownMin: null,
      noticed: 'Charging finished',
    });
  }
  if (event.type === 'PAYMENT_FAILED') {
    say({
      draft: draft(
        'payment_failed',
        'important',
        'Your payment didn’t go through.',
        'Open it to try again or choose another method.',
        cta('Fix payment', 'start_charging'),
        `payment:${tripKey}:${Math.round(event.at)}`,
        null,
        now,
      ),
      priority: 8,
      cooldownMin: null,
      noticed: 'Payment failed',
    });
  }

  // ------------------------------------------------------------ trip is easy
  if (
    prev.plan.chargingRequired &&
    !plan.chargingRequired &&
    next.phase !== 'charging' &&
    event.type !== 'TRIP_STARTED'
  ) {
    say({
      draft: draft(
        'no_charge_needed_yet',
        'info',
        'You have enough battery.',
        'You can reach your destination without another stop. No action needed.',
        null,
        `easy:${tripKey}`,
        null,
        now,
      ),
      priority: 1,
      cooldownMin: null,
      noticed: 'The plan no longer needs a stop',
    });
  }

  // ---------------------------------------------------------------- network
  if (event.type === 'NETWORK_LOST') {
    say({
      draft: draft(
        'offline',
        'info',
        'You’re offline.',
        `Your charging plan is still available. Last status update: ${lastStatusAge(
          next,
          now,
        )}.`,
        cta('View plan', 'open_trip'),
        `offline:${tripKey}`,
        null,
        now,
      ),
      priority: 2,
      cooldownMin: config.cooldownMin.offline,
      noticed: 'Lost signal',
    });
  }
  if (event.type === 'NETWORK_RESTORED') {
    stayQuiet(
      'Signal is back',
      'Nothing for you to do. Refreshing statuses quietly.',
    );
  }
  if (event.type === 'DESTINATION_REACHED') {
    say({
      draft: draft(
        'arrived',
        'info',
        'You’ve arrived.',
        `${next.destination.label} reached with about ${pctLabel(
          next.currentSoC,
        )}.`,
        null,
        `arrived:${tripKey}`,
        null,
        now,
      ),
      priority: 1,
      cooldownMin: null,
      noticed: 'Destination reached',
    });
  }

  return resolve({candidates, silent, input});
}

/**
 * Dedupe, apply quiet mode and the critical cap, then let ONE message through:
 * the most important. The rest are recorded as merged, never sent.
 */
function resolve(args: {
  candidates: Candidate[];
  silent: Decision[];
  input: NotifyInput;
}): Decision[] {
  const {input} = args;
  const {next, now, quiet} = input;
  const out: Decision[] = [...args.silent];
  const live: Candidate[] = [];

  args.candidates.forEach(c => {
    const {draft: d} = c;
    const told = next.notified[d.dedupeKey];
    if (told !== undefined) {
      const cool = c.cooldownMin;
      if (cool === null || now - told < cool * 60000) {
        out.push({
          at: now,
          noticed: c.noticed,
          notify: false,
          why: 'Already told you about this.',
          draft: null,
          noise: true,
        });
        return;
      }
    }
    if (quiet && LEVEL_RANK[d.level] < LEVEL_RANK.important) {
      out.push({
        at: now,
        noticed: c.noticed,
        notify: false,
        why: 'Quiet mode: only plan changes and safety alerts come through.',
        draft: null,
      });
      return;
    }
    if (
      d.level === 'critical' &&
      next.counters.critical >= MAX_CRITICAL_PER_TRIP
    ) {
      out.push({
        at: now,
        noticed: c.noticed,
        notify: false,
        why: 'Critical alerts are limited so they stay meaningful.',
        draft: null,
      });
      return;
    }
    live.push(c);
  });

  live.sort(
    (a, b) =>
      LEVEL_RANK[b.draft.level] - LEVEL_RANK[a.draft.level] ||
      b.priority - a.priority,
  );
  live.forEach((c, i) => {
    if (i === 0) {
      out.push({
        at: now,
        noticed: c.noticed,
        notify: true,
        why: whyWeSpoke(c.draft.level),
        draft: c.draft,
      });
    } else {
      out.push({
        at: now,
        noticed: c.noticed,
        notify: false,
        why: 'Covered by a more important message sent just now.',
        draft: null,
        noise: true,
      });
    }
  });
  return out;
}

function whyWeSpoke(level: NotificationLevel): string {
  switch (level) {
    case 'critical':
      return 'This is about your safety, so we spoke up right away.';
    case 'important':
      return 'Your plan changed, so you should know.';
    case 'action':
      return 'You’ll need to do something soon.';
    default:
      return 'A short heads-up; nothing for you to do.';
  }
}
