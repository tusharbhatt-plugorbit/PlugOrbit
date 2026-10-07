import {
  compatibleConnectors,
  availableCount,
  estimateDetourMin,
  isCompatible,
} from '../../domain/rules';
import type {
  CommunityUpdate,
  Forecast,
  QueueTicket,
  Reservation,
  Station,
  StationQuery,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from '../../domain/types';
import {hasGoogleApiKey} from '../../config/google';
import {appStore} from '../../store/appStore';
import {demoStore} from '../../store/demoStore';
import {distanceKm, Coords} from '../../utils/geo';
import {fetchNearbyChargers} from '../places';
import type {StationService} from '../types';
import {ApiError} from '../types';
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

/** Presenter override: the chosen (or default) charger becomes occupied. */
function applyDemoOverrides(stations: Station[]): Station[] {
  const demo = demoStore.get();
  if (!demo.stationOccupied) {
    return stations;
  }
  const targetId = appStore.get().chosen?.stationId ?? 'st-chargezone-neemrana';
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

/** Google Places results become external, estimated-only stations. */
async function googleStations(origin: Coords): Promise<Station[]> {
  if (!hasGoogleApiKey) {
    return [];
  }
  try {
    const chargers = await fetchNearbyChargers(origin);
    const now = Date.now();
    return chargers.map(c => ({
      id: `g-${c.id}`,
      name: c.name,
      operator: 'Google Maps',
      address: c.address ?? '',
      latitude: c.latitude,
      longitude: c.longitude,
      rating: 4,
      successfulSessionsPct: 0,
      reliabilityPct: 60,
      sponsored: false,
      hours: c.hours ?? 'Hours unknown',
      amenities: [],
      connectors: [
        {
          id: `g-${c.id}-c1`,
          label: 'C1',
          type: 'CCS2',
          powerKw: c.powerKw ?? 22,
          status:
            c.available === null
              ? 'unknown'
              : c.available > 0
              ? 'available'
              : 'occupied',
          pricePerKwh: null,
          idleFeePerMin: null,
        },
      ],
      integration: 'external',
      operatorInstructions:
        'This station comes from Google Maps. Use the operator’s own app or QR code to start and pay.',
      statusFeed: {source: 'google_places', updatedAt: now},
      priceFeed: {source: 'none', updatedAt: null},
    }));
  } catch {
    return [];
  }
}

export function waitFor(
  station: Station,
  vehicle: Vehicle | null,
): WaitEstimate {
  if (availableCount(station, vehicle) > 0) {
    return {
      minMinutes: 0,
      maxMinutes: 0,
      confidence: 'high',
      basis: 'live_queue',
    };
  }
  const connectors = compatibleConnectors(station, vehicle);
  if (connectors.length > 0 && connectors.every(c => c.status === 'offline')) {
    return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
  }
  if (station.statusFeed.source === 'operator_feed') {
    const base = 10 + (hash(station.id) % 8);
    return {
      minMinutes: base,
      maxMinutes: base + 8,
      confidence: 'medium',
      basis: 'history',
    };
  }
  return {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'};
}

const communityLog = new Map<string, CommunityUpdate[]>();

export function createStationService(): StationService {
  return {
    async nearby(query: StationQuery) {
      await guard();
      if (demoStore.get().noCompatible) {
        return [];
      }
      const [mock, google] = await Promise.all([
        Promise.resolve(loadStations()),
        googleStations(query.origin),
      ]);
      return [...mock, ...google]
        .map(s => withDistanceTo(s, query.origin))
        .filter(s => s.distanceKm <= 400)
        .filter(
          s => query.includeIncompatible || isCompatible(s, query.vehicle),
        )
        .sort((a, b) => a.distanceKm - b.distanceKm);
    },

    async get(stationId, origin) {
      await guard(200);
      const all = loadStations();
      const found = all.find(s => s.id === stationId);
      if (!found) {
        throw new ApiError('This station could not be found.');
      }
      return withDistanceTo(
        found,
        origin ?? {latitude: 28.6139, longitude: 77.209},
      );
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
      const s = loadStations().find(x => x.id === stationId);
      if (!s) {
        throw new ApiError('This station could not be found.');
      }
      return waitFor(s, vehicle);
    },

    async forecast(stationId): Promise<Forecast> {
      await guard(450);
      const s = loadStations().find(x => x.id === stationId);
      if (!s) {
        throw new ApiError('This station could not be found.');
      }
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
      const stations = loadStations();
      const s = stations.find(x => x.id === stationId);
      if (!s) {
        throw new ApiError('This station could not be found.');
      }
      const backup =
        stations
          .filter(x => x.id !== stationId && isCompatible(x, null))
          .map(x => withDistanceTo(x, s))
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
      const s = loadStations().find(x => x.id === stationId);
      if (!s) {
        throw new ApiError('This station could not be found.');
      }
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
