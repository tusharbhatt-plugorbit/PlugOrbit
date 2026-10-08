/**
 * @format
 * The mock Smart Drive service against the real store: the same path the app
 * takes, without any screen in the way.
 */
import {NEXON, seedSignedIn} from '../src/dev/testHarness';
import {noon} from '../src/dev/smartDriveFixtures';
import {sessionEvents} from '../src/intelligence/sessionBridge';
import {
  createSmartDriveService,
  resetSmartDriveMock,
} from '../src/services/mock/smartDriveService';
import {ApiError} from '../src/services/types';
import {appStore, resetAppStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';
import {liveSession} from '../src/dev/testHarness';
import type {ChargingSession} from '../src/domain/types';

const trip = () => appStore.get().smartDrive.trip!;
const told = () =>
  appStore.get().notifications.filter(n => n.source === 'smart_drive');

beforeEach(() => {
  // Fake only the clock, so opening hours never depend on when this runs.
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
  });
  seedSignedIn({soc: 72});
  resetSmartDriveMock();
});

afterEach(() => {
  jest.useRealTimers();
  demoStore.set({offline: false});
});

const start = (svc = createSmartDriveService()) =>
  svc.start({fromLabel: 'Delhi', toLabel: 'Jaipur'}).then(() => svc);

describe('starting a trip', () => {
  test('plans it, stores it, and is ready to go', async () => {
    const svc = createSmartDriveService();
    const t = await svc.start({fromLabel: 'Delhi', toLabel: 'Jaipur'});
    expect(t.phase).toBe('ready');
    expect(t.startSoC).toBe(72);
    expect(t.chargingRequired).toBe(true);
    expect(t.primaryStop).not.toBeNull();
    expect(t.backupStop).not.toBeNull();
    expect(appStore.get().smartDrive.trip?.tripId).toBe(t.tripId);
  });

  test('uses the reserve and the amenity preference you set', async () => {
    appStore.set(s => ({
      tripPrefs: {...s.tripPrefs, minArrivalSocPct: 20, preferAmenities: true},
    }));
    const t = await createSmartDriveService().start({
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
    });
    expect(t.reservePct).toBe(20);
    expect(t.preferAmenities).toBe(true);
    expect(t.primaryStop?.metrics.arriveSoc.low).toBeGreaterThanOrEqual(20);
  });

  test('says what is wrong in plain words', async () => {
    const svc = createSmartDriveService();
    await expect(
      svc.start({fromLabel: 'Delhi', toLabel: 'Delhi'}),
    ).rejects.toThrow(/same place/);
    await expect(
      svc.start({fromLabel: 'Delhi', toLabel: 'Atlantis'}),
    ).rejects.toThrow(/Choose a start and destination/);
    appStore.set({vehicles: [], activeVehicleId: null});
    await expect(
      svc.start({fromLabel: 'Delhi', toLabel: 'Jaipur'}),
    ).rejects.toThrow(/Add your vehicle/);
    appStore.set({battery: null});
    resetAppStore({
      vehicles: [NEXON],
      activeVehicleId: NEXON.id,
      battery: null,
    });
    await expect(
      createSmartDriveService().start({fromLabel: 'Delhi', toLabel: 'Jaipur'}),
    ).rejects.toBeInstanceOf(ApiError);
  });

  test('everything it stores survives a restart (plain data, no NaN)', async () => {
    await start();
    const saved = trip();
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });
});

describe('driving', () => {
  test('beginning welcomes the driver once', async () => {
    const svc = await start();
    await svc.begin();
    await svc.begin();
    expect(trip().phase).toBe('driving');
    expect(told().map(n => n.title)).toEqual(['You’re good to drive.']);
  });

  test('advancing moves the car, the clock and the battery together', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(30);
    expect(trip().progressKm).toBeCloseTo(30, 3);
    expect(trip().clockOffsetMs).toBeGreaterThan(20 * 60000);
    expect(trip().currentSoC).toBeCloseTo(62, 0);
    // The app's battery follows, labelled honestly as an estimate.
    expect(appStore.get().battery).toMatchObject({
      percent: 62,
      source: 'trip_estimate',
    });
  });

  test('the car stops at the planned charger; a second press drives on past it', async () => {
    const svc = await start();
    await svc.begin();
    const stop = trip().primaryStop!;
    await svc.advance(500);
    expect(trip().progressKm).toBeCloseTo(stop.alongKm, 1);
    expect(trip().phase).toBe('at_stop');
    await svc.advance(15);
    expect(trip().progressKm).toBeGreaterThan(stop.alongKm + 10);
  });

  test("notifications land in the app's notification list with their level", async () => {
    const svc = await start();
    await svc.begin();
    await svc.demo.driveToStop();
    const items = told();
    expect(items.length).toBeGreaterThan(1);
    items.forEach(n => {
      expect(n.read).toBe(false);
      expect(['info', 'action', 'important', 'critical']).toContain(n.level);
      expect(n.target?.route).toMatch(/^SmartDrive(Stop)?$/);
    });
    expect(items.some(n => n.level === 'action')).toBe(true);
  });
});

describe('things going wrong on the road', () => {
  test('a busy charger with a queue changes the plan, once', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(60);
    const before = trip().primaryStop!.station.id;
    await svc.demo.occupy(undefined, 6);
    expect(trip().primaryStop!.station.id).not.toBe(before);
    expect(trip().lastChange).toMatchObject({
      from: before,
      acknowledged: false,
    });
    expect(
      told().filter(n => n.title === 'We’ve found a better charging stop.'),
    ).toHaveLength(1);
  });

  test('an offline charger is replaced for safety', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(60);
    const before = trip().primaryStop!.station.id;
    await svc.demo.takeOffline();
    expect(trip().primaryStop!.station.id).not.toBe(before);
    expect(trip().lastChange?.reason).toBe('safety');
    await expect(svc.keepOriginal()).rejects.toThrow(/isn’t a safe choice/);
  });

  test('losing signal pauses monitoring and keeps the plan; it comes back by itself', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(30);
    const plan = trip().primaryStop!.station.id;
    await svc.demo.setSignal(false);
    expect(trip().network).toBe('offline');
    expect(trip().monitoringState).toBe('paused_offline');
    expect(trip().primaryStop!.station.id).toBe(plan);
    expect(told().some(n => n.title === 'You’re offline.')).toBe(true);
    await svc.demo.setSignal(true);
    expect(trip().network).toBe('online');
    expect(trip().monitoringState).toBe('monitoring');
  });

  test('the presenter\'s global "go offline" switch behaves the same way', async () => {
    const svc = await start();
    await svc.begin();
    demoStore.set({offline: true});
    await svc.tick();
    expect(trip().network).toBe('offline');
    demoStore.set({offline: false});
    await svc.tick();
    expect(trip().network).toBe('online');
  });
});

describe('the driver is in charge', () => {
  test('can switch to any safe option, and the choice is remembered as a signal', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(40);
    const alt = trip().plan.alternatives[0];
    await svc.switchTo(alt.station.id);
    expect(trip().primaryStop!.station.id).toBe(alt.station.id);
    expect(appStore.get().smartDrive.signals).toHaveLength(1);
    expect(appStore.get().smartDrive.signals[0]).toMatchObject({
      chosenId: alt.station.id,
    });
  });

  test('cannot be talked into an option the safety rules removed', async () => {
    const svc = await start();
    const ruled = trip().plan.ruledOut[0];
    await expect(svc.switchTo(ruled.stationId)).rejects.toThrow(
      /isn’t a safe option/,
    );
    await expect(svc.switchTo('st-does-not-exist')).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  test('can keep the charger that was planned before a (non-safety) change', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(60);
    const original = trip().primaryStop!.station.id;
    await svc.demo.occupy(undefined, 6);
    expect(trip().primaryStop!.station.id).not.toBe(original);
    await svc.keepOriginal();
    expect(trip().lastChange?.acknowledged).toBe(true);
    expect(trip().pinnedPrimaryId).toBe(original);
    expect(trip().primaryStop!.station.id).toBe(original);
  });

  test('"keep" works however far down the list the original has fallen', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(60);
    const original = trip().primaryStop!.station;
    await svc.demo.occupy(undefined, 6);
    // The record names the charger, so the undo is always on offer...
    expect(trip().lastChange?.fromName).toBe(original.name);
    // ...and succeeds because the planner says it is still safe.
    await svc.keepOriginal();
    expect(trip().primaryStop!.station.id).toBe(original.id);
  });

  test('"keep" is refused if the original has since become unsafe', async () => {
    const svc = await start();
    await svc.begin();
    await svc.advance(60);
    const original = trip().primaryStop!.station.id;
    await svc.demo.occupy(undefined, 6);
    // Now the charger we left goes dead.
    await svc.demo.takeOffline(original);
    const before = trip().primaryStop!.station.id;
    await expect(svc.keepOriginal()).rejects.toThrow(
      /isn’t a safe option right now/,
    );
    // A refused undo changes nothing.
    expect(trip().primaryStop!.station.id).toBe(before);
    expect(trip().pinnedPrimaryId).not.toBe(original);
  });

  test('can ask, and the answer comes from the plan', async () => {
    const svc = await start();
    const a = await svc.ask('why_here');
    expect(a.text.length).toBeGreaterThan(20);
    expect(a.reasons.length).toBeGreaterThan(0);
  });

  test('can turn Smart Drive off, and quiet mode on', async () => {
    const svc = await start();
    await svc.setEnabled(false);
    expect(trip().smartDriveEnabled).toBe(false);
    expect(appStore.get().smartDrive.prefs.enabled).toBe(false);
    await svc.setVerbosity('minimal');
    expect(appStore.get().smartDrive.prefs.verbosity).toBe('minimal');
    await svc.dismissSuggestion('faster');
    expect(appStore.get().smartDrive.dismissed).toEqual(['faster']);
  });
});

describe('finishing', () => {
  test('a trip with a charge records prediction versus reality', async () => {
    const svc = await start();
    await svc.begin();
    await svc.demo.driveToStop();
    const stop = trip().primaryStop!;
    await svc.report({
      type: 'SESSION_STARTED',
      stationId: stop.station.id,
      startSoc: trip().currentSoC,
      targetSoc: stop.metrics.targetSoc,
    });
    await svc.report({type: 'SESSION_ENDED', soc: stop.metrics.targetSoc});
    await svc.advance(400);
    expect(trip().phase).toBe('arrived');
    const outcome = await svc.end();
    expect(outcome).not.toBeNull();
    expect(outcome?.followedPlan).toBe(true);
    expect(appStore.get().smartDrive.outcomes).toHaveLength(1);
    expect(appStore.get().smartDrive.trip).toBeNull();
  });

  test('abandoning a trip that never charged records nothing', async () => {
    const svc = await start();
    expect(await svc.end()).toBeNull();
    expect(appStore.get().smartDrive.outcomes).toHaveLength(0);
    expect(appStore.get().smartDrive.trip).toBeNull();
  });

  test('with no trip, actions say so instead of crashing', async () => {
    const svc = createSmartDriveService();
    await expect(svc.begin()).rejects.toThrow(/no trip in progress/);
    await expect(svc.advance(10)).rejects.toThrow(/no trip in progress/);
    expect(await svc.tick()).toBeNull();
    expect(await svc.end()).toBeNull();
  });
});

describe('the bridge from the existing charging flow', () => {
  const at = (n: number) => noon() + n;
  const base = async () => {
    const svc = await start();
    await svc.begin();
    return trip();
  };

  test('nothing to report when there is no trip or it has not started', async () => {
    expect(sessionEvents(null, liveSession('active', at(0)), at(0))).toEqual(
      [],
    );
    const svc = await start();
    expect(sessionEvents(trip(), liveSession('active', at(0)), at(0))).toEqual(
      [],
    );
    await svc.begin();
  });

  test('a session starting is reported once', async () => {
    const t = await base();
    const s = liveSession('active', at(0));
    expect(sessionEvents(t, s, at(1000))).toEqual([
      {
        type: 'SESSION_STARTED',
        stationId: s.stationId,
        startSoc: s.startSoc,
        targetSoc: s.targetSoc,
      },
    ]);
  });

  test('progress and the target are reported, and only when new', async () => {
    const svc = await start();
    await svc.begin();
    const s: ChargingSession = {
      ...liveSession('active', noon()),
      startSoc: 40,
      targetSoc: 60,
      powerKw: 60,
      batteryKwh: 40.5,
    };
    await svc.report({
      type: 'SESSION_STARTED',
      stationId: s.stationId,
      startSoc: 40,
      targetSoc: 60,
    });
    const later = noon() + 60_000; // one minute of real time = 20 simulated
    const events = sessionEvents(trip(), s, later);
    expect(events.map(e => e.type)).toEqual(
      expect.arrayContaining(['BATTERY_UPDATED']),
    );
    await svc.report({type: 'TARGET_SOC_REACHED', soc: 60});
    expect(
      sessionEvents(trip(), s, later + 600_000).map(e => e.type),
    ).not.toContain('TARGET_SOC_REACHED');
  });

  test('a stopped session ends the charge; a failed payment is flagged once', async () => {
    const svc = await start();
    await svc.begin();
    const live = liveSession('active', noon());
    await svc.report({
      type: 'SESSION_STARTED',
      stationId: live.stationId,
      startSoc: 42,
      targetSoc: 80,
    });
    const failed = liveSession('payment_failed', noon());
    const events = sessionEvents(trip(), failed, noon() + 30_000);
    expect(events.map(e => e.type)).toEqual([
      'SESSION_ENDED',
      'PAYMENT_FAILED',
    ]);
    for (const e of events) {
      await svc.report(e);
    }
    expect(sessionEvents(trip(), failed, noon() + 40_000)).toEqual([]);
  });
});
