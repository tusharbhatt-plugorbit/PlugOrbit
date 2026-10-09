import {
  hasUnconfirmedConnectors,
  isCompatible,
  stationHealth,
} from '../domain/rules';
import {dataTrust, isStale} from '../domain/trust';
import type {
  PaymentMethod,
  Station,
  StationConnector,
  Vehicle,
} from '../domain/types';
import type {SmartDriveConfig} from './config';
import {isAlwaysOpen, openStateAt} from './hours';
import type {
  DriveMode,
  SafetyViolation,
  SafetyWarningCode,
  SocRange,
} from './types';

/**
 * SafetyRuleEngine.
 *
 * Deterministic, no weights, no learning. It runs BEFORE any scoring and
 * decides which chargers are even allowed to be recommended. The recommendation
 * engine then optimises only inside this safe set, so a clever ranking can
 * never talk the app into a charger that does not fit the car, cannot be
 * reached, is known to be offline, or is closed.
 */

export type SafetyVerdict = {
  safe: boolean;
  violations: SafetyViolation[];
  warnings: SafetyWarningCode[];
};

/** Rules that depend only on the station and the car (not on where we are). */
export function evaluateStation(
  station: Station,
  vehicle: Vehicle,
): SafetyViolation[] {
  const out: SafetyViolation[] = [];
  if (hasUnconfirmedConnectors(station)) {
    // We cannot prove it fits, so it does not get recommended.
    out.push({
      code: 'CONNECTOR_UNCONFIRMED',
      detail: 'The source does not say which connectors this charger has.',
    });
    return out;
  }
  if (!isCompatible(station, vehicle)) {
    out.push({
      code: 'INCOMPATIBLE_CONNECTOR',
      detail: 'No connector fits this vehicle.',
    });
    return out;
  }
  if (stationHealth(station, vehicle) === 'offline') {
    out.push({
      code: 'CHARGER_OFFLINE',
      detail: 'Every compatible connector is reported offline.',
    });
  }
  return out;
}

export type ArrivalFacts = {
  etaAt: number;
  arriveSoc: SocRange;
  connector: StationConnector | null;
};

/** Rules that depend on when and with how much battery we would arrive. */
export function evaluateArrival(
  station: Station,
  facts: ArrivalFacts,
  now: number,
  mode: DriveMode,
  reservePct: number,
  config: Pick<SmartDriveConfig, 'absoluteFloorPct'>,
): {violations: SafetyViolation[]; warnings: SafetyWarningCode[]} {
  const violations: SafetyViolation[] = [];
  const warnings: SafetyWarningCode[] = [];

  // Reachability uses the pessimistic edge of the battery band.
  const low = facts.arriveSoc.low;
  if (low < config.absoluteFloorPct) {
    violations.push({
      code: 'UNREACHABLE',
      detail: `Would arrive with about ${Math.round(
        low,
      )}%, below the absolute floor.`,
    });
  } else if (low < reservePct) {
    if (mode === 'normal') {
      violations.push({
        code: 'BELOW_RESERVE',
        detail: `Would arrive with about ${Math.round(
          low,
        )}%, below the ${reservePct}% reserve.`,
      });
    } else {
      // Battery-critical: the safest reachable option may dip into the reserve.
      warnings.push('RESERVE_BREACH_ACCEPTED');
    }
  }

  const open = openStateAt(station.hours, facts.etaAt);
  if (open === 'closed') {
    violations.push({
      code: 'CLOSED_AT_ARRIVAL',
      detail: `Closed when we would arrive (${station.hours}).`,
    });
  } else if (open === 'unknown' && !isAlwaysOpen(station.hours)) {
    warnings.push('HOURS_UNKNOWN');
  }

  const trust = dataTrust(station.statusFeed, now);
  if (trust === 'unknown') {
    warnings.push('STATUS_UNKNOWN');
  } else if (isStale(station.statusFeed, now)) {
    warnings.push('STATUS_STALE');
  }
  if (facts.connector && facts.connector.pricePerKwh === null) {
    warnings.push('PRICE_UNKNOWN');
  }
  if (station.integration === 'external') {
    warnings.push('OPERATOR_APP_REQUIRED');
  }
  return {violations, warnings};
}

export function evaluateStop(args: {
  station: Station;
  vehicle: Vehicle;
  facts: ArrivalFacts;
  now: number;
  mode: DriveMode;
  reservePct: number;
  config: Pick<SmartDriveConfig, 'absoluteFloorPct'>;
}): SafetyVerdict {
  const fixed = evaluateStation(args.station, args.vehicle);
  const arrival = evaluateArrival(
    args.station,
    args.facts,
    args.now,
    args.mode,
    args.reservePct,
    args.config,
  );
  const violations = [...fixed, ...arrival.violations];
  return {
    safe: violations.length === 0,
    violations,
    warnings: arrival.warnings,
  };
}

/** True only for a fresh operator feed: the one case "LIVE" may be printed. */
export function mayClaimLive(station: Station, now: number): boolean {
  return dataTrust(station.statusFeed, now) === 'live';
}

// ------------------------------------------------------------ remote start --

export type RemoteStartBlock =
  | 'NOT_INTEGRATED'
  | 'OPERATOR_LINK_DOWN'
  | 'CONNECTOR_UNAVAILABLE'
  | 'PRICE_UNPUBLISHED'
  | 'NO_VALID_PAYMENT'
  | 'NO_PREAUTH';

export type RemoteStartVerdict =
  | {allowed: true}
  | {allowed: false; code: RemoteStartBlock};

/**
 * May PlugOrbit start this charger remotely? Never without a validated payment
 * method and a successful pre-authorisation, and never on a charger we do not
 * actually control (there we hand over to the operator and say so).
 */
export function evaluateRemoteStart(args: {
  station: Station;
  connectorId: string;
  paymentMethods: readonly PaymentMethod[];
  methodId: string | null;
  preauthorised: boolean;
  operatorLinkDown: boolean;
}): RemoteStartVerdict {
  const {station} = args;
  if (station.integration !== 'integrated') {
    return {allowed: false, code: 'NOT_INTEGRATED'};
  }
  if (args.operatorLinkDown) {
    return {allowed: false, code: 'OPERATOR_LINK_DOWN'};
  }
  const connector = station.connectors.find(c => c.id === args.connectorId);
  if (!connector || connector.status !== 'available') {
    return {allowed: false, code: 'CONNECTOR_UNAVAILABLE'};
  }
  if (connector.pricePerKwh === null) {
    return {allowed: false, code: 'PRICE_UNPUBLISHED'};
  }
  const method = args.paymentMethods.find(m => m.id === args.methodId);
  if (!method || !method.validated) {
    return {allowed: false, code: 'NO_VALID_PAYMENT'};
  }
  if (!args.preauthorised) {
    return {allowed: false, code: 'NO_PREAUTH'};
  }
  return {allowed: true};
}
