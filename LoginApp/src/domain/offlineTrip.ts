import type {ActiveTrip, OfflineStop, OfflineTripSnapshot} from './activeTrip';
import {
  availableCount,
  compatibleConnectors,
  hasUnconfirmedConnectors,
} from './rules';
import {chooseConnector} from './recommendation';
import type {Station, Vehicle} from './types';

/**
 * OFFLINE TRIP MODE: what the phone keeps so the charging plan still works in
 * a dead zone. Everything is a snapshot, so every status in it carries who said
 * it and when, and the UI shows it as "last updated N min ago". Nothing from a
 * snapshot is ever presented as live (the trust label is re-derived from the
 * saved source and age every time it is shown, see `dataTrust`).
 */

const QR_FLOW =
  'Scan the charger’s QR in PlugOrbit, pick the connector and start. We hold a payment first and charge only what you use.';

/** How to start here, in the operator's own words when PlugOrbit can't. */
export function accessInstructions(station: Station): string {
  if (station.integration === 'external') {
    return (
      station.operatorInstructions ??
      'Start this charger with the operator’s own app or QR code.'
    );
  }
  return QR_FLOW;
}

/** Who to ask. No invented phone numbers: only what we really know. */
export function helpLine(station: Station): string {
  return station.integration === 'external'
    ? `${station.operator} runs this charger: use the helpline printed on it. PlugOrbit support is in Profile > Support once you have signal.`
    : 'PlugOrbit support is in Profile > Support once you have signal. The charger also shows the operator’s helpline.';
}

function stopSnapshot(
  role: OfflineStop['role'],
  stopIndex: number,
  station: Station,
  vehicle: Vehicle,
  preferConnectorId: string | undefined,
  alongKm: number,
  currentKm: number,
): OfflineStop {
  const usable = compatibleConnectors(station, vehicle);
  const connector =
    usable.find(c => c.id === preferConnectorId) ??
    chooseConnector(station, vehicle) ??
    station.connectors[0];
  const known = !hasUnconfirmedConnectors(station) && usable.length > 0;
  return {
    role,
    stopIndex,
    stationId: station.id,
    name: station.name,
    operator: station.operator,
    address: station.address,
    latitude: station.latitude,
    longitude: station.longitude,
    connectorId: connector?.id ?? '',
    connectorLabel: connector?.label ?? 'Unconfirmed',
    connectorType: connector?.type ?? 'Unknown',
    powerKw: connector?.powerKw ?? 0,
    statusSource: station.statusFeed.source,
    statusUpdatedAt: station.statusFeed.updatedAt,
    freeBays: known ? availableCount(station, vehicle) : null,
    totalBays: usable.length,
    pricePerKwh: connector?.pricePerKwh ?? null,
    priceUpdatedAt: station.priceFeed.updatedAt,
    accessInstructions: accessInstructions(station),
    help: helpLine(station),
    kmAhead: Math.round(alongKm - currentKm),
  };
}

/**
 * Snapshot of the stops still ahead (the next stop and its backup, then any
 * later ones). `latest` carries fresher looks at the stations than the route
 * the trip was planned with, when the monitor has them.
 */
export function buildOfflineSnapshot(
  trip: ActiveTrip,
  now: number,
  latest: Readonly<Record<string, Station>> = {},
): OfflineTripSnapshot {
  const stops: OfflineStop[] = [];
  const primary = trip.primaryStop;
  if (primary) {
    const base = trip.route.stops[primary.stopIndex];
    const fresh = latest[primary.stationId] ?? base.station;
    stops.push(
      stopSnapshot(
        'primary',
        primary.stopIndex,
        fresh,
        trip.vehicle,
        primary.connectorId,
        primary.alongKm,
        trip.km,
      ),
    );
    if (primary.backup && base.backup) {
      const backupFresh = latest[primary.backup.stationId] ?? base.backup;
      stops.push(
        stopSnapshot(
          'backup',
          primary.stopIndex,
          backupFresh,
          trip.vehicle,
          undefined,
          primary.backup.alongKm,
          trip.km,
        ),
      );
    }
  }
  return {
    tripId: trip.tripId,
    savedAt: now,
    origin: trip.origin,
    destination: trip.destination,
    vehicleName: `${trip.vehicle.make} ${trip.vehicle.model}`,
    totalKm: trip.totalKm,
    km: trip.km,
    route: trip.route,
    stops,
  };
}
