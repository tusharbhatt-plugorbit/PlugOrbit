/// <reference types="node" />
/**
 * The wire protocol, from the app's side. The Python gateway recorded a real conversation
 * (Backend/tests/fixtures/gateway_events.json); here it is played through the app's real
 * gateway client, controller and device tools. What the app sends back is recorded in
 * Backend/tests/fixtures/app_requests.json, which the Python tests validate and replay.
 *
 * Regenerate after a protocol change (see Backend/tests/test_ai_protocol.py):
 *   UPDATE_FIXTURES=1 npx jest __tests__/orbit-assist/protocol.test.ts
 */
import fs from 'fs';
import path from 'path';
import {AssistantController} from '../../src/assistant/controller';
import {createGateway} from '../../src/assistant/gateway';
import type {Transport} from '../../src/assistant/gateway';
import {
  assistantStore,
  resetAssistantStore,
  savePreference,
  updateSettings,
} from '../../src/assistant/store';
import {createToolRunner, DEVICE_TOOL_NAMES} from '../../src/assistant/tools';
import type {ToolEnvelope} from '../../src/assistant/types';
import {makeVoice} from '../../src/dev/assistantFakes';
import {makeDeps} from '../../src/dev/assistantToolDeps';
import {noon} from '../../src/dev/smartDriveFixtures';
import {seedSignedIn, seedSmartDriveTrip} from '../../src/dev/testHarness';
import {createMockServices} from '../../src/services';
import {OfflineError} from '../../src/services/types';
import {appStore} from '../../src/store/appStore';
import {demoStore} from '../../src/store/demoStore';

const FIXTURES = path.join(__dirname, '../../../Backend/tests/fixtures');
const EVENTS = path.join(FIXTURES, 'gateway_events.json');
const REQUESTS = path.join(FIXTURES, 'app_requests.json');
const TOOL_RESULTS = path.join(FIXTURES, 'device_tool_results.json');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

/** Keys and value types, so a fixture compares by structure, not by clock-dependent values. */
function shapeOf(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.length ? [shapeOf(v[0])] : [];
  }
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map(k => [k, shapeOf((v as Record<string, unknown>)[k])]),
    );
  }
  return v === null ? 'null' : typeof v;
}

const ndjson = (events: unknown[]) =>
  events.map(e => JSON.stringify(e)).join('\n') + '\n';

beforeAll(() =>
  jest.useFakeTimers({
    now: noon(),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'nextTick',
      'queueMicrotask',
    ],
  }),
);
afterAll(() => jest.useRealTimers());

describe('playing the gateway’s recorded conversation', () => {
  it('works end to end with the real client, controller and tools', async () => {
    const recorded = JSON.parse(fs.readFileSync(EVENTS, 'utf8')) as {
      first_call: unknown[];
      second_call: unknown[];
    };
    seedSignedIn({soc: 60});
    resetAssistantStore();
    updateSettings({
      aiConsentAt: 1,
      drivingMode: true,
      voiceLanguage: 'hinglish',
      rememberPreferences: true,
    });
    savePreference('prioritise', 'cost');
    assistantStore.set({
      journey: {
        destination: 'Jaipur',
        origin: 'Delhi',
        min_arrival_soc_pct: 15,
        strategy: 'reliable',
        max_stops: 2,
        selected_station_id: 'st-chargezone-neemrana',
        selected_station_name: 'ChargeZone • Neemrana',
        updated_at: Date.now(),
      },
    });

    const requests: Array<Record<string, unknown>> = [];
    const responses = [recorded.first_call, recorded.second_call];
    const transport: Transport = async req => {
      requests.push(JSON.parse(req.body!));
      const body = ndjson(responses[requests.length - 1]);
      // Deliver in awkward pieces, like a real network.
      for (let i = 0; i < body.length; i += 37) {
        req.onChunk?.(body.slice(i, i + 37));
      }
      return {status: 200, body};
    };
    const gateway = createGateway({
      baseUrl: 'http://gw',
      transport,
      getToken: async () => 'tok',
    });
    const voice = makeVoice();
    const deps = makeDeps({
      services: createMockServices(),
      journey: () => assistantStore.get().journey,
    });
    const run = createToolRunner(deps);
    const toolsRun: string[] = [];
    const controller = new AssistantController({
      gateway,
      runTool: async call => {
        toolsRun.push(call.name);
        return run(call);
      },
      performAction: async () => ({status: 'completed', message: 'ok'}),
      voice: voice.voice,
      demo: true,
    });
    assistantStore.set({
      recognizerAvailable: true,
      synthAvailable: true,
      microphone: 'granted',
    });

    await controller.send('Jaipur jaana hai, at least 20%', 'voice');
    await Promise.resolve();

    // The conversation played out as recorded.
    expect(toolsRun).toEqual(['recommend_charging_stops', 'get_battery_level']);
    const state = assistantStore.get();
    expect(state.sessionId).toBe('id1');
    expect(state.journey).toMatchObject({
      destination: 'Jaipur',
      min_arrival_soc_pct: 20,
    });
    const reply = state.messages.find(m => m.role === 'assistant')!;
    expect(reply.text).toBe(
      "Sure. Let me check. You need one charge, at Neemrana. Tap Start trip when you're ready.",
    );
    expect(reply.actions?.map(a => [a.kind, a.status])).toEqual([
      ['start_journey', 'pending_approval'],
      ['view_route', 'suggested'],
    ]);
    expect(voice.synthesizer.spoken.map(s => s.text)).toEqual([
      'Sure. Let me check.',
      'You need one charge, at Neemrana.',
      "Tap Start trip when you're ready.",
    ]);

    // What the app sent: a start, then results for exactly the tools that were requested.
    const [start, results] = requests as [
      Record<string, any>,
      Record<string, any>,
    ];
    expect(start.message).toBe('Jaipur jaana hai, at least 20%');
    expect(start.context).toMatchObject({
      input_mode: 'voice',
      driving_mode: true,
      voice_language: 'hinglish',
      demo_data: true,
    });
    expect(results).toMatchObject({session_id: 'id1', turn_id: 'id2'});
    expect(results.tool_results.map((r: any) => r.tool_use_id)).toEqual([
      'toolu_01',
      'toolu_02',
    ]);
    expect(results.message).toBeUndefined();
    const plan = results.tool_results[0];
    expect(plan.status).toBe('ok');
    expect(plan.data.to).toBe('Jaipur');
    expect(plan.data.reserve_percent).toBe(20); // from the journey memory the model just updated

    const recordedRequests = {turn_start: start, tool_results: results};
    if (UPDATE) {
      fs.writeFileSync(
        REQUESTS,
        JSON.stringify(recordedRequests, null, 2) + '\n',
      );
    }
    const committed = JSON.parse(fs.readFileSync(REQUESTS, 'utf8'));
    expect(shapeOf(recordedRequests)).toEqual(shapeOf(committed));
  });
});

describe('the results of the real device tools', () => {
  it('cover every tool, in good and in failing conditions, and match the recorded fixture', async () => {
    const out: Record<string, ToolEnvelope[]> = {};
    const record = async (
      name: string,
      input: Record<string, unknown>,
      deps = makeDeps(),
    ) => {
      const env = await createToolRunner(deps)({id: 'x', name, input});
      (out[name] ??= []).push(env);
    };
    const inputsFor: Record<string, Record<string, unknown>> = {
      get_vehicle_compatibility: {station_id: 'st-chargezone-neemrana'},
      get_route_options: {destination: 'Jaipur', min_arrival_soc_percent: 20},
      get_chargers_along_route: {destination: 'Jaipur'},
      get_charger_details: {station_id: 'st-chargezone-neemrana'},
      get_charger_availability: {station_id: 'st-chargezone-neemrana'},
      estimate_route_energy: {destination: 'Jaipur'},
      recommend_charging_stops: {destination: 'Jaipur', max_stops: 0},
      calculate_trip_cost: {destination: 'Jaipur'},
      explain_plan: {question: 'why_here'},
    };

    // Everything in order: a car, a battery, a journey in progress.
    seedSignedIn({soc: 60});
    seedSmartDriveTrip({started: true, km: 20});
    for (const name of DEVICE_TOOL_NAMES) {
      await record(name, inputsFor[name] ?? {});
    }
    // No journey, no battery, an unknown place, an unknown charger.
    seedSignedIn({soc: 60});
    appStore.set({battery: null});
    for (const name of [
      'get_battery_level',
      'get_route_options',
      'recommend_charging_stops',
      'estimate_route_energy',
    ]) {
      await record(name, inputsFor[name] ?? {});
    }
    appStore.set({vehicles: [], activeVehicleId: null});
    for (const name of [
      'get_vehicle_status',
      'get_route_options',
      'get_vehicle_compatibility',
    ]) {
      await record(name, inputsFor[name] ?? {});
    }
    seedSignedIn({soc: 60});
    await record('get_route_options', {destination: 'Atlantis'});
    await record('get_charger_details', {station_id: 'nope'});
    await record('get_charger_availability', {station_id: 'nope'});
    await record('explain_plan', {question: 'battery'});
    const offline = makeDeps();
    offline.services.route.plan = async () => {
      throw new OfflineError();
    };
    await record('recommend_charging_stops', {destination: 'Jaipur'}, offline);
    demoStore.set({locationDenied: false});
    await record(
      'get_current_location',
      {},
      makeDeps({
        locate: async () => {
          throw Object.assign(new Error('x'), {
            code: 'denied',
            name: 'LocationError',
          });
        },
      }),
    );

    expect(Object.keys(out).sort()).toEqual([...DEVICE_TOOL_NAMES].sort());
    const statuses = new Set(
      Object.values(out)
        .flat()
        .map(e => e.status),
    );
    expect(statuses).toEqual(
      new Set(['ok', 'unavailable', 'unknown', 'error']),
    );
    if (UPDATE) {
      fs.writeFileSync(TOOL_RESULTS, JSON.stringify(out, null, 2) + '\n');
    }
    const committed = JSON.parse(fs.readFileSync(TOOL_RESULTS, 'utf8'));
    expect(shapeOf(out)).toEqual(shapeOf(committed));
  });
});
