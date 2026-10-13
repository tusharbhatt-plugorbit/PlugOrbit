import {topReasons} from '../../intelligence/copy';
import type {BackupStop, ScoredStop, SocRange} from '../../intelligence/types';
import {ApiError} from '../../services/types';
import type {Route, RouteStrategy, Vehicle} from '../../domain/types';
import type {ToolEnvelope} from '../types';
import {
  MODEL_ASSUMPTIONS,
  PlanContext,
  STRATEGIES,
  ToolDeps,
  buildRequest,
  inputs,
  isEnvelope,
  minutesAgo,
  ok,
  selectionBasis,
  source,
  summarizeRoute,
  summarizeStop,
  unavailable,
} from './common';

/** Plan once, turning "no plan is possible" into an answer instead of a crash. */
async function planFor(
  deps: ToolDeps,
  ctx: PlanContext,
): Promise<{route: Route} | {envelope: ToolEnvelope}> {
  try {
    return {route: await deps.services.route.plan(ctx.request)};
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        envelope: unavailable(`No plan could be made: ${e.message}`, ctx.src),
      };
    }
    throw e;
  }
}

const strategyArg = (
  input: Record<string, unknown>,
): RouteStrategy | undefined => {
  const s = inputs.str(input.strategy) as RouteStrategy | undefined;
  return s && STRATEGIES.includes(s) ? s : undefined;
};

const avoidArg = (input: Record<string, unknown>): string[] =>
  Array.isArray(input.avoid_station_ids)
    ? input.avoid_station_ids
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 5)
    : [];

// ------------------------------------------------------------ route options ---

export async function getRouteOptions(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const base = await buildRequest(deps, input);
  if (isEnvelope(base)) {
    return base;
  }
  const options = await Promise.all(
    STRATEGIES.map(async strategy => {
      const ctx = await buildRequest(deps, input, {strategy});
      if (isEnvelope(ctx)) {
        return {
          strategy,
          feasible: false,
          reason: ctx.message ?? 'Not available.',
        };
      }
      const planned = await planFor(deps, ctx);
      if ('envelope' in planned) {
        return {
          strategy,
          feasible: false,
          reason: planned.envelope.message ?? 'No plan.',
        };
      }
      const r = summarizeRoute(planned.route, base.vehicle, deps.now());
      return {
        strategy,
        feasible: true,
        distance_km: r.distance_km,
        total_minutes_including_charging: r.total_minutes_including_charging,
        arrive_soc_percent: r.arrive_soc_percent,
        stop_count: r.stop_count,
        stops: planned.route.stops.map(s => s.station.name),
        charging_cost_inr_known: r.charging_cost_inr_known,
        stops_without_published_price: r.stops_without_published_price,
      };
    }),
  );
  const feasible = options.filter(o => o.feasible);
  return ok(
    {
      from: base.request.fromLabel,
      to: base.request.toLabel,
      start_soc_percent: Math.round(base.request.startSoc),
      reserve_percent: base.request.safetyReservePct,
      can_reach_without_charging: feasible.some(o => o.stop_count === 0),
      options,
    },
    base.src,
    [...base.assumptions, ...MODEL_ASSUMPTIONS],
  );
}

export async function getChargersAlongRoute(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const ctx = await buildRequest(deps, input, {strategy: strategyArg(input)});
  if (isEnvelope(ctx)) {
    return ctx;
  }
  const planned = await planFor(deps, ctx);
  if ('envelope' in planned) {
    return planned.envelope;
  }
  const r = summarizeRoute(planned.route, ctx.vehicle, deps.now());
  return ok(
    {
      from: r.from,
      to: r.to,
      strategy: r.strategy,
      charging_needed: r.charging_needed,
      chargers: r.stops,
    },
    ctx.src,
    [
      ...ctx.assumptions,
      'These are the chargers the plan would use, not every charger nearby.',
      'Availability is live only where its trust says so.',
    ],
    r.charging_needed
      ? undefined
      : 'No charging stop is needed for this trip at the current battery.',
  );
}

export async function estimateRouteEnergy(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const ctx = await buildRequest(deps, input, {strategy: strategyArg(input)});
  if (isEnvelope(ctx)) {
    return ctx;
  }
  try {
    const plan = await deps.services.route.energyPlan(ctx.request);
    return ok(
      {
        from: plan.route.fromLabel,
        to: plan.route.toLabel,
        distance_km: plan.route.distanceKm,
        reserve_percent: plan.route.safetyReservePct,
        lowest_soc_percent: plan.lowestSocPercent,
        meets_reserve: plan.lowestSocPercent >= plan.route.safetyReservePct,
        legs: plan.legs.map(l => ({
          label: l.label,
          soc_percent: l.socPercent,
          kind: l.kind,
        })),
      },
      ctx.src,
      [
        ...ctx.assumptions,
        ...MODEL_ASSUMPTIONS,
        'Battery after a stop is the planner’s charge target.',
      ],
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return unavailable(`No plan could be made: ${e.message}`, ctx.src);
    }
    throw e;
  }
}

export async function recommendChargingStops(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const ctx = await buildRequest(deps, input, {
    strategy: strategyArg(input),
    avoid: avoidArg(input),
  });
  if (isEnvelope(ctx)) {
    return ctx;
  }
  const planned = await planFor(deps, ctx);
  if ('envelope' in planned) {
    return planned.envelope;
  }
  const {route} = planned;
  const limit = inputs.num(input.max_stops);
  const meets = limit === undefined ? null : route.stops.length <= limit;
  const data: Record<string, unknown> = {
    ...summarizeRoute(route, ctx.vehicle, deps.now()),
    meets_stop_limit: meets,
    stops: route.stops.map(stop => ({
      ...summarizeStop(stop, ctx.vehicle, deps.now()),
      why_this_charger: selectionBasis(stop, route, ctx.vehicle),
    })),
    avoided_station_ids: ctx.request.avoidStationIds ?? [],
  };
  if (meets === false) {
    // Help the driver decide: what the other priorities would need.
    const others = await Promise.all(
      STRATEGIES.filter(s => s !== route.strategy).map(async strategy => {
        const c = await buildRequest(deps, input, {
          strategy,
          avoid: avoidArg(input),
        });
        if (isEnvelope(c)) {
          return {strategy, stop_count: null};
        }
        const p = await planFor(deps, c);
        return {
          strategy,
          stop_count: 'route' in p ? p.route.stops.length : null,
        };
      }),
    );
    data.other_priorities = others;
  }
  return ok(data, ctx.src, [
    ...ctx.assumptions,
    ...MODEL_ASSUMPTIONS,
    'A backup is planned for every stop where a reachable one exists.',
  ]);
}

export async function calculateTripCost(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const ctx = await buildRequest(deps, input, {strategy: strategyArg(input)});
  if (isEnvelope(ctx)) {
    return ctx;
  }
  const planned = await planFor(deps, ctx);
  if ('envelope' in planned) {
    return planned.envelope;
  }
  const {route} = planned;
  const known = route.stops.filter(s => s.costInr !== null);
  const total = known.reduce((sum, s) => sum + (s.costInr ?? 0), 0);
  return ok(
    {
      from: route.fromLabel,
      to: route.toLabel,
      strategy: route.strategy,
      charging_needed: route.stops.length > 0,
      total_charging_cost_inr:
        route.stops.length === 0 ? 0 : known.length ? total : null,
      stops_without_published_price: route.stops.length - known.length,
      per_stop: route.stops.map(s => ({
        name: s.station.name,
        cost_inr: s.costInr,
        energy_added_to_soc_percent: s.chargeToSoc,
      })),
    },
    ctx.src,
    [
      ...ctx.assumptions,
      'Includes GST on the energy price where the price is published.',
      'Excludes tolls, parking, idle fees and any platform fee.',
      'A stop with no published price is counted separately, never guessed.',
    ],
  );
}

// ------------------------------------------------------------- active trip ---

const band = (r: SocRange) => ({
  expected_percent: Math.round(r.expected),
  low_percent: Math.round(r.low),
  high_percent: Math.round(r.high),
});

function stopFacts(s: ScoredStop | BackupStop | null) {
  if (!s) {
    return null;
  }
  const m = s.metrics;
  return {
    station_id: s.station.id,
    name: s.station.name,
    operator: s.station.operator,
    minutes_until_arrival: Math.round(m.etaMin),
    distance_from_driver_km: Math.round(m.distanceFromDriverKm),
    arrive_soc: band(m.arriveSoc),
    charge_to_percent: Math.round(m.targetSoc),
    expected_kw_for_this_car: Math.round(m.expectedKw),
    charge_minutes: {
      min: Math.round(m.chargeMinutes.min),
      max: Math.round(m.chargeMinutes.max),
    },
    wait: {
      min_minutes: m.wait.minMinutes,
      max_minutes: m.wait.maxMinutes,
      confidence: m.wait.confidence,
      basis: m.wait.basis,
    },
    total_stop_minutes: {
      min: Math.round(m.totalStopMin.min),
      max: Math.round(m.totalStopMin.max),
    },
    cost_inr: m.cost.totalInr,
    why: topReasons(s.reasons, 3),
    data_confidence: s.dataConfidence,
    charge_confidence: s.chargeConfidence,
    caveats: s.warnings,
    ...('extraMin' in s
      ? {extra_minutes_vs_main_stop: Math.round(s.extraMin)}
      : {}),
  };
}

export async function getActiveTrip(deps: ToolDeps): Promise<ToolEnvelope> {
  const trip = deps.getState().smartDrive.trip;
  if (!trip || trip.monitoringState === 'ended') {
    return ok({active: false}, source(deps, 'deterministic_engine'));
  }
  const tripNow = deps.now() + trip.clockOffsetMs;
  const plan = trip.plan;
  return ok(
    {
      active: true,
      from: trip.origin.label,
      to: trip.destination.label,
      phase: trip.phase,
      monitoring: trip.monitoringState,
      network: trip.network,
      position_is_simulated: trip.position.source === 'simulated',
      minutes_to_destination: Math.max(
        0,
        Math.round((trip.eta - tripNow) / 60000),
      ),
      distance_remaining_km: Math.round(trip.distanceRemainingKm),
      battery_now_percent: Math.round(trip.currentSoC),
      reserve_percent: trip.reservePct,
      expected_arrival_soc_without_charging: band(
        plan.destination.socWithoutCharging,
      ),
      expected_arrival_soc_with_plan: plan.destination.socWithPlan
        ? band(plan.destination.socWithPlan)
        : null,
      charging_required: trip.chargingRequired,
      readiness: plan.readiness,
      route_risk: trip.routeRisk,
      limited_charger_options_ahead: plan.limitedOptions,
      planned_stop: stopFacts(trip.primaryStop),
      backup_stop: stopFacts(trip.backupStop),
      other_safe_options: plan.alternatives.slice(0, 3).map(a => ({
        station_id: a.station.id,
        name: a.station.name,
        cost_inr: a.metrics.cost.totalInr,
        total_stop_minutes: {
          min: Math.round(a.metrics.totalStopMin.min),
          max: Math.round(a.metrics.totalStopMin.max),
        },
      })),
      last_checked_min_ago: minutesAgo(trip.lastRecalculatedAt, tripNow),
    },
    source(deps, 'deterministic_engine', {
      trust: trip.dataConfidence ?? 'unknown',
    }),
    [
      trip.simulated
        ? 'The drive is simulated in this build: position and battery come from the app’s own model, not GPS or the car.'
        : 'Position comes from the phone.',
      'Arrival battery is a band, not a single number.',
      ...MODEL_ASSUMPTIONS,
    ],
  );
}

export async function explainPlan(
  deps: ToolDeps,
  input: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const question = inputs.str(input.question);
  const allowed = [
    'why_here',
    'skip',
    'cheaper',
    'faster',
    'backup',
    'battery',
  ] as const;
  if (!question || !(allowed as readonly string[]).includes(question)) {
    return unavailable('That question isn’t one the planner can answer.');
  }
  const trip = deps.getState().smartDrive.trip;
  if (!trip || trip.monitoringState === 'ended') {
    return unavailable(
      'No journey is in progress, so there is no plan to explain. Plan one first.',
    );
  }
  try {
    const answer = await deps.services.smartDrive.ask(
      question as (typeof allowed)[number],
    );
    return ok(
      {
        answer: answer.text,
        ...(answer.action ? {possible_action: answer.action} : {}),
      },
      source(deps, 'deterministic_engine', {
        trust: trip.dataConfidence ?? 'unknown',
      }),
      [
        'This answer is produced by the planner from its own numbers. Paraphrase it; do not add facts.',
      ],
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return unavailable(e.message);
    }
    throw e;
  }
}

export type {Vehicle};
