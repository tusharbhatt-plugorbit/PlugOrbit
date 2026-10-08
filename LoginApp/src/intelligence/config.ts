import type {PreferenceProfile, Weights} from './types';

/**
 * Every threshold and weight Smart Drive uses, in one place. Nothing is
 * hard-coded in an engine, so product can tune behaviour (or a server can push
 * new values) without touching logic.
 */
export type SmartDriveConfig = {
  /** Never plan to arrive anywhere with less than this (percent). */
  minimumSafetyReservePct: number;
  /** At or below this current charge, battery-critical mode takes over. */
  batteryCriticalPct: number;
  /** In critical mode the arrival floor relaxes to this, never lower. */
  absoluteFloorPct: number;
  /** Chargers further than this from the route are not "on the way". */
  maxLateralKm: number;
  /** DC charging slows a lot past this, so it is the comfort cap. */
  maxChargeToPct: number;
  /** Only when nothing else follows may a stop charge past the comfort cap. */
  hardChargeCapPct: number;
  /** Margin on top of what the rest of the trip needs. */
  comfortBufferPct: number;
  /** A stop that adds less than this is not worth making. */
  minUsefulChargePct: number;
  /**
   * When a trip needs charging, a stop that would add fewer points than this is
   * "too early" whenever a later safe stop exists: it is skipped, not scored.
   */
  minWorthwhileChargePct: number;
  /**
   * Stops are compared on whole-trip impact, so a stop that forces another one
   * later is charged this many minutes for it (detour, plug-in, charging).
   */
  downstreamStopMin: number;
  /** Extra minutes charged to a stop after which the trip cannot be finished. */
  infeasiblePenaltyMin: number;
  /** Extra minutes charged when finishing needs charging past the comfort cap. */
  beyondCapPenaltyMin: number;
  /**
   * Stop time is scored on an absolute scale (not against the other candidates,
   * which an outlier would distort): full marks at this many trip minutes...
   */
  stopTimeFloorMin: number;
  /** ...falling to zero this many minutes later. */
  stopTimeSpanMin: number;
  /** +/- share of consumption used to turn one estimate into a band. */
  consumptionSpread: number;

  /** "Charging stop coming up" fires inside this distance. */
  approachKm: number;
  /** "Charging stop in N km" fires inside this distance. */
  imminentKm: number;
  /** "You're N minutes away" fires inside this many minutes. */
  nearMinutes: number;
  /** Primary stays best but the expected wait passes this: tell the driver. */
  busyNotifyWaitMin: number;

  /** Switch only if the new stop saves at least this many minutes... */
  switchMinSavingMin: number;
  /** ...or scores at least this many points better. */
  switchScoreMargin: number;
  /**
   * A charger only counts as a quicker alternative if it is at least this close
   * in score to the current one (quicker must not mean worse).
   */
  switchQualityMargin: number;
  /**
   * After leaving a charger, going back to it within this many minutes needs
   * twice the usual saving: a plan must not flip A, B, A on a flickering feed.
   */
  switchBackCooldownMin: number;
  /** Inside this distance the plan is locked unless safety forces a change. */
  switchLockKm: number;
  /** Inside the lock, a switch must save at least this much. */
  switchLockSavingMin: number;

  maxBackupExtraMin: number;
  /** "No wait" may only be claimed this close to arrival, on a live feed. */
  liveHorizonMin: number;
  /** Side-road driving speed used for detour time. */
  localSpeedKmh: number;
  /** Plug in / unplug / rejoin overhead. */
  rejoinOverheadMin: number;
  defaultSpeedKmh: number;
  platformFeeInr: number;

  /** Notification cooldowns in minutes by kind of repeat. */
  cooldownMin: {
    busy: number;
    critical: number;
    offline: number;
    limited: number;
  };
  weights: {normal: Weights; critical: Weights};
};

/** Normal priorities: reliability, availability, route fit, speed, price... */
export const NORMAL_WEIGHTS: Weights = {
  reliability: 0.16,
  availability: 0.16,
  freshness: 0.06,
  routeFit: 0.07,
  stopTime: 0.16,
  speed: 0.06,
  cost: 0.07,
  backup: 0.08,
  reachability: 0.05,
  amenities: 0.04,
  timing: 0.07,
  continuation: 0.02,
  compatibility: 0.01,
  proximity: 0,
};

/** Battery-critical: reachability first, then reliability. Cheaper never wins. */
export const CRITICAL_WEIGHTS: Weights = {
  reachability: 0.26,
  reliability: 0.2,
  availability: 0.16,
  proximity: 0.14,
  speed: 0.07,
  freshness: 0.05,
  routeFit: 0.03,
  stopTime: 0.03,
  cost: 0.02,
  backup: 0.02,
  continuation: 0.01,
  compatibility: 0.01,
  amenities: 0,
  timing: 0,
};

export const DEFAULT_SMART_DRIVE_CONFIG: SmartDriveConfig = {
  minimumSafetyReservePct: 12,
  batteryCriticalPct: 15,
  absoluteFloorPct: 5,
  maxLateralKm: 14,
  maxChargeToPct: 80,
  hardChargeCapPct: 95,
  comfortBufferPct: 4,
  minUsefulChargePct: 10,
  minWorthwhileChargePct: 15,
  downstreamStopMin: 25,
  infeasiblePenaltyMin: 60,
  beyondCapPenaltyMin: 8,
  stopTimeFloorMin: 15,
  stopTimeSpanMin: 90,
  consumptionSpread: 0.1,

  approachKm: 30,
  imminentKm: 3,
  nearMinutes: 5,
  busyNotifyWaitMin: 10,

  switchMinSavingMin: 10,
  switchScoreMargin: 8,
  switchQualityMargin: 15,
  switchBackCooldownMin: 30,
  switchLockKm: 5,
  switchLockSavingMin: 20,

  maxBackupExtraMin: 30,
  liveHorizonMin: 15,
  localSpeedKmh: 35,
  rejoinOverheadMin: 2,
  defaultSpeedKmh: 66,
  platformFeeInr: 0,

  cooldownMin: {busy: 20, critical: 15, offline: 10, limited: 45},
  weights: {normal: NORMAL_WEIGHTS, critical: CRITICAL_WEIGHTS},
};

/** How each profile bends the normal weights (multipliers, then renormalised). */
export const PROFILE_MULTIPLIERS: Record<
  PreferenceProfile,
  Partial<Weights>
> = {
  balanced: {},
  fastest: {stopTime: 1.8, speed: 1.8, cost: 0.5},
  cheapest: {cost: 3, stopTime: 0.8, speed: 0.8},
  reliable: {reliability: 1.4, freshness: 1.4, availability: 1.2},
  comfort: {amenities: 4, routeFit: 0.8},
};

/** "Prefer stops with amenities" in Trip preferences multiplies this on top. */
export const AMENITIES_BOOST = 2.5;

export function withConfig(
  overrides: Partial<SmartDriveConfig> = {},
): SmartDriveConfig {
  return {...DEFAULT_SMART_DRIVE_CONFIG, ...overrides};
}
