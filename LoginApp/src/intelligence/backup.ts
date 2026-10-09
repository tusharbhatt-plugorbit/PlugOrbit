import type {Vehicle} from '../domain/types';
import {clamp} from '../utils/format';
import {distanceKm} from '../utils/geo';
import {socAfterKm} from './battery';
import type {SmartDriveConfig} from './config';
import {rangeMid} from './stopMetrics';
import type {BackupStop, DriveConditions, ScoredStop} from './types';

/** Closer than this, two chargers are one site and share the same failure risks. */
const SAME_SITE_KM = 1;

/**
 * BackupSelectionService.
 *
 * A backup is not "the second best charger". It is the best Plan B: it must be
 * safe in its own right AND reachable from the primary if the driver arrives
 * and finds it dead, it must not cost much more time, and it should not share a
 * failure with the primary (same operator on the same site).
 *
 * Reaching a backup from the primary may use the safety reserve (that is what
 * the reserve is for), but never the last of the battery.
 */
export function selectBackup(args: {
  primary: ScoredStop;
  /** Other SAFE, scored candidates. The primary may be in here; it is skipped. */
  candidates: readonly ScoredStop[];
  vehicle: Vehicle;
  config: SmartDriveConfig;
  conditions?: DriveConditions;
}): BackupStop | null {
  const {primary, config} = args;
  const primaryTotal = rangeMid(primary.metrics.totalStopMin);

  let best: BackupStop | null = null;
  args.candidates.forEach(c => {
    if (c.station.id === primary.station.id) {
      return;
    }
    // Road-constrained distance between the two stops.
    const gapKm =
      Math.abs(c.alongKm - primary.alongKm) + c.lateralKm + primary.lateralKm;
    const fromPrimarySoc = socAfterKm(
      args.vehicle,
      primary.metrics.arriveSoc.low,
      gapKm,
      config,
      args.conditions,
    );
    if (fromPrimarySoc.low < config.absoluteFloorPct) {
      return;
    }
    const extraMin = Math.max(
      0,
      rangeMid(c.metrics.totalStopMin) - primaryTotal,
    );
    if (extraMin > config.maxBackupExtraMin) {
      return;
    }
    const independent =
      c.station.operator !== primary.station.operator &&
      distanceKm(c.station, primary.station) >= SAME_SITE_KM;
    const margin = clamp(
      (fromPrimarySoc.low - config.minimumSafetyReservePct) / 20,
      0,
      1,
    );
    const strength =
      0.5 * (c.score / 100) +
      0.2 *
        (1 -
          Math.min(extraMin, config.maxBackupExtraMin) /
            config.maxBackupExtraMin) +
      0.15 * (independent ? 1 : 0) +
      0.15 * margin;
    if (!best || strength > best.strength) {
      best = {
        ...c,
        extraMin: Math.round(extraMin),
        strength: Math.round(strength * 100) / 100,
        independent,
        fromPrimarySoc,
      };
    }
  });
  return best;
}
