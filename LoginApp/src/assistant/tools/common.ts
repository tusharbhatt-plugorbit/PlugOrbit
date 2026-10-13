import {computeSessionMetrics} from '../../domain/charging';
import {
  availableCount,
  compatibleConnectors,
  effectivePowerKw,
  hasUnconfirmedConnectors,
  stationHealth,
} from '../../domain/rules';
import {dataTrust} from '../../domain/trust';
import type {
  FeedInfo,
  Route,
  RouteRequest,
  RouteStop,
  RouteStrategy,
  StationWithDistance,
  Vehicle,
} from '../../domain/types';
import type {Services} from '../../services/types';
import type {AppState} from '../../store/appStore';
import type {Coords} from '../../utils/geo';
import type {
  JourneyMemory,
  RememberedPreference,
  ToolEnvelope,
  ToolSource,
} from '../types';

/** Everything a tool may touch. Injected so tests run with fakes and no React. */
export type ToolDeps = {
  services: Services;
  getState: () => AppState;
  now: () => number;
  /** The phone's position, or why it is not available. */
  locate: () => Promise<{coords: Coords; outsideDemoArea: boolean}>;
  /** True while the services are the sample-data layer (RUNS_ON_DEMO_DATA). */
  demo: boolean;
  journey: () => JourneyMemory | null;
  remembered: () => RememberedPreference[];
};

export const STRATEGIES: readonly RouteStrategy[] = [
  'fastest',
  'cheapest',
  'reliable',
];

// ----------------------------------------------------------------- envelopes ---

export function source(
  deps: ToolDeps,
  kind: ToolSource['kind'],
  extra: Partial<ToolSource> = {},
): ToolSource {
  return {
    system: 'plugorbit_app',
    kind,
    as_of: deps.now(),
    demo: deps.demo && kind !== 'device_store' && kind !== 'device_gps',
    ...extra,
  };
}

export const ok = (
  data: ToolEnvelope['data'],
  src: ToolSource,
  assumptions: string[] = [],
  message?: string,
): ToolEnvelope => ({
  status: 'ok',
  data,
  source: src,
  ...(assumptions.length ? {assumptions} : {}),
  ...(message ? {message} : {}),
});

export const unavailable = (
  message: string,
  src?: ToolSource,
): ToolEnvelope => ({
  status: 'unavailable',
  message,
  ...(src ? {source: src} : {}),
});

export const unknown = (message: string, src?: ToolSource): ToolEnvelope => ({
  status: 'unknown',
  message,
  ...(src ? {source: src} : {}),
});

export const failed = (message: string): ToolEnvelope => ({
  status: 'error',
  message,
});

export const minutesAgo = (
  at: number | null | undefined,
  now: number,
): number | null =>
  at === null || at === undefined
    ? null
    : Math.max(0, Math.round((now - at) / 60000));

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export const inputs = {str, num};

// -------------------------------------------------------------------- places ---

export type PlaceMatch = {name: string} | {name: null; known: string[]};

/**
 * Match what the driver said to a place the planner knows. Case-insensitive,
 * exact first, then prefix, then contained. Never invents a place.
 */
export async function resolvePlace(
  deps: ToolDeps,
  text: string,
): Promise<PlaceMatch> {
  const known = await deps.services.route.suggestions('');
  const t = text.trim().toLowerCase();
  const found =
    known.find(k => k.toLowerCase() === t) ??
    known.find(k => k.toLowerCase().startsWith(t)) ??
    known.find(k => t.includes(k.toLowerCase()) || k.toLowerCase().includes(t));
  return found ? {name: found} : {name: null, known};
}

// ------------------------------------------------------------ route requests ---

export type PlanContext = {
  vehicle: Vehicle;
  request: RouteRequest;
  assumptions: string[];
  src: ToolSource;
};

/**
 * Turn a tool's arguments into a planner request, filling the gaps from the
 * driver's saved settings and saying so in `assumptions`. Returns an envelope
 * (not a request) when something required is missing.
 */
export async function buildRequest(
  deps: ToolDeps,
  input: Record<string, unknown>,
  overrides: {strategy?: RouteStrategy; avoid?: string[]} = {},
): Promise<PlanContext | ToolEnvelope> {
  const state = deps.getState();
  const vehicle =
    state.vehicles.find(v => v.id === state.activeVehicleId) ?? null;
  if (!vehicle) {
    return unavailable(
      'No car has been added yet. The driver can add one under Vehicles.',
    );
  }
  const journey = deps.journey();
  const assumptions: string[] = [];

  const startSoc =
    inputs.num(input.start_soc_percent) ?? state.battery?.percent;
  if (startSoc === undefined) {
    return unknown(
      'The battery level is not known. Ask the driver for it, or they can set it in Orbit Assist.',
    );
  }
  if (inputs.num(input.start_soc_percent) !== undefined) {
    assumptions.push(
      `Starting battery ${Math.round(startSoc)}% as stated by the driver.`,
    );
  } else if (state.battery) {
    const age = minutesAgo(state.battery.updatedAt, deps.now()) ?? 0;
    assumptions.push(
      `Starting battery ${Math.round(startSoc)}% (${
        state.battery.source === 'manual'
          ? 'typed by the driver'
          : state.battery.source === 'vehicle'
          ? 'read from the car'
          : 'the app’s own estimate'
      }, ${age} min old).`,
    );
  }

  const toText = inputs.str(input.destination) ?? journey?.destination;
  if (!toText) {
    return unknown('No destination yet. Ask the driver where they are going.');
  }
  const to = await resolvePlace(deps, toText);
  if (to.name === null) {
    return unavailable(
      `I can only plan to places the planner knows: ${to.known.join(
        ', ',
      )}. “${toText}” isn’t one of them.`,
    );
  }

  const fromText = inputs.str(input.origin) ?? journey?.origin;
  let fromName = 'Delhi';
  if (fromText) {
    const from = await resolvePlace(deps, fromText);
    if (from.name === null) {
      return unavailable(
        `I can only plan from places the planner knows: ${from.known.join(
          ', ',
        )}. “${fromText}” isn’t one of them.`,
      );
    }
    fromName = from.name;
  } else {
    assumptions.push(
      'Starting from Delhi, the planner’s default start. The planner needs a named start place, so GPS is not used to choose it.',
    );
  }
  if (fromName === to.name) {
    return unavailable(`The start and the destination are both ${fromName}.`);
  }

  const stated = inputs.num(input.min_arrival_soc_percent);
  const reserve =
    stated ?? journey?.min_arrival_soc_pct ?? state.tripPrefs.minArrivalSocPct;
  assumptions.push(
    `Arrival reserve ${Math.round(reserve)}% (${
      stated !== undefined || journey?.min_arrival_soc_pct !== undefined
        ? 'as the driver asked'
        : 'the driver’s saved setting'
    }).`,
  );

  const asked = inputs.str(input.strategy) as RouteStrategy | undefined;
  const strategy: RouteStrategy =
    overrides.strategy ??
    (asked && STRATEGIES.includes(asked) ? asked : undefined) ??
    journey?.strategy ??
    state.tripPrefs.strategy;
  const avoid = overrides.avoid ?? [];

  return {
    vehicle,
    assumptions,
    src: source(deps, 'deterministic_engine'),
    request: {
      fromLabel: fromName,
      toLabel: to.name,
      startSoc,
      strategy,
      vehicle,
      safetyReservePct: reserve,
      avoidPaidParking: state.tripPrefs.avoidPaidParking,
      ...(avoid.length ? {avoidStationIds: avoid} : {}),
    },
  };
}

export const isEnvelope = (v: PlanContext | ToolEnvelope): v is ToolEnvelope =>
  'status' in v;

export const MODEL_ASSUMPTIONS = [
  'Energy use comes from the car’s real-world range at 100% battery, at a steady average speed.',
  'Traffic, weather, elevation and air-conditioning are not included.',
];

// ----------------------------------------------------------------- summaries ---

function feedFacts(feed: FeedInfo, now: number) {
  return {
    trust: dataTrust(feed, now),
    source: feed.source,
    updated_min_ago: minutesAgo(feed.updatedAt, now),
  };
}

export function availabilityOf(
  s: StationWithDistance,
  vehicle: Vehicle | null,
  now: number,
) {
  const unconfirmed = hasUnconfirmedConnectors(s);
  return {
    status: unconfirmed ? 'unknown' : stationHealth(s, vehicle),
    free_connectors: unconfirmed ? null : availableCount(s, vehicle),
    ...feedFacts(s.statusFeed, now),
  };
}

export function summarizeStop(stop: RouteStop, vehicle: Vehicle, now: number) {
  const s = stop.station;
  const connector = s.connectors.find(c => c.id === stop.connectorId);
  return {
    station_id: s.id,
    name: s.name,
    operator: s.operator,
    detour_min: stop.detourMin,
    arrive_soc_percent: stop.arriveSoc,
    charge_to_soc_percent: stop.chargeToSoc,
    charge_min: stop.chargeMin,
    cost_inr: stop.costInr,
    connector: connector
      ? {
          id: connector.id,
          type: connector.type,
          power_kw: connector.powerKw,
          power_kw_for_this_car: effectivePowerKw(connector, vehicle),
          price_per_kwh: connector.pricePerKwh,
        }
      : null,
    availability: availabilityOf(s, vehicle, now),
    wait: {
      min_minutes: stop.wait.minMinutes,
      max_minutes: stop.wait.maxMinutes,
      confidence: stop.wait.confidence,
      basis: stop.wait.basis,
    },
    reliability_percent: s.reliabilityPct > 0 ? s.reliabilityPct : null,
    backup: stop.backup
      ? {
          station_id: stop.backup.id,
          name: stop.backup.name,
          extra_min: stop.backupExtraMin,
        }
      : null,
    ...(stop.backupNote ? {backup_note: stop.backupNote} : {}),
  };
}

/** Why the planner picked a stop, from the stop's own numbers. Deterministic. */
export function selectionBasis(
  stop: RouteStop,
  route: Route,
  vehicle: Vehicle,
): string[] {
  const out: string[] = [];
  const s = stop.station;
  const connector = s.connectors.find(c => c.id === stop.connectorId);
  if (connector) {
    out.push(
      `Has a ${
        connector.type
      } connector your car can use, about ${effectivePowerKw(
        connector,
        vehicle,
      )} kW for this car.`,
    );
  }
  out.push(
    `You would arrive with about ${stop.arriveSoc}%, above your ${route.safetyReservePct}% reserve.`,
  );
  if (route.strategy === 'fastest') {
    out.push('Chosen to keep the whole trip as quick as possible.');
  } else if (route.strategy === 'cheapest' && connector?.pricePerKwh != null) {
    out.push(`Chosen for price: ₹${connector.pricePerKwh} per kWh.`);
  } else if (route.strategy === 'reliable' && s.reliabilityPct > 0) {
    out.push(
      `Chosen for reliability: ${s.reliabilityPct}% of recent sessions worked.`,
    );
  }
  out.push(
    stop.backup
      ? `Backup if it fails: ${stop.backup.name}, ${stop.backupExtraMin} min extra.`
      : stop.backupNote ?? 'No backup charger is planned for this stop.',
  );
  if (compatibleConnectors(s, vehicle).length === 0) {
    out.push('Connector types are unconfirmed for this charger.');
  }
  return out;
}

export function summarizeRoute(route: Route, vehicle: Vehicle, now: number) {
  const known = route.stops
    .map(s => s.costInr)
    .filter((c): c is number => c !== null);
  return {
    from: route.fromLabel,
    to: route.toLabel,
    strategy: route.strategy,
    distance_km: route.distanceKm,
    total_minutes_including_charging: route.driveMin,
    start_soc_percent: route.startSoc,
    arrive_soc_percent: route.arriveSoc,
    reserve_percent: route.safetyReservePct,
    charging_needed: route.stops.length > 0,
    stop_count: route.stops.length,
    charging_cost_inr_known: known.length
      ? known.reduce((a, b) => a + b, 0)
      : route.stops.length
      ? null
      : 0,
    stops_without_published_price: route.stops.length - known.length,
    stops: route.stops.map(s => summarizeStop(s, vehicle, now)),
  };
}

export function sessionFacts(state: AppState, now: number) {
  const s = state.session;
  if (!s) {
    return null;
  }
  const m = computeSessionMetrics(s, now);
  return {
    status: s.status,
    station: s.stationName,
    connector: `${s.connectorLabel}`,
    power_kw: s.powerKw,
    price_per_kwh: s.pricePerKwh,
    start_soc_percent: s.startSoc,
    target_soc_percent: s.targetSoc,
    soc_now_percent: Math.round(m.socPercent),
    energy_kwh: Math.round(m.energyKwh * 10) / 10,
    elapsed_min: Math.round(m.elapsedMin),
    cost_so_far_inr: Math.round(m.costInr),
    minutes_to_target: Math.round(m.minToTarget),
    reached_target: m.reachedTarget,
    ...(s.failureReason ? {payment_problem: s.failureReason} : {}),
  };
}
