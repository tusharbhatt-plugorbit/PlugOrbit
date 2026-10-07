import {
  NEARBY_RADIUS_KM,
  REPORTED_FREE_WAIT,
  compatibleConnectors,
  availableCount,
  estimateDetourMin,
  isCompatible,
  isOutsideDemoArea,
} from '../../domain/rules';
import {dataTrust} from '../../domain/trust';
import type {
  CommunityUpdate,
  ConnectorStatus,
  FeedInfo,
  Forecast,
  QueueTicket,
  Reservation,
  Station,
  StationConnector,
  StationQuery,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from '../../domain/types';
import {DEFAULT_CENTER, hasGoogleApiKey} from '../../config/google';
import {appStore} from '../../store/appStore';
import {demoStore} from '../../store/demoStore';
import {distanceKm, Coords} from '../../utils/geo';
import {fetchNearbyChargers} from '../places';
import type {Charger} from '../places';
import type {StationService} from '../types';
import {ApiError, StationNotFoundError} from '../types';
import {buildStations} from './data';
import {guard, hash, uid} from './runtime';

export const detourFor = estimateDetourMin;

export function withDistanceTo(
  station: Station,
  origin: Coords,
): StationWithDistance {
  const d = distanceKm(origin, station);
  return {...station, distanceKm: d, detourMin: detourFor(d)};
}

// The charger the presenter switch applied to, captured the first time it is
// seen on. Switching to the backup makes the backup the *chosen* stop; without
// this it would be forced occupied too and the app would bounce back to the
// Backup alert in a loop.
let occupiedTargetId: string | null = null;
demoStore.subscribe(() => {
  if (!demoStore.get().stationOccupied) {
    occupiedTargetId = null;
  }
});

/** Presenter override: the chosen (or default) charger becomes occupied. */
function applyDemoOverrides(stations: Station[]): Station[] {
  const demo = demoStore.get();
  if (!demo.stationOccupied) {
    return stations;
  }
  if (occupiedTargetId === null) {
    occupiedTargetId =
      appStore.get().chosen?.stationId ?? 'st-chargezone-neemrana';
  }
  const targetId = occupiedTargetId;
  return stations.map(s =>
    s.id !== targetId
      ? s
      : {
          ...s,
          connectors: s.connectors.map(c => ({
            ...c,
            status: 'occupied' as const,
          })),
          statusFeed: {source: 'operator_feed', updatedAt: Date.now() - 8000},
        },
  );
}

/** All known stations with fresh feed timestamps (mock + overrides). */
export function loadStations(): Station[] {
  return applyDemoOverrides(buildStations(Date.now()));
}

// A bay-by-bay list is only a way to show Google's counts; cap it so one odd
// place can't flood a card.
const MAX_BAYS_PER_KIND = 12;

/**
 * One bay per connector Google counts: the first `available` are free, the
 * next `outOfService` are offline, the rest are occupied. Only the totals are
 * Google's; which physical bay is which is not known.
 */
function googleConnectors(c: Charger, stationId: string): StationConnector[] {
  const out: StationConnector[] = [];
  c.connectors.forEach(group => {
    const known = group.available !== null;
    const available = group.available ?? 0;
    const offline = group.outOfService ?? 0;
    const count = Math.min(
      MAX_BAYS_PER_KIND,
      Math.max(group.count ?? 0, available + offline, 1),
    );
    for (let i = 0; i < count; i++) {
      const status: ConnectorStatus = !known
        ? 'unknown'
        : i < available
        ? 'available'
        : i < available + offline
        ? 'offline'
        : 'occupied';
      out.push({
        id: `${stationId}-c${out.length + 1}`,
        label: `C${out.length + 1}`,
        type: group.type,
        powerKw: group.powerKw,
        status,
        pricePerKwh: null,
        idleFeePerMin: null,
      });
    }
  });
  return out;
}

/**
 * Google Places results become external stations carrying only what Google
 * returned. Nothing is invented: no rating, reliability, price or connector it
 * did not give (see `hasUnconfirmedConnectors`), and the status is Google's
 * estimate stamped with Google's own timestamp, or our fetch time without one.
 */
function toGoogleStation(c: Charger, fetchedAt: number): Station {
  const id = `g-${c.id}`;
  const connectors = googleConnectors(c, id);
  const hasCounts = c.connectors.some(g => g.available !== null);
  const statusFeed: FeedInfo = hasCounts
    ? {source: 'google_places', updatedAt: c.availabilityUpdatedAt ?? fetchedAt}
    : {source: 'none', updatedAt: null};
  return {
    id,
    name: c.name,
    operator: 'Google Maps',
    address: c.address ?? '',
    latitude: c.latitude,
    longitude: c.longitude,
    rating: 0,
    successfulSessionsPct: 0,
    reliabilityPct: 0,
    sponsored: false,
    hours: c.hours ?? 'Hours unknown',
    amenities: [],
    connectors,
    integration: 'external',
    operatorInstructions:
      'This station comes from Google Maps. Use the operator’s own app or QR code to start and pay.',
    statusFeed,
    priceFeed: {source: 'none', updatedAt: null},
  };
}

// Every Google station we have shown, newest last, so Details, Directions,
// Saved, Compare and the rest can open it by id. Not persisted: after a restart
// a saved Google charger is "not available right now" until it is found again.
const MAX_CACHED_PLACES = 120;
const placesCache = new Map<string, Station>();

/** Test helper. */
export function clearPlacesCache(): void {
  placesCache.clear();
}

function rememberPlaces(stations: Station[]): void {
  stations.forEach(s => {
    placesCache.delete(s.id);
    placesCache.set(s.id, s);
  });
  while (placesCache.size > MAX_CACHED_PLACES) {
    const oldest = placesCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    placesCache.delete(oldest);
  }
}

async function googleStations(origin: Coords): Promise<Station[]> {
  if (!hasGoogleApiKey) {
    return [];
  }
  try {
    const chargers = await fetchNearbyChargers(origin);
    const now = Date.now();
    const stations = chargers.map(c => toGoogleStation(c, now));
    rememberPlaces(stations);
    return stations;
  } catch {
    return [];
  }
}

/** A mock station, or a Google one we've shown; otherwise not found. */
function findStation(stationId: string): Station {
  const found =
    loadStations().find(s => s.id === stationId) ?? placesCache.get(stationId);
  if (!found) {
    throw new StationNotFoundError();
  }
  return found;
}

/** Wait for this station and car. "No wait" needs a live operator feed. */
export function waitFor(
  station: Station,
  vehicle: Vehicle | null,
  now: number = Date.now(),
): WaitEstimate {
  const live = dataTrust(station.statusFeed, now) === 'live';
  if (availableCount(station, vehicle) > 0) {
    return live
      ? {
          minMinutes: 0,
          maxMinutes: 0,
          confidence: 'high',
          basis: 'live_queue',
        }
      : REPORTED_FREE_WAIT;
  }
  const connectors = compatibleConnectors(station, vehicle);
  if (connectors.length > 0 && connectors.every(c => c.status === 'offline')) {
    return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
  }
  if (station.statusFeed.source === 'operator_feed') {
    const base = 10 + (hash(station.id) % 8);
    // A feed that has gone quiet still gives a range, but a wider, lower one.
    return live
      ? {
          minMinutes: base,
          maxMinutes: base + 8,
          confidence: 'medium',
          basis: 'history',
        }
      : {
          minMinutes: Math.max(5, base - 5),
          maxMinutes: base + 13,
          confidence: 'low',
          basis: 'history',
        };
  }
  return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
}

const communityLog = new Map<string, CommunityUpdate[]>();

// Beyond this a "backup" for a queue isn't a backup, it's another trip.
const QUEUE_BACKUP_MAX_KM = 60;

/** Mock plus Google stations within reach of `origin`, nearest first. */
async function inReach(origin: Coords): Promise<StationWithDistance[]> {
  const [mock, google] = await Promise.all([
    Promise.resolve(loadStations()),
    googleStations(origin),
  ]);
  return [...mock, ...google]
    .map(s => withDistanceTo(s, origin))
    .filter(s => s.distanceKm <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function createStationService(): StationService {
  return {
    async nearby(query: StationQuery) {
      await guard();
      if (demoStore.get().noCompatible) {
        return [];
      }
      let reachable = await inReach(query.origin);
      // The built-in chargers are all around New Delhi. A phone far from there
      // that Google found nothing for would otherwise see an empty app, so look
      // around the demo centre instead; callers tell the driver (isDemoFallback).
      // Only when nothing at all is in reach: chargers that merely don't fit
      // the car are a real answer ("none compatible"), not a reason to move.
      if (
        reachable.length === 0 &&
        isOutsideDemoArea(query.origin, DEFAULT_CENTER)
      ) {
        reachable = await inReach(DEFAULT_CENTER);
      }
      return reachable.filter(
        s => query.includeIncompatible || isCompatible(s, query.vehicle),
      );
    },

    async get(stationId, origin) {
      await guard(200);
      return withDistanceTo(findStation(stationId), origin ?? DEFAULT_CENTER);
    },

    async search(text, origin, vehicle) {
      await guard(250);
      const q = text.trim().toLowerCase();
      return loadStations()
        .filter(
          s =>
            isCompatible(s, vehicle) &&
            (!q ||
              s.name.toLowerCase().includes(q) ||
              s.address.toLowerCase().includes(q) ||
              s.operator.toLowerCase().includes(q)),
        )
        .map(s => withDistanceTo(s, origin))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    },

    async waitEstimate(stationId, vehicle = null) {
      await guard(150);
      return waitFor(findStation(stationId), vehicle);
    },

    async forecast(stationId): Promise<Forecast> {
      await guard(450);
      const s = findStation(stationId);
      const total = s.connectors.length;
      const freeNow = s.connectors.filter(c => c.status === 'available').length;
      const h = hash(stationId);
      const live = s.statusFeed.source === 'operator_feed';
      const next60 = Array.from({length: 12}, (_, i) => {
        const wave = Math.sin((i + (h % 5)) / 2.2) * 0.18;
        const drift = (freeNow / Math.max(total, 1) - 0.5) * 0.3 * (1 - i / 12);
        return Math.min(0.95, Math.max(0.08, 0.55 + wave + drift));
      });
      return {
        stationId,
        freeNow,
        total,
        next60,
        confidence: live ? 'medium' : 'low',
        basis: live ? 'history' : 'none',
      };
    },

    async community(stationId) {
      await guard(250);
      const now = Date.now();
      const base: CommunityUpdate[] = [
        {
          id: `${stationId}-u1`,
          stationId,
          kind: 'working',
          text: 'Working',
          at: now - 4 * 60_000,
          userConfirmed: true,
        },
        {
          id: `${stationId}-u2`,
          stationId,
          kind: 'bay_blocked',
          text: 'Bay C1 blocked by a parked car',
          at: now - 18 * 60_000,
          userConfirmed: true,
        },
        {
          id: `${stationId}-u3`,
          stationId,
          kind: 'price_confirmed',
          text: 'Price confirmed at the dispenser',
          at: now - 46 * 60_000,
          userConfirmed: true,
        },
      ];
      return [...(communityLog.get(stationId) ?? []), ...base];
    },

    async confirmStatus(stationId, kind) {
      await guard(250);
      const labels: Record<CommunityUpdate['kind'], string> = {
        working: 'Working',
        bay_blocked: 'A bay is blocked',
        price_confirmed: 'Price confirmed',
        busy: 'Busy right now',
      };
      const update: CommunityUpdate = {
        id: uid('cu'),
        stationId,
        kind,
        text: labels[kind],
        at: Date.now(),
        userConfirmed: true,
      };
      communityLog.set(stationId, [
        update,
        ...(communityLog.get(stationId) ?? []),
      ]);
      return update;
    },

    async report(report) {
      await guard(500);
      const now = Date.now();
      const number = `PO-${143 + appStore.get().tickets.length}`;
      const ticket = {
        id: uid('tk'),
        number,
        category: 'station' as const,
        title: `Station report: ${report.kind.replace('_', ' ')}`,
        status: 'open' as const,
        linkedSessionId: null,
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: uid('m'),
            from: 'user' as const,
            text: report.note || `Reported: ${report.kind}`,
            at: now,
          },
        ],
      };
      appStore.set(s => ({tickets: [ticket, ...s.tickets]}));
      return {ticketId: ticket.id};
    },

    async joinQueue(stationId): Promise<QueueTicket> {
      await guard(400);
      const s = findStation(stationId);
      // The nearest charger with known connectors, and only if it's a short
      // detour: a Google charger far from the demo data has no real backup.
      const backup =
        [...loadStations(), ...placesCache.values()]
          .filter(x => x.id !== stationId && x.connectors.length > 0)
          .map(x => withDistanceTo(x, s))
          .filter(x => x.distanceKm <= QUEUE_BACKUP_MAX_KM)
          .sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;
      const ticket: QueueTicket = {
        id: uid('q'),
        stationId,
        stationName: s.name,
        position: 2,
        joinedAt: Date.now(),
        wait: {
          minMinutes: 14,
          maxMinutes: 20,
          confidence: 'medium',
          basis: 'history',
        },
        backupStationName: backup?.name ?? 'Nearest alternative',
        backupExtraMin: backup
          ? Math.max(4, Math.round(backup.distanceKm * 1.6))
          : 6,
      };
      appStore.set({queue: ticket});
      return ticket;
    },

    async leaveQueue() {
      await guard(250);
      appStore.set({queue: null});
    },

    async reserve(stationId, arrivalAt, holdMinutes): Promise<Reservation> {
      await guard(500);
      const s = findStation(stationId);
      if (s.integration !== 'integrated') {
        throw new ApiError(
          'Reservations are only available at PlugOrbit partner chargers.',
        );
      }
      const connector =
        s.connectors.find(c => c.status === 'available') ?? s.connectors[0];
      const reservation: Reservation = {
        id: uid('rs'),
        stationId,
        stationName: s.name,
        connectorLabel: connector.label,
        arrivalAt,
        holdMinutes,
        status: 'held',
        createdAt: Date.now(),
      };
      appStore.set({reservation});
      return reservation;
    },

    async cancelReservation() {
      await guard(250);
      appStore.set({reservation: null});
    },
  };
}
