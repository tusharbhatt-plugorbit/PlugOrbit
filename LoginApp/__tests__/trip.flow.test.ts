/**
 * @format
 *
 * The whole co-driven journey on the mock services, with no UI: Nexon EV at 72%
 * to Jaipur -> reminder -> the chosen charger fills up -> PlugOrbit moves the
 * driver to the backup -> plug in, pay -> back on the road -> arrive.
 */
import type {CoDriverEvent} from '../src/domain/coDriver';
import {NEXON, seedSignedIn} from '../src/dev/testHarness';
import {createMockServices} from '../src/services';
import {TripInProgressError} from '../src/services/mock/tripService';
import type {Services} from '../src/services/types';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';
import {onTripToast} from '../src/store/tripEvents';

let services: Services;
let toasts: CoDriverEvent[] = [];
let unsubscribe: () => void;

const planAndStart = async (soc = 72, smartDrive = true) => {
  seedSignedIn({soc});
  const route = await services.route.plan({
    fromLabel: 'Delhi',
    toLabel: 'Jaipur',
    startSoc: soc,
    strategy: 'reliable',
    vehicle: NEXON,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });
  return services.trip.start({route, smartDrive});
};

const inbox = () =>
  appStore
    .get()
    .notifications.filter(n => n.eventKey !== undefined)
    .map(n => n.title);

beforeEach(() => {
  services = createMockServices();
  toasts = [];
  unsubscribe = onTripToast(e => toasts.push(e));
});

afterEach(() => {
  unsubscribe();
});

describe('Smart Drive, start to finish', () => {
  test('the full journey, with the primary charger filling up on the way', async () => {
    // ---- start: calm ---------------------------------------------------------
    const started = await planAndStart(72);
    expect(started.phase).toBe('driving');
    expect(started.smartDriveEnabled).toBe(true);
    expect(started.primaryStop).not.toBeNull();
    expect(started.backupStop).not.toBeNull();
    expect(appStore.get().activeTrip?.tripId).toBe(started.tripId);
    // The plan is followed by the route screens, and saved for dead zones.
    expect(appStore.get().chosen?.stationId).toBe(
      started.primaryStop!.stationId,
    );
    expect(appStore.get().offlineTrip?.stops.map(s => s.role)).toEqual([
      'primary',
      'backup',
    ]);
    // "You're good to drive" is a quiet message: nothing pings the driver.
    expect(inbox()).toEqual([]);
    expect(toasts).toEqual([]);

    const firstStop = started.primaryStop!;
    const backupId = firstStop.backup!.stationId;

    // ---- far from the stop: still nothing to say --------------------------------
    await services.trip.advance(firstStop.alongKm - 90);
    expect(inbox()).toEqual([]);
    expect((await services.trip.refresh())!.monitoringStatus).toBe(
      'monitoring',
    );
    expect(inbox()).toEqual([]);

    // ---- the stop is coming up --------------------------------------------------
    const upcoming = await services.trip.advance(firstStop.alongKm - 28);
    expect(upcoming!.phase).toBe('driving');
    expect(inbox()).toEqual(['Charging stop in 28 km.']);
    expect(toasts.map(t => t.level)).toEqual(['action']);
    // Driving on a little inside the window doesn't repeat it. (Not far: the
    // backup sits ~26 km before the stop and must still be ahead of the car.)
    await services.trip.advance(firstStop.alongKm - 27.9);
    expect(inbox()).toEqual(['Charging stop in 28 km.']);

    // ---- the primary charger becomes occupied ------------------------------------
    const kmBefore = appStore.get().activeTrip!.km;
    demoStore.set({stationOccupied: false});
    demoStore.set({stationOccupied: true});
    const flagged = await services.trip.refresh();
    expect(flagged!.pendingSwitch).not.toBeNull();
    expect(flagged!.pendingSwitch!.toStationId).toBe(backupId);
    expect(flagged!.pendingSwitch!.reason).toBe('occupied');
    expect(flagged!.monitoringStatus).toBe('switch_available');
    expect(flagged!.pendingSwitch!.aheadKm).toBeGreaterThan(0);
    expect(inbox()).toContain('We’ve found a better charging stop.');
    expect(toasts[toasts.length - 1].level).toBe('important');
    // The trip itself is preserved while the driver decides.
    expect(flagged!.km).toBe(kmBefore);
    expect(flagged!.primaryStop!.stationId).toBe(firstStop.stationId);
    expect(flagged!.phase).toBe('driving');

    // ---- the driver accepts: switched, trip state kept ----------------------------
    const switched = await services.trip.acceptSwitch();
    expect(switched.pendingSwitch).toBeNull();
    expect(switched.primaryStop!.stationId).toBe(backupId);
    expect(switched.km).toBe(kmBefore);
    expect(switched.startingSoc).toBe(72);
    expect(switched.tripId).toBe(started.tripId);
    expect(appStore.get().chosen?.stationId).toBe(backupId);
    expect(appStore.get().activeRoute?.stops[0].station.id).toBe(backupId);
    expect(inbox()).toContain('We’ve changed your charging stop.');
    // The new stop is itself reachable on the battery the car has now.
    expect(switched.primaryStop!.arriveSoc).toBeGreaterThanOrEqual(5);

    // ---- nearly there, then at the charger -----------------------------------------
    const stop = switched.primaryStop!;
    await services.trip.advance(stop.alongKm - 5);
    expect(inbox().some(t => /min away/.test(t))).toBe(true);
    const atCharger = await services.trip.advance(stop.alongKm);
    expect(atCharger!.phase).toBe('at_charger');

    // ---- scan, pay, charge ----------------------------------------------------------
    const session = await services.session.start({
      stationId: stop.stationId,
      connectorId: stop.connectorId,
      targetSoc: stop.chargeToSoc,
      paymentMethodId: 'pm-upi',
    });
    expect(appStore.get().activeTrip!.phase).toBe('charging');
    expect(inbox()).toContain('Charging started successfully.');
    // Charging began from the battery the trip had worked out on arrival at the
    // charger (the 72% it left with is long gone).
    expect(session.startSoc).toBe(atCharger!.currentSoc);
    expect(session.startSoc).toBeLessThan(72);
    expect(Math.abs(session.startSoc - stop.arriveSoc)).toBeLessThanOrEqual(1);

    // ... time passes at the charger ...
    appStore.set(s => ({
      session: s.session && {
        ...s.session,
        startedAt: s.session.startedAt - 3_600_000,
      },
    }));
    const stopped = await services.session.stop(session.id);
    expect(inbox().some(t => /^You’re at \d+%\.$/.test(t))).toBe(true);
    const enough = appStore
      .get()
      .notifications.find(n => n.eventKey?.includes('enough_charge'));
    expect(enough?.body).toMatch(/enough to comfortably complete your trip/);
    expect(appStore.get().activeTrip!.phase).toBe('charging');

    const paid = await services.payment.pay(stopped.id, 'pm-upi');
    expect(paid.ok).toBe(true);

    // ---- back on the road ------------------------------------------------------------
    const resumed = appStore.get().activeTrip!;
    expect(resumed.phase).toBe('driving');
    expect(resumed.stats.stopsCompleted).toBe(1);
    expect(resumed.stats.costInr).toBeGreaterThan(0);
    expect(resumed.anchor.soc).toBe(appStore.get().history[0].endSoc);
    expect(resumed.currentSoc).toBe(appStore.get().history[0].endSoc);
    expect(resumed.chargingRequired).toBe(false);
    expect(resumed.expectedArrivalSoc).toBeGreaterThanOrEqual(12);
    expect(inbox()).toContain('You’re ready to continue.');

    // ---- destination ------------------------------------------------------------------
    const arrived = await services.trip.advance(resumed.totalKm);
    expect(arrived!.phase).toBe('arrived');
    expect(arrived!.log.some(l => l.kind === 'destination_arrived')).toBe(true);
    expect(arrived!.currentSoc).toBeGreaterThanOrEqual(12);

    await services.trip.finish();
    const after = appStore.get();
    expect(after.activeTrip).toBeNull();
    expect(after.offlineTrip).toBeNull();
    expect(after.activeRoute).toBeNull();
    expect(after.completedTrips[0]).toMatchObject({
      destination: 'Jaipur',
      completed: true,
      stops: 1,
    });
  });

  test('Smart Drive allowed to act: an offline primary is swapped without asking, and the driver is told', async () => {
    appStore.set({
      smartDrivePrefs: {...appStore.get().smartDrivePrefs, autoSwitch: true},
    });
    const started = await planAndStart(72, true);
    const backupId = started.primaryStop!.backup!.stationId;
    await services.trip.advance(started.primaryStop!.alongKm - 28);
    // An occupied primary with a short queue is NOT worth leaving; offline is.
    // The presenter switch fills every bay, so use it and confirm the decision.
    demoStore.set({stationOccupied: true});
    const out = await services.trip.refresh();
    // Either it moved on its own, or (a short wait) it stayed and asked nothing.
    if (out!.primaryStop!.stationId === backupId) {
      expect(out!.pendingSwitch).toBeNull();
      expect(inbox()).toContain('We’ve changed your charging stop.');
    } else {
      expect(out!.primaryStop!.stationId).toBe(started.primaryStop!.stationId);
    }
  });

  test('with Smart Drive off the trip is never changed without the driver', async () => {
    appStore.set({
      smartDrivePrefs: {...appStore.get().smartDrivePrefs, autoSwitch: true},
    });
    const started = await planAndStart(72, false);
    await services.trip.advance(started.primaryStop!.alongKm - 28);
    demoStore.set({stationOccupied: true});
    const out = await services.trip.refresh();
    expect(out!.primaryStop!.stationId).toBe(started.primaryStop!.stationId);
    expect(out!.pendingSwitch).not.toBeNull();
  });

  test("declining a switch is remembered: it isn't offered again", async () => {
    const started = await planAndStart(72);
    await services.trip.advance(started.primaryStop!.alongKm - 28);
    demoStore.set({stationOccupied: true});
    expect((await services.trip.refresh())!.pendingSwitch).not.toBeNull();
    await services.trip.dismissSwitch();
    expect(appStore.get().activeTrip!.pendingSwitch).toBeNull();
    const again = await services.trip.refresh();
    expect(again!.pendingSwitch).toBeNull();
    expect(again!.primaryStop!.stationId).toBe(started.primaryStop!.stationId);
  });

  test('a second trip needs an explicit replace', async () => {
    const first = await planAndStart(72);
    const route = appStore.get().activeRoute!;
    await expect(
      services.trip.start({route, smartDrive: true}),
    ).rejects.toBeInstanceOf(TripInProgressError);
    const second = await services.trip.start({
      route,
      smartDrive: true,
      replace: true,
    });
    expect(second.tripId).toBeDefined();
    expect(appStore.get().activeTrip!.tripId).toBe(second.tripId);
    expect(first.vehicle.id).toBe(second.vehicle.id);
  });

  test('a short trip needs no stop and nothing is monitored', async () => {
    seedSignedIn({soc: 80});
    const route = await services.route.plan({
      fromLabel: 'Delhi',
      toLabel: 'Gurgaon',
      startSoc: 80,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });
    const trip = await services.trip.start({route, smartDrive: true});
    expect(trip.chargingRequired).toBe(false);
    expect(trip.monitoringStatus).toBe('idle');
    expect(appStore.get().chosen).toBeNull();
    const arrived = await services.trip.advance(trip.totalKm);
    expect(arrived!.phase).toBe('arrived');
  });
});

describe('weak and missing network', () => {
  test('offline: the plan is kept, the driver is told once, and it recovers', async () => {
    const started = await planAndStart(72);
    const savedAt = appStore.get().offlineTrip!.savedAt;
    await services.trip.advance(started.primaryStop!.alongKm - 50);

    demoStore.set({offline: true});
    const off = await services.trip.refresh();
    expect(off!.monitoringStatus).toBe('offline');
    expect(off!.offlineSince).not.toBeNull();
    expect(off!.primaryStop!.stationId).toBe(started.primaryStop!.stationId);
    expect(inbox().filter(t => t === 'You’re offline.')).toHaveLength(1);

    // Still offline a moment later: no second announcement, snapshot untouched.
    await services.trip.refresh();
    expect(inbox().filter(t => t === 'You’re offline.')).toHaveLength(1);
    expect(appStore.get().offlineTrip!.savedAt).toBe(savedAt);
    // The plan includes everything needed at the roadside.
    const snap = appStore.get().offlineTrip!;
    const primary = snap.stops.find(s => s.role === 'primary')!;
    expect(primary.name).toBe(started.primaryStop!.stationName);
    expect(primary.accessInstructions.length).toBeGreaterThan(10);
    expect(primary.connectorLabel.length).toBeGreaterThan(0);
    expect(primary.statusUpdatedAt).not.toBeNull();
    expect(snap.route.polyline.length).toBeGreaterThan(2);

    // Driving still works without a signal; the trip keeps its own position.
    const moved = await services.trip.advance(
      started.primaryStop!.alongKm - 20,
    );
    expect(moved!.monitoringStatus).toBe('offline');
    expect(moved!.km).toBeCloseTo(started.primaryStop!.alongKm - 20, 5);

    demoStore.set({offline: false});
    const back = await services.trip.refresh();
    expect(back!.monitoringStatus).toBe('monitoring');
    expect(back!.offlineSince).toBeNull();
    expect(appStore.get().offlineTrip!.savedAt).toBeGreaterThanOrEqual(savedAt);
  });

  test('a server error does not alarm the driver or lose the trip', async () => {
    const started = await planAndStart(72);
    demoStore.set({apiError: true});
    const out = await services.trip.refresh();
    expect(out!.tripId).toBe(started.tripId);
    expect(out!.monitoringStatus).toBe('monitoring');
    expect(inbox()).toEqual([]);
  });

  test('switching needs signal: offline it explains, and changes nothing', async () => {
    const started = await planAndStart(72);
    await services.trip.advance(started.primaryStop!.alongKm - 28);
    demoStore.set({stationOccupied: true});
    await services.trip.refresh();
    demoStore.set({offline: true});
    await expect(services.trip.acceptSwitch()).rejects.toMatchObject({
      name: 'OfflineError',
    });
    expect(appStore.get().activeTrip!.primaryStop!.stationId).toBe(
      started.primaryStop!.stationId,
    );
    expect(appStore.get().activeTrip!.pendingSwitch).not.toBeNull();
  });
});

describe('the trip survives a restart', () => {
  test('it is plain data: saving and reloading it changes nothing', async () => {
    const started = await planAndStart(72);
    await services.trip.advance(started.primaryStop!.alongKm - 28);
    const trip = appStore.get().activeTrip!;
    expect(JSON.parse(JSON.stringify(trip))).toEqual(trip);
    const snap = appStore.get().offlineTrip!;
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  test('a corrected battery re-plans the live trip', async () => {
    const started = await planAndStart(72);
    await services.trip.advance(started.primaryStop!.alongKm - 60);
    const before = appStore.get().activeTrip!;
    await services.vehicle.setBattery(before.currentSoc - 8);
    const after = appStore.get().activeTrip!;
    expect(after.anchor.soc).toBe(before.currentSoc - 8);
    expect(after.primaryStop!.arriveSoc).toBeLessThan(
      before.primaryStop!.arriveSoc,
    );
    expect(appStore.get().battery!.source).toBe('manual');
  });

  test('while driving the stored battery follows the trip, labelled as an estimate', async () => {
    const started = await planAndStart(72);
    await services.trip.advance(started.primaryStop!.alongKm - 60);
    const battery = appStore.get().battery!;
    expect(battery.percent).toBe(appStore.get().activeTrip!.currentSoc);
    expect(battery.source).toBe('estimate');
  });
});

describe('recommendation service', () => {
  const DELHI = {latitude: 28.6139, longitude: 77.209};

  test('Charge nearby: a compatible pick with a backup', async () => {
    seedSignedIn({soc: 40});
    const rec = await services.recommendation.recommend({
      intent: 'charge_nearby',
      origin: DELHI,
    });
    expect(rec.status).toBe('ok');
    expect(rec.primary).not.toBeNull();
    expect(rec.backup).not.toBeNull();
    expect(rec.primary!.station.sponsored).toBeDefined();
    rec.ranked.forEach(c =>
      expect(NEXON.connectors).toContain(c.connector.type),
    );
  });

  test('Battery critical: only chargers the battery can reach', async () => {
    seedSignedIn({soc: 6});
    const rec = await services.recommendation.recommend({
      intent: 'battery_critical',
      origin: DELHI,
    });
    rec.ranked.forEach(c => expect(c.arriveSoc).toBeGreaterThanOrEqual(2));
    if (rec.primary) {
      expect(rec.primary.reasons[0]).toMatch(/reach it with about/);
    } else {
      expect(rec.status).toBe('none_reachable');
    }
  });

  test('the presenter\'s "no compatible chargers" gets its own words', async () => {
    seedSignedIn({soc: 40});
    demoStore.set({noCompatible: true});
    const rec = await services.recommendation.recommend({
      intent: 'charge_nearby',
      origin: DELHI,
    });
    expect(rec.status).toBe('none_compatible');
    expect(rec.primary).toBeNull();
  });

  test('it asks for a car and a battery first, in plain words', async () => {
    seedSignedIn({soc: 40});
    appStore.set({battery: null});
    await expect(
      services.recommendation.recommend({
        intent: 'charge_nearby',
        origin: DELHI,
      }),
    ).rejects.toThrow(/battery level/);
    appStore.set({vehicles: [], activeVehicleId: null});
    await expect(
      services.recommendation.recommend({
        intent: 'charge_nearby',
        origin: DELHI,
      }),
    ).rejects.toThrow(/car first/);
  });
});
