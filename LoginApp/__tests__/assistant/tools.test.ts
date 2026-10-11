import {DEVICE_TOOL_NAMES, createToolRunner} from '../../src/assistant/tools';
import type {ToolDeps} from '../../src/assistant/tools';
import {OfflineError, ApiError} from '../../src/services/types';
import {LocationError} from '../../src/services/location';
import {appStore} from '../../src/store/appStore';
import {
  NEXON,
  seedSignedIn,
  seedSmartDriveTrip,
} from '../../src/dev/testHarness';
import {noon} from '../../src/dev/smartDriveFixtures';
import {demoStore} from '../../src/store/demoStore';
import {makeDeps} from '../../src/dev/assistantToolDeps';

type Data = Record<string, any>;

async function run(
  deps: ToolDeps,
  name: string,
  input: Record<string, unknown> = {},
) {
  return createToolRunner(deps)({id: 't1', name, input});
}

beforeEach(() => {
  jest.useFakeTimers({advanceTimers: true});
  jest.setSystemTime(noon());
  seedSignedIn({soc: 60});
});
afterEach(() => {
  jest.useRealTimers();
  demoStore.set({offline: false});
});

describe('the device tool list', () => {
  it('matches the tools the gateway declares', () => {
    // Backend/app/ai/tools.py DEVICE_TOOLS. Update both together.
    expect([...DEVICE_TOOL_NAMES].sort()).toEqual(
      [
        'get_vehicle_status',
        'get_battery_level',
        'get_vehicle_compatibility',
        'get_current_location',
        'get_route_options',
        'get_chargers_along_route',
        'get_charger_details',
        'get_charger_availability',
        'estimate_route_energy',
        'recommend_charging_stops',
        'calculate_trip_cost',
        'get_active_charging_session',
        'get_user_preferences',
        'get_active_trip',
        'explain_plan',
      ].sort(),
    );
  });

  it('answers an unknown tool with an error, never a made-up result', async () => {
    const r = await run(makeDeps(), 'start_charging', {});
    expect(r.status).toBe('error');
    expect(r.data).toBeUndefined();
  });
});

describe('vehicle and battery', () => {
  it('reports the active car and the battery with where it came from', async () => {
    const r = await run(makeDeps(), 'get_vehicle_status');
    expect(r.status).toBe('ok');
    const d = r.data as Data;
    expect(d.vehicle.model).toBe(NEXON.model);
    expect(d.vehicle.connectors).toEqual(NEXON.connectors);
    expect(d.battery.percent).toBe(60);
    expect(d.battery.source).toMatch(/typed/);
  });

  it('says so when there is no car', async () => {
    appStore.set({vehicles: [], activeVehicleId: null});
    const r = await run(makeDeps(), 'get_vehicle_status');
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/add one/i);
  });

  it('labels a typed battery as user data, never live', async () => {
    const r = await run(makeDeps(), 'get_battery_level');
    expect(r.status).toBe('ok');
    expect(r.source?.trust).toBe('user');
    expect((r.data as Data).percent).toBe(60);
    expect((r.data as Data).estimated_range_km).toBe(
      Math.round((NEXON.rangeKm100 * 60) / 100),
    );
  });

  it('is unknown, not zero, when the battery was never set', async () => {
    appStore.set({battery: null});
    const r = await run(makeDeps(), 'get_battery_level');
    expect(r.status).toBe('unknown');
    expect(r.data).toBeUndefined();
  });

  it('never calls a sample vehicle reading live', async () => {
    appStore.set({
      battery: {percent: 55, source: 'vehicle', updatedAt: Date.now()},
      vehicleLink: {connected: true, method: 'obd', simulated: true},
    });
    const r = await run(makeDeps(), 'get_battery_level');
    expect(r.source?.trust).toBe('estimated');
    expect(r.source?.demo).toBe(true);
  });

  it('respects the privacy switch for car data', async () => {
    appStore.set({
      battery: {percent: 55, source: 'vehicle', updatedAt: Date.now()},
      privacy: {...appStore.get().privacy, vehicleBatteryData: false},
    });
    expect((await run(makeDeps(), 'get_battery_level')).status).toBe(
      'unavailable',
    );
  });

  it('checks a charger against the car’s connectors', async () => {
    const r = await run(makeDeps(), 'get_vehicle_compatibility', {
      station_id: 'st-chargezone-neemrana',
    });
    expect(r.status).toBe('ok');
    expect((r.data as Data).station.compatible).toBe(true);
    const missing = await run(makeDeps(), 'get_vehicle_compatibility', {
      station_id: 'st-nope',
    });
    expect(missing.status).toBe('unavailable');
  });
});

describe('location', () => {
  it('rounds the position and respects the privacy switch', async () => {
    const r = await run(
      makeDeps({
        locate: async () => ({
          coords: {latitude: 28.613987, longitude: 77.209123},
          outsideDemoArea: false,
        }),
      }),
      'get_current_location',
    );
    expect((r.data as Data).latitude).toBe(28.61);
    expect((r.data as Data).longitude).toBe(77.21);
    appStore.set({
      privacy: {...appStore.get().privacy, preciseLocation: false},
    });
    expect((await run(makeDeps(), 'get_current_location')).status).toBe(
      'unavailable',
    );
  });

  it('turns a denied permission into an unavailable answer', async () => {
    const r = await run(
      makeDeps({
        locate: async () => {
          throw new LocationError('denied', 'no');
        },
      }),
      'get_current_location',
    );
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/permission/i);
  });
});

describe('route intelligence', () => {
  it('compares the three plans to Jaipur from the real planner', async () => {
    const r = await run(makeDeps(), 'get_route_options', {
      destination: 'jaipur',
      min_arrival_soc_percent: 20,
    });
    expect(r.status).toBe('ok');
    const d = r.data as Data;
    expect(d.to).toBe('Jaipur');
    expect(d.reserve_percent).toBe(20);
    expect(d.options.map((o: Data) => o.strategy)).toEqual([
      'fastest',
      'cheapest',
      'reliable',
    ]);
    const feasible = d.options.filter((o: Data) => o.feasible);
    expect(feasible.length).toBeGreaterThan(0);
    for (const o of feasible) {
      expect(o.arrive_soc_percent).toBeGreaterThanOrEqual(20);
      expect(typeof o.stop_count).toBe('number');
    }
    expect(r.assumptions?.join(' ')).toMatch(/Delhi/);
    expect(r.assumptions?.join(' ')).toMatch(/Traffic, weather/);
    expect(r.source?.kind).toBe('deterministic_engine');
    expect(r.source?.demo).toBe(true);
  });

  it('can say a short trip needs no charging', async () => {
    appStore.set({
      battery: {percent: 95, source: 'manual', updatedAt: Date.now()},
    });
    const r = await run(makeDeps(), 'get_route_options', {
      destination: 'Gurgaon',
      origin: 'Delhi',
    });
    expect((r.data as Data).can_reach_without_charging).toBe(true);
  });

  it('refuses a place the planner does not know instead of guessing', async () => {
    const r = await run(makeDeps(), 'get_route_options', {
      destination: 'Atlantis',
    });
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/Jaipur/);
  });

  it('asks for the battery rather than assuming one', async () => {
    appStore.set({battery: null});
    expect(
      (await run(makeDeps(), 'get_route_options', {destination: 'Jaipur'}))
        .status,
    ).toBe('unknown');
    // A stated battery is used, and said so.
    const r = await run(makeDeps(), 'get_route_options', {
      destination: 'Jaipur',
      start_soc_percent: 80,
    });
    expect(r.status).toBe('ok');
    expect(r.assumptions?.join(' ')).toMatch(/80%.*stated by the driver/);
  });

  it('uses what the driver said about this journey, and says so', async () => {
    const deps = makeDeps({
      journey: () => ({
        destination: 'Jaipur',
        min_arrival_soc_pct: 25,
        strategy: 'cheapest',
        updated_at: Date.now(),
      }),
    });
    const r = await run(deps, 'recommend_charging_stops', {});
    expect(r.status).toBe('ok');
    const d = r.data as Data;
    expect(d.to).toBe('Jaipur');
    expect(d.reserve_percent).toBe(25);
    expect(d.strategy).toBe('cheapest');
    expect(r.assumptions?.join(' ')).toMatch(/as the driver asked/);
  });

  it('explains each stop and gives it a backup or an honest note', async () => {
    const r = await run(makeDeps(), 'recommend_charging_stops', {
      destination: 'Jaipur',
      min_arrival_soc_percent: 15,
    });
    const d = r.data as Data;
    expect(d.charging_needed).toBe(true);
    for (const s of d.stops) {
      expect(s.why_this_charger.length).toBeGreaterThan(2);
      expect(s.backup !== null || typeof s.backup_note === 'string').toBe(true);
      expect(s.availability.trust).toMatch(/live|estimated|user|unknown/);
      expect(s.cost_inr === null || typeof s.cost_inr === 'number').toBe(true);
    }
  });

  it('plans around a charger the driver rejected', async () => {
    const first = (
      await run(makeDeps(), 'recommend_charging_stops', {
        destination: 'Jaipur',
        min_arrival_soc_percent: 15,
      })
    ).data as Data;
    const rejected = first.stops[0].station_id as string;
    const again = await run(makeDeps(), 'recommend_charging_stops', {
      destination: 'Jaipur',
      min_arrival_soc_percent: 15,
      avoid_station_ids: [rejected],
    });
    const d = again.data as Data;
    expect(d.avoided_station_ids).toEqual([rejected]);
    expect(d.stops.map((s: Data) => s.station_id)).not.toContain(rejected);
  });

  it('checks the plan against a stop limit and offers the other priorities', async () => {
    appStore.set({
      battery: {percent: 40, source: 'manual', updatedAt: Date.now()},
    });
    const r = await run(makeDeps(), 'recommend_charging_stops', {
      destination: 'Jaipur',
      min_arrival_soc_percent: 15,
      max_stops: 0,
    });
    const d = r.data as Data;
    if (r.status === 'ok') {
      expect(d.meets_stop_limit).toBe(d.stop_count === 0);
      if (d.meets_stop_limit === false) {
        expect(d.other_priorities).toHaveLength(2);
      }
    }
  });

  it('sums only published prices and counts the rest separately', async () => {
    const r = await run(makeDeps(), 'calculate_trip_cost', {
      destination: 'Jaipur',
      min_arrival_soc_percent: 15,
    });
    const d = r.data as Data;
    const known = d.per_stop.filter((s: Data) => s.cost_inr !== null);
    expect(d.stops_without_published_price).toBe(
      d.per_stop.length - known.length,
    );
    if (known.length) {
      expect(d.total_charging_cost_inr).toBe(
        known.reduce((a: number, s: Data) => a + s.cost_inr, 0),
      );
    }
    expect(r.assumptions?.join(' ')).toMatch(/Excludes tolls/);
  });

  it('lists the battery after each leg', async () => {
    const r = await run(makeDeps(), 'estimate_route_energy', {
      destination: 'Jaipur',
      min_arrival_soc_percent: 15,
    });
    const d = r.data as Data;
    expect(d.legs[0]).toMatchObject({kind: 'start', soc_percent: 60});
    expect(d.legs[d.legs.length - 1].kind).toBe('arrive');
    expect(d.lowest_soc_percent).toBe(
      Math.min(...d.legs.map((l: Data) => l.soc_percent)),
    );
  });

  it('turns an impossible plan into an answer', async () => {
    const deps = makeDeps();
    deps.services.route.plan = async () => {
      throw new ApiError(
        'This trip needs more charging stops than are available. Try another strategy.',
      );
    };
    const r = await run(deps, 'recommend_charging_stops', {
      destination: 'Jaipur',
    });
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/more charging stops/);
  });

  it('says it is offline instead of inventing a plan', async () => {
    const deps = makeDeps();
    deps.services.route.plan = async () => {
      throw new OfflineError();
    };
    const r = await run(deps, 'recommend_charging_stops', {
      destination: 'Jaipur',
    });
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/offline/i);
  });
});

describe('charger facts', () => {
  it('never calls an estimated status live', async () => {
    const r = await run(makeDeps(), 'get_charger_availability', {
      station_id: 'st-chargezone-neemrana',
    });
    expect(r.status).toBe('ok');
    const d = r.data as Data;
    expect(['live', 'estimated', 'user', 'unknown']).toContain(
      d.overall_for_this_car.trust,
    );
    expect(r.source?.trust).toBe(d.overall_for_this_car.trust);
    expect(d.expected_wait.confidence).toMatch(/low|medium|high/);
    expect(d.queue_note).toBeTruthy();
    if (d.overall_for_this_car.trust !== 'live') {
      expect(r.assumptions?.join(' ')).toMatch(/NOT live/);
    }
  });

  it('gives full details with null instead of invented ratings', async () => {
    const r = await run(makeDeps(), 'get_charger_details', {
      station_id: 'st-chargezone-neemrana',
    });
    const d = r.data as Data;
    expect(d.connectors.length).toBeGreaterThan(0);
    expect(d.connectors[0]).toHaveProperty('fits_this_car');
    expect(d.rating === null || d.rating > 0).toBe(true);
    expect(
      (await run(makeDeps(), 'get_charger_details', {station_id: 'nope'}))
        .status,
    ).toBe('unavailable');
  });
});

describe('charging session and preferences', () => {
  it('reports no active session as a fact', async () => {
    const r = await run(makeDeps(), 'get_active_charging_session');
    expect((r.data as Data).active).toBe(false);
  });

  it('reports a session in progress with an estimated meter', async () => {
    seedSignedIn({session: 'active'});
    const r = await run(makeDeps(), 'get_active_charging_session');
    const d = r.data as Data;
    expect(d.active).toBe(true);
    expect(d.station).toMatch(/Neemrana/);
    expect(r.source?.trust).toBe('estimated');
  });

  it('keeps saved settings apart from what the assistant remembers', async () => {
    const deps = makeDeps({
      remembered: () => [
        {
          key: 'prioritise',
          value: 'cost',
          savedAt: Date.now() - 3 * 86_400_000,
        },
      ],
    });
    const d = (await run(deps, 'get_user_preferences')).data as Data;
    expect(d.saved_settings.min_arrival_soc_percent).toBe(
      appStore.get().tripPrefs.minArrivalSocPct,
    );
    expect(d.remembered_by_assistant_unverified).toEqual([
      {key: 'prioritise', value: 'cost', saved_days_ago: 3},
    ]);
  });
});

describe('the Orbit Assist journey', () => {
  it('says there is no journey when there is none', async () => {
    expect(
      ((await run(makeDeps(), 'get_active_trip')).data as Data).active,
    ).toBe(false);
    expect(
      (await run(makeDeps(), 'explain_plan', {question: 'why_here'})).status,
    ).toBe('unavailable');
  });

  it('describes the journey, its stop and its backup from the engine', async () => {
    seedSmartDriveTrip({started: true, km: 20});
    const r = await run(makeDeps(), 'get_active_trip');
    const d = r.data as Data;
    expect(d.active).toBe(true);
    expect(d.to).toBe('Jaipur');
    expect(d.position_is_simulated).toBe(true);
    expect(
      d.expected_arrival_soc_without_charging.low_percent,
    ).toBeLessThanOrEqual(d.expected_arrival_soc_without_charging.high_percent);
    expect(r.assumptions?.join(' ')).toMatch(/simulated/);
    if (d.charging_required) {
      expect(d.planned_stop.name).toBeTruthy();
      expect(d.planned_stop.why.length).toBeGreaterThan(0);
    }
  });

  it('passes on the engine’s own explanation', async () => {
    seedSmartDriveTrip({started: true, km: 20});
    const r = await run(makeDeps(), 'explain_plan', {question: 'battery'});
    expect(r.status).toBe('ok');
    expect(typeof (r.data as Data).answer).toBe('string');
    expect(
      (await run(makeDeps(), 'explain_plan', {question: 'nonsense'})).status,
    ).toBe('unavailable');
  });
});
