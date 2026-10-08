/**
 * The co-driver's voice and manners.
 *
 *  - Every message PlugOrbit may say while driving is built HERE, so the tone
 *    stays calm and consistent and can be tested.
 *  - Every message has a LEVEL, and the level (plus the driver's preference)
 *    decides whether it reaches the notification inbox, a toast, or stays quietly
 *    on the trip screen. Most internal calculations never reach the driver.
 */

export type NotificationLevel =
  | 'informational'
  | 'action'
  | 'important'
  | 'critical';

export const LEVEL_RANK: Record<NotificationLevel, number> = {
  informational: 0,
  action: 1,
  important: 2,
  critical: 3,
};

export type CoDriverEventKind =
  | 'trip_started'
  | 'stop_upcoming'
  | 'approaching'
  | 'availability_changed'
  | 'switch_suggested'
  | 'stop_changed'
  | 'charging_started'
  | 'enough_charge'
  | 'ready_to_continue'
  | 'destination_arrived'
  | 'battery_critical'
  | 'no_reliable_charger'
  | 'offline'
  | 'back_online'
  | 'plan_updated';

export type EventTarget = {route: string; params?: Record<string, unknown>};

export type CoDriverEvent = {
  /** Stable per moment (trip + kind + station) so it is delivered only once. */
  key: string;
  kind: CoDriverEventKind;
  level: NotificationLevel;
  title: string;
  body: string;
  at: number;
  target: EventTarget | null;
};

// ---------------------------------------------------------------- preferences --

/** calm = tell me what I need to act on; all = also the quiet updates. */
export type NotifyMode = 'calm' | 'all' | 'critical_only';

export type SmartDrivePrefs = {
  /** Move to the backup without asking (we still tell the driver). */
  autoSwitch: boolean;
  notifyMode: NotifyMode;
  /** "Charging stop coming up" fires this many km before the stop. */
  remindKm: number;
};

export const DEFAULT_SMART_DRIVE_PREFS: SmartDrivePrefs = {
  autoSwitch: false,
  notifyMode: 'calm',
  remindKm: 40,
};

// ------------------------------------------------------------------ delivery --

export type Delivery = {
  /** Kept in the notification inbox. */
  inbox: boolean;
  /** Shown as a brief message right now. */
  toast: boolean;
};

const NOT_DELIVERED: Delivery = {inbox: false, toast: false};

/** Critical messages are rare on purpose: no second toast inside this window. */
export const CRITICAL_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Decide how loudly an event may speak. The same event key is never delivered
 * twice; critical events always reach the inbox, but a second one inside the
 * cooldown does not toast again.
 */
export function deliveryFor(
  event: Pick<CoDriverEvent, 'key' | 'level'>,
  prefs: SmartDrivePrefs,
  delivered: readonly string[],
  lastCriticalAt: number | null,
  now: number,
): Delivery {
  if (delivered.includes(event.key)) {
    return NOT_DELIVERED;
  }
  if (event.level === 'critical') {
    const cooling =
      lastCriticalAt !== null && now - lastCriticalAt < CRITICAL_COOLDOWN_MS;
    return {inbox: true, toast: !cooling};
  }
  if (prefs.notifyMode === 'critical_only') {
    return NOT_DELIVERED;
  }
  if (event.level === 'informational') {
    return prefs.notifyMode === 'all'
      ? {inbox: true, toast: false}
      : NOT_DELIVERED;
  }
  return {inbox: true, toast: true};
}

// ---------------------------------------------------------------------- copy --

type Base = {tripId: string; at: number};

function make(
  kind: CoDriverEventKind,
  level: NotificationLevel,
  keyParts: ReadonlyArray<string | number>,
  title: string,
  body: string,
  at: number,
  target: EventTarget | null = {route: 'SmartDrive'},
): CoDriverEvent {
  return {key: keyParts.join(':'), kind, level, title, body, at, target};
}

const km = (n: number) => `${Math.max(1, Math.round(n))} km`;

/** Why the planned charger is being left, in the driver's words. */
export function switchWhy(
  reason: 'occupied' | 'offline' | 'unreliable' | 'better',
  fromName: string,
): string {
  switch (reason) {
    case 'offline':
      return `${fromName} just went offline.`;
    case 'unreliable':
      return `We couldn’t confirm ${fromName} right now.`;
    case 'occupied':
      return 'The charger you were heading to may be occupied when you arrive.';
    default:
      return `${fromName} is not the best option any more.`;
  }
}

export const coDriverEvents = {
  tripStarted(
    p: Base & {destination: string; chargingRequired: boolean},
  ): CoDriverEvent {
    return make(
      'trip_started',
      'informational',
      [p.tripId, 'trip_started'],
      'You’re good to drive.',
      p.chargingRequired
        ? `On the way to ${p.destination}. We’ll remind you before charging is needed.`
        : `On the way to ${p.destination}. No charging needed for this trip.`,
      p.at,
    );
  },

  stopUpcoming(
    p: Base & {
      stationId: string;
      stationName: string;
      distanceKm: number;
      arriveSoc: number;
      chargeToSoc: number;
      stopMin: number;
    },
  ): CoDriverEvent {
    return make(
      'stop_upcoming',
      'action',
      [p.tripId, 'stop_upcoming', p.stationId],
      `Charging stop in ${km(p.distanceKm)}.`,
      `We’ve selected ${p.stationName}. Expected arrival battery: ${p.arriveSoc}%. Charge to ${p.chargeToSoc}% (about ${p.stopMin} min). No action needed yet.`,
      p.at,
    );
  },

  approaching(
    p: Base & {
      stationId: string;
      stationName: string;
      minutes: number;
      connectorLabel: string | null;
      connectorFree: boolean;
    },
  ): CoDriverEvent {
    const when = `You’re ${Math.max(1, Math.round(p.minutes))} min away.`;
    return make(
      'approaching',
      'action',
      [p.tripId, 'approaching', p.stationId],
      when,
      p.connectorLabel && p.connectorFree
        ? `Connector ${p.connectorLabel} is currently available.`
        : `We’ll check the connectors with you at ${p.stationName}.`,
      p.at,
    );
  },

  availabilityChanged(
    p: Base & {stationId: string; stationName: string; freeBays: number},
  ): CoDriverEvent {
    return make(
      'availability_changed',
      'action',
      [p.tripId, 'availability_changed', p.stationId, p.freeBays],
      'Your planned charger is getting busy.',
      `${p.stationName} is filling up. We’re checking your backup.`,
      p.at,
    );
  },

  switchSuggested(
    p: Base & {
      fromStationId: string;
      fromName: string;
      toName: string;
      aheadKm: number | null;
      reason: 'occupied' | 'offline' | 'unreliable' | 'better';
    },
  ): CoDriverEvent {
    const ahead =
      p.aheadKm !== null && p.aheadKm > 0
        ? ` ${p.toName} is ${km(p.aheadKm)} ahead on your route.`
        : ` ${p.toName} is a better option.`;
    const why = switchWhy(p.reason, p.fromName);
    return make(
      'switch_suggested',
      'important',
      [p.tripId, 'switch_suggested', p.fromStationId],
      'We’ve found a better charging stop.',
      `${why}${ahead}`,
      p.at,
      {route: 'BackupAlert', params: {stationId: p.fromStationId}},
    );
  },

  stopChanged(
    p: Base & {
      fromStationId: string;
      fromName: string;
      toName: string;
      aheadKm: number | null;
      auto: boolean;
    },
  ): CoDriverEvent {
    return make(
      'stop_changed',
      'important',
      [p.tripId, 'stop_changed', p.fromStationId],
      'We’ve changed your charging stop.',
      p.aheadKm !== null && p.aheadKm > 0
        ? `${p.fromName} may be occupied when you arrive. ${p.toName} is ${km(
            p.aheadKm,
          )} ahead on your route.`
        : `${p.fromName} may be occupied when you arrive. You’re now heading to ${p.toName}.`,
      p.at,
    );
  },

  chargingStarted(p: Base & {stationName: string}): CoDriverEvent {
    return make(
      'charging_started',
      'action',
      [p.tripId, 'charging_started', p.at],
      'Charging started successfully.',
      `Charging at ${p.stationName}. We’ll tell you when you have enough.`,
      p.at,
      {route: 'ActiveSession'},
    );
  },

  enoughCharge(p: Base & {soc: number; finalStop: boolean}): CoDriverEvent {
    return make(
      'enough_charge',
      'action',
      [p.tripId, 'enough_charge', p.at],
      `You’re at ${Math.round(p.soc)}%.`,
      p.finalStop
        ? 'That’s enough to comfortably complete your trip.'
        : 'That’s enough to comfortably reach your next stop.',
      p.at,
      {route: 'ActiveSession'},
    );
  },

  readyToContinue(p: Base & {soc: number}): CoDriverEvent {
    return make(
      'ready_to_continue',
      'action',
      [p.tripId, 'ready_to_continue', p.at],
      'You’re ready to continue.',
      `Battery ${Math.round(p.soc)}%. Your trip is back on track.`,
      p.at,
    );
  },

  destinationArrived(
    p: Base & {destination: string; soc: number},
  ): CoDriverEvent {
    return make(
      'destination_arrived',
      'informational',
      [p.tripId, 'destination_arrived'],
      `You’ve arrived in ${p.destination}.`,
      `You made it with about ${Math.round(p.soc)}% left.`,
      p.at,
    );
  },

  batteryCritical(p: Base & {soc: number}): CoDriverEvent {
    return make(
      'battery_critical',
      'critical',
      [p.tripId, 'battery_critical'],
      'Battery is very low.',
      `About ${Math.round(
        p.soc,
      )}% left. We’re guiding you to the closest working charger.`,
      p.at,
      {route: 'ChargePick', params: {mode: 'critical'}},
    );
  },

  noReliableCharger(p: Base): CoDriverEvent {
    return make(
      'no_reliable_charger',
      'critical',
      [p.tripId, 'no_reliable_charger'],
      'We can’t find a reliable charger within reach.',
      'Roadside help can bring you a charge. We’ve kept the closest options ready.',
      p.at,
      {route: 'Roadside'},
    );
  },

  offline(p: Base): CoDriverEvent {
    return make(
      'offline',
      'important',
      [p.tripId, 'offline', p.at],
      'You’re offline.',
      'We’ve kept your charging plan available on this phone.',
      p.at,
      {route: 'OfflineMode'},
    );
  },

  backOnline(p: Base): CoDriverEvent {
    return make(
      'back_online',
      'informational',
      [p.tripId, 'back_online', p.at],
      'Back online.',
      'Refreshing your charging stop.',
      p.at,
    );
  },

  planUpdated(p: Base & {detail: string}): CoDriverEvent {
    return make(
      'plan_updated',
      'informational',
      [p.tripId, 'plan_updated', p.at],
      'Your plan is up to date.',
      p.detail,
      p.at,
    );
  },
};
