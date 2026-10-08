import {TRUST_LABEL, dataTrust, timeAgo} from '../domain/trust';
import type {FeedInfo, TrustLevel} from '../domain/types';
import {formatInr} from '../utils/format';
import type {Coords} from '../utils/geo';
import type {ActiveTrip, ScoredStop} from './types';

/**
 * OfflineTripService.
 *
 * Highway dead zones are normal, so the plan must not depend on a connection.
 * The trip already carries everything needed (route, destination, the chosen
 * stop and its backup with connector details and last-known status and price).
 * This turns that into a view that is honest about its age.
 *
 * The one hard rule: a status that came from a cache is NEVER shown as LIVE,
 * however fresh the cache is. A cached "live" reading is, at best, estimated.
 */
export function offlineTrust(feed: FeedInfo, now: number): TrustLevel {
  const trust = dataTrust(feed, now);
  return trust === 'live' ? 'estimated' : trust;
}

export type OfflineStopView = {
  role: 'primary' | 'backup';
  stationId: string;
  name: string;
  operator: string;
  address: string;
  coords: Coords;
  connectorId: string;
  connectorLabel: string;
  connectorType: string;
  chargerKw: number;
  hours: string;
  /** How to get charging started with no signal. */
  access: string;
  instructions: string | null;
  status: {
    trust: TrustLevel;
    label: string;
    age: string;
    updatedAt: number | null;
  };
  price: string;
};

export type OfflineTripView = {
  headline: string;
  subline: string;
  lastUpdate: string;
  destination: {label: string; coords: Coords};
  routePoints: number;
  stops: OfflineStopView[];
};

function stopView(
  stop: ScoredStop,
  role: OfflineStopView['role'],
  now: number,
): OfflineStopView {
  const {station, metrics} = stop;
  const trust = offlineTrust(station.statusFeed, now);
  const age = timeAgo(station.statusFeed.updatedAt, now);
  const connector = station.connectors.find(c => c.id === metrics.connectorId);
  const price = connector?.pricePerKwh ?? null;
  return {
    role,
    stationId: station.id,
    name: station.name,
    operator: station.operator,
    address: station.address,
    coords: {latitude: station.latitude, longitude: station.longitude},
    connectorId: metrics.connectorId,
    connectorLabel: metrics.connectorLabel,
    connectorType: metrics.connectorType,
    chargerKw: metrics.chargerKw,
    hours: station.hours,
    access:
      'Without signal you can’t start this charger from PlugOrbit. Use the QR code or card reader on the charger itself.',
    instructions: station.operatorInstructions,
    status: {
      trust,
      label:
        trust === 'unknown'
          ? 'Unknown'
          : `${TRUST_LABEL[trust]} • last update ${age}`,
      age,
      updatedAt: station.statusFeed.updatedAt,
    },
    price:
      price === null
        ? 'Price not published'
        : `${formatInr(price)}/kWh, last known ${timeAgo(
            station.priceFeed.updatedAt,
            now,
          )}`,
  };
}

/** The offline plan, or null when there is nothing to fall back on. */
export function buildOfflineView(
  trip: ActiveTrip | null,
  now: number,
): OfflineTripView | null {
  if (!trip) {
    return null;
  }
  const stops: OfflineStopView[] = [];
  if (trip.plan.primary) {
    stops.push(stopView(trip.plan.primary, 'primary', now));
  }
  if (trip.plan.backup) {
    stops.push(stopView(trip.plan.backup, 'backup', now));
  }
  const stamps = stops
    .map(s => s.status.updatedAt)
    .filter((t): t is number => t !== null);
  const newest = stamps.length ? Math.max(...stamps) : trip.lastOnlineAt;
  const offline = trip.network === 'offline';
  return {
    headline: offline ? 'You’re offline.' : 'Your trip is saved on this phone.',
    subline: 'Your charging plan is still available.',
    lastUpdate: `Last status update: ${timeAgo(newest, now)}.`,
    destination: trip.destination,
    routePoints: trip.polyline.length,
    stops,
  };
}
