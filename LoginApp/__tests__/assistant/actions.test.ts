import {performAction} from '../../src/assistant/actions';
import type {ActionDeps} from '../../src/assistant/actions';
import {
  assistantStore,
  resetAssistantStore,
  updateSettings,
} from '../../src/assistant/store';
import type {AssistantAction} from '../../src/assistant/types';
import {noon} from '../../src/dev/smartDriveFixtures';
import {seedSignedIn, seedSmartDriveTrip} from '../../src/dev/testHarness';
import type {Navigation} from '../../src/navigation/NavigationContext';
import {createMockServices} from '../../src/services';
import {ApiError} from '../../src/services/types';
import {appStore} from '../../src/store/appStore';
import {makeDeps} from '../../src/dev/assistantToolDeps';

const act = (
  kind: AssistantAction['kind'],
  params: Record<string, unknown>,
): AssistantAction => ({
  id: 'a1',
  kind,
  label: 'Do it',
  params,
  status: 'pending_approval',
});

function rig(over: Partial<ActionDeps['tools']> = {}) {
  const calls: Array<[string, unknown]> = [];
  const nav = {
    navigate: (name: string, params?: unknown) => calls.push([name, params]),
  } as unknown as Navigation;
  const deps: ActionDeps = {tools: makeDeps(over), getNav: () => nav};
  return {deps, calls};
}

beforeEach(() => {
  jest.useFakeTimers({advanceTimers: true});
  jest.setSystemTime(noon());
  seedSignedIn({soc: 72});
  resetAssistantStore();
});
afterEach(() => jest.useRealTimers());

describe('opening screens', () => {
  it('opens the route the assistant described, planned by the real planner', async () => {
    const {deps, calls} = rig();
    const r = await performAction(
      act('view_route', {destination: 'Jaipur'}),
      deps,
    );
    expect(r).toEqual({
      status: 'completed',
      message: 'Opened the route to Jaipur.',
    });
    expect(calls).toEqual([['RouteResult', undefined]]);
    expect(appStore.get().activeRoute?.toLabel).toBe('Jaipur');
  });

  it('refuses a destination the planner does not know, and opens nothing', async () => {
    const {deps, calls} = rig();
    const r = await performAction(
      act('view_route', {destination: 'Atlantis'}),
      deps,
    );
    expect(r.status).toBe('unavailable');
    expect(calls).toEqual([]);
  });

  it('compares chargers only if they all exist', async () => {
    const {deps, calls} = rig();
    expect(
      (
        await performAction(
          act('compare_chargers', {
            station_ids: ['st-chargezone-neemrana', 'st-nope'],
          }),
          deps,
        )
      ).status,
    ).toBe('failed');
    expect(calls).toEqual([]);
    const ids = ['st-chargezone-neemrana', 'st-chargezone-neemrana'];
    expect(
      (await performAction(act('compare_chargers', {station_ids: ids}), deps))
        .status,
    ).toBe('completed');
    expect(calls).toEqual([['Compare', {stationIds: ids}]]);
  });

  it('opens a charger and directions to it', async () => {
    const {deps, calls} = rig();
    await performAction(
      act('view_charger', {station_id: 'st-chargezone-neemrana'}),
      deps,
    );
    await performAction(
      act('start_navigation', {station_id: 'st-chargezone-neemrana'}),
      deps,
    );
    expect(calls).toEqual([
      ['StationDetail', {stationId: 'st-chargezone-neemrana'}],
      ['Navigation', {stationId: 'st-chargezone-neemrana'}],
    ]);
    expect(
      (await performAction(act('view_charger', {station_id: 'nope'}), deps))
        .status,
    ).toBe('failed');
  });

  it('says it cannot act when the app has no navigation yet', async () => {
    const r = await performAction(act('view_charger', {station_id: 'x'}), {
      tools: makeDeps(),
      getNav: () => null,
    });
    expect(r.status).toBe('unavailable');
  });
});

describe('the charging screen', () => {
  it('opens the start screen for a charger PlugOrbit controls, leaving payment to that screen', async () => {
    const {deps, calls} = rig();
    const r = await performAction(
      act('open_charging_screen', {station_id: 'st-chargezone-neemrana'}),
      deps,
    );
    expect(r.status).toBe('completed');
    expect(r.message).toMatch(/You confirm and pay there/);
    expect(calls[0][0]).toBe('StartCharging');
    // Opening a screen started nothing.
    expect(appStore.get().session).toBeNull();
  });

  it('is honest when PlugOrbit cannot start charging at that charger', async () => {
    const services = createMockServices();
    const station = await services.station.get('st-chargezone-neemrana');
    services.station.get = async () => ({...station, integration: 'external'});
    const {deps, calls} = rig({services});
    const r = await performAction(
      act('open_charging_screen', {station_id: station.id}),
      deps,
    );
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/can’t start charging/);
    expect(calls[0][0]).toBe('StationDetail');
    expect(appStore.get().session).toBeNull();
  });
});

describe('journeys', () => {
  it('starts an Orbit Assist journey only when approved, and does not set off', async () => {
    const {deps, calls} = rig();
    expect(appStore.get().smartDrive.trip).toBeNull();
    const r = await performAction(
      act('start_journey', {destination: 'Jaipur', origin: 'Delhi'}),
      deps,
    );
    expect(r.status).toBe('completed');
    const trip = appStore.get().smartDrive.trip!;
    expect(trip.destination.label).toBe('Jaipur');
    expect(trip.phase).toBe('ready'); // planned, not driving: the driver sets off
    expect(calls[0]).toEqual(['SmartDrive', {toLabel: 'Jaipur'}]);
    expect(assistantStore.get().journey?.destination).toBe('Jaipur');
  });

  it('reports a failed start as failed', async () => {
    const services = createMockServices();
    services.smartDrive.start = async () => {
      throw new ApiError('Set your battery first so we know where you start.');
    };
    const {deps, calls} = rig({services});
    const r = await performAction(
      act('start_journey', {destination: 'Jaipur'}),
      deps,
    );
    expect(r).toEqual({
      status: 'failed',
      message: 'Set your battery first so we know where you start.',
    });
    expect(calls).toEqual([]);
  });

  it('will not start without a battery or a car', async () => {
    appStore.set({battery: null});
    const {deps} = rig();
    expect(
      (await performAction(act('start_journey', {destination: 'Jaipur'}), deps))
        .status,
    ).toBe('unavailable');
  });

  it('switches the planned charger on the journey in progress', async () => {
    seedSmartDriveTrip({started: true, km: 20});
    const trip = appStore.get().smartDrive.trip!;
    const alt = trip.plan.backup ?? trip.plan.alternatives[0];
    expect(alt).toBeTruthy();
    const {deps} = rig();
    const r = await performAction(
      act('switch_charger', {station_id: alt.station.id}),
      deps,
    );
    expect(r.status).toBe('completed');
    expect(appStore.get().smartDrive.trip?.plan.primary?.station.id).toBe(
      alt.station.id,
    );
  });

  it('refuses to switch to a charger that is not a safe option', async () => {
    seedSmartDriveTrip({started: true, km: 20});
    const {deps} = rig();
    const r = await performAction(
      act('switch_charger', {station_id: 'st-nowhere'}),
      deps,
    );
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/safe option/);
  });

  it('has nothing to switch when no journey is under way', async () => {
    const {deps} = rig();
    expect(
      (await performAction(act('switch_charger', {station_id: 'x'}), deps))
        .status,
    ).toBe('unavailable');
  });
});

describe('saving preferences', () => {
  it('updates the real arrival reserve setting', async () => {
    const {deps} = rig();
    const r = await performAction(
      act('save_preference', {key: 'min_arrival_soc_pct', value: 25}),
      deps,
    );
    expect(r.status).toBe('completed');
    expect(appStore.get().tripPrefs.minArrivalSocPct).toBe(25);
  });

  it('updates the route priority', async () => {
    const {deps} = rig();
    await performAction(
      act('save_preference', {key: 'strategy', value: 'cheapest'}),
      deps,
    );
    expect(appStore.get().tripPrefs.strategy).toBe('cheapest');
  });

  it('will not remember a preference without consent, then does with it', async () => {
    const {deps} = rig();
    const a = act('save_preference', {key: 'prioritise', value: 'cost'});
    const refused = await performAction(a, deps);
    expect(refused.status).toBe('unavailable');
    expect(assistantStore.get().preferences).toEqual([]);
    const saved = await performAction(a, deps, {consent: true});
    expect(saved.status).toBe('completed');
    expect(assistantStore.get().settings.rememberPreferences).toBe(true);
    expect(assistantStore.get().preferences.map(p => [p.key, p.value])).toEqual(
      [['prioritise', 'cost']],
    );
  });

  it('saves when consent was already given', async () => {
    updateSettings({rememberPreferences: true});
    const {deps} = rig();
    expect(
      (
        await performAction(
          act('save_preference', {
            key: 'preferred_network',
            value: 'Tata Power',
          }),
          deps,
        )
      ).status,
    ).toBe('completed');
  });
});
