/**
 * @format
 *
 * The co-driver screens with real state: Home, Trip summary, Charge nearby /
 * Battery critical, Smart Drive in each phase, the backup alert in trip mode,
 * the offline plan and the receipt's "Continue trip".
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {NEXON, TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {createMockServices} from '../src/services';
import type {Services} from '../src/services/types';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

jest.setTimeout(60000);

const mounted: Renderer[] = [];
// Real timers: these tests call the mock services directly, whose simulated
// latency is a setTimeout that fake timers would never fire.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 12));
    });
  }
};

async function render(
  stack: ReadonlyArray<{name: never; params?: unknown}> | undefined,
  tab?: 'Home' | 'Trips',
  services?: Partial<Services>,
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <TestApp tab={tab} stack={stack as never} services={services} />,
    );
  });
  mounted.push(r);
  await flush();
  return r;
}

// Only the screen the driver is looking at: tab roots and earlier screens stay
// mounted underneath and would be counted twice.
const focused = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];

const texts = (r: Renderer) =>
  focused(r)
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const has = (r: Renderer, re: RegExp) => texts(r).some(t => re.test(t));

const labelled = (r: Renderer, label: string | RegExp) =>
  focused(r).findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (typeof label === 'string'
        ? n.props.accessibilityLabel === label
        : label.test(n.props.accessibilityLabel)),
  );

const press = async (r: Renderer, label: string | RegExp) => {
  const node = labelled(r, label)[0];
  if (!node) {
    throw new Error(`No pressable labelled ${String(label)}`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

const services = createMockServices();

/** A Delhi to Jaipur trip, driven to a point; returns the trip. */
async function startTrip(opts: {soc?: number; km?: 'upcoming' | 'at'} = {}) {
  const soc = opts.soc ?? 72;
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
  const trip = await services.trip.start({route, smartDrive: true});
  const at = trip.primaryStop!.alongKm;
  if (opts.km === 'upcoming') {
    await services.trip.advance(at - 28);
  } else if (opts.km === 'at') {
    await services.trip.advance(at);
  }
  return appStore.get().activeTrip!;
}

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});
describe('Home', () => {
  test('starts from the driver: the car, the battery, one calm line, and the question', async () => {
    seedSignedIn({soc: 68});
    const r = await render(undefined, 'Home');
    expect(has(r, /^68%$/)).toBe(true);
    expect(has(r, /^You’re good to drive\.$/)).toBe(true);
    expect(
      focused(r)
        .findAllByType(TextInput)
        .map(n => n.props.accessibilityLabel),
    ).toContain('Where are we going?');
    ['Plan a trip', 'Charge nearby', 'Battery critical'].forEach(l =>
      expect(labelled(r, l).length).toBeGreaterThan(0),
    );
    // The map is context, not the point: it's one tap away, not the screen.
    expect(r.root.findAll(n => n.props.testID === 'map')).toHaveLength(0);
    expect(has(r, /^Chargers around you$/)).toBe(true);
    expect(has(r, /You drive\. We handle the charge\./)).toBe(true);
  });

  test('says when to charge, in calm words, as the battery falls', async () => {
    seedSignedIn({soc: 18});
    expect(
      has(
        await render(undefined, 'Home'),
        /Charging recommended before your trip\./,
      ),
    ).toBe(true);
  });

  test('a very low battery gets the safe-option wording', async () => {
    seedSignedIn({soc: 6});
    const r = await render(undefined, 'Home');
    expect(
      has(r, /Battery is low\. We’ve found the safest charging option\./),
    ).toBe(true);
  });

  test('the three intents each go somewhere', async () => {
    seedSignedIn({soc: 40});
    let r = await render(undefined, 'Home');
    await press(r, 'Charge nearby');
    expect(probe.current).toBe('ChargePick');
    await act(async () => r.unmount());
    r = await render(undefined, 'Home');
    await press(r, 'Battery critical');
    expect(probe.current).toBe('ChargePick');
    await act(async () => r.unmount());
    r = await render(undefined, 'Home');
    await press(r, 'Plan a trip');
    expect(probe.current).toBe('RoutePlanner');
    await act(async () => r.unmount());
    r = await render(undefined, 'Home');
    await press(r, /^Chargers around you/);
    expect(probe.current).toBe('Map');
  });

  test('with a trip running it shows the next decision once, and a way in', async () => {
    await startTrip({km: 'upcoming'});
    const r = await render(undefined, 'Home');
    const status = texts(r).filter(t => /Charging stop in 28 km\./.test(t));
    // The car card speaks about the battery; only the trip card speaks about the trip.
    expect(status).toHaveLength(1);
    await press(r, 'Open trip');
    expect(probe.current).toBe('SmartDrive');
  });

  test('no car yet: it asks for one instead of showing a broken battery', async () => {
    seedSignedIn();
    appStore.set({vehicles: [], activeVehicleId: null, battery: null});
    const r = await render(undefined, 'Home');
    expect(has(r, /Add your car to get started\./)).toBe(true);
    await press(r, 'Add your car');
    expect(probe.current).toBe('VehicleSetup');
  });
});

describe('Charge nearby and Battery critical', () => {
  test('Charge nearby gives one pick, with its backup and what it means for the car', async () => {
    seedSignedIn({soc: 45});
    const r = await render([
      {name: 'ChargePick' as never, params: {mode: 'nearby'}},
    ]);
    expect(has(r, /^PlugOrbit pick$/i) || has(r, /PlugOrbit pick/i)).toBe(true);
    expect(has(r, /Charge Confidence/)).toBe(true);
    expect(has(r, /Backup ready/)).toBe(true);
    expect(has(r, /Your expected charging/)).toBe(true);
    expect(has(r, /Estimated cost/)).toBe(true);
    // Most of the chargers nearby are not shown as 40 pins to choose from.
    expect(labelled(r, /Use this charger/).length).toBe(1);
  });

  test('"Use this charger" remembers the pick and the backup it promised', async () => {
    seedSignedIn({soc: 45});
    const r = await render([
      {name: 'ChargePick' as never, params: {mode: 'nearby'}},
    ]);
    await press(r, 'Use this charger');
    expect(probe.current).toBe('Navigation');
    const chosen = appStore.get().chosen!;
    expect(chosen.stationId).toBeTruthy();
    expect(chosen.backupStationId).toBeTruthy();
    expect(chosen.backupStationId).not.toBe(chosen.stationId);
  });

  test('Battery critical changes the wording and never offers a "cheapest" to be tempted by', async () => {
    seedSignedIn({soc: 8});
    const r = await render([
      {name: 'ChargePick' as never, params: {mode: 'critical'}},
    ]);
    expect(
      has(r, /Battery is low\. We’ve found the safest charging option\./),
    ).toBe(true);
    expect(has(r, /Safest option/i)).toBe(true);
    expect(has(r, /How the options compare/)).toBe(false);
    expect(has(r, /^Cheapest$/)).toBe(false);
    expect(labelled(r, /Roadside/).length).toBeGreaterThan(0);
  });

  test('no compatible charger: says so, and offers a way forward', async () => {
    seedSignedIn({soc: 45});
    demoStore.set({noCompatible: true});
    const r = await render([
      {name: 'ChargePick' as never, params: {mode: 'nearby'}},
    ]);
    expect(has(r, /No compatible charger found/)).toBe(true);
    expect(labelled(r, 'Check my car’s plugs').length).toBe(1);
  });

  test('offline: an honest retry, not a crash', async () => {
    seedSignedIn({soc: 45});
    demoStore.set({offline: true});
    const r = await render([
      {name: 'ChargePick' as never, params: {mode: 'nearby'}},
    ]);
    expect(has(r, /You’re offline/)).toBe(true);
  });

  test('no car or no battery: asks, plainly', async () => {
    seedSignedIn();
    appStore.set({battery: null});
    expect(
      has(
        await render([{name: 'ChargePick' as never}]),
        /Tell us your battery level/,
      ),
    ).toBe(true);
  });
});

describe('Trip summary', () => {
  test('shows the plan: stop, confidence, backup, cost, and one button to start', async () => {
    seedSignedIn({soc: 72});
    const route = await services.route.plan({
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
      startSoc: 72,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });
    appStore.set({activeRoute: route});
    const r = await render([{name: 'TripSummary' as never}]);
    expect(has(r, /1 charging stop, planned/)).toBe(true);
    expect(has(r, /Route confidence/)).toBe(true);
    expect(has(r, /Charging stop 1/)).toBe(true);
    expect(has(r, /Backup ready/)).toBe(true);
    expect(has(r, /We’ve got your charging covered\./)).toBe(true);
    // The cost in the summary and on the stop card are the same number.
    const stopCost = route.stops[0].costInr!;
    expect(texts(r).some(t => t.includes(`₹${stopCost}`))).toBe(true);
    await press(r, 'Start trip');
    expect(probe.current).toBe('SmartDrive');
    expect(appStore.get().activeTrip).not.toBeNull();
  });

  test('a second trip asks before replacing the first', async () => {
    const first = await startTrip();
    const r = await render([{name: 'TripSummary' as never}]);
    await press(r, 'Start trip');
    expect(probe.current).toBe('TripSummary');
    expect(has(r, /Replace your current trip\?/)).toBe(true);
    await press(r, 'Replace it');
    expect(appStore.get().activeTrip!.tripId).not.toBe(first.tripId);
  });

  test('no charging needed: reassurance instead of a plan', async () => {
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
    appStore.set({activeRoute: route});
    const r = await render([{name: 'TripSummary' as never}]);
    expect(has(r, /No charging needed/)).toBe(true);
    expect(has(r, /You’re good to drive\./)).toBe(true);
  });

  test('planning a trip lands here', async () => {
    seedSignedIn({soc: 72});
    const r = await render([
      {name: 'RoutePlanner' as never, params: {toLabel: 'Jaipur'}},
    ]);
    await press(r, 'Find best route');
    expect(probe.current).toBe('TripSummary');
  });
});

describe('Smart Drive', () => {
  test('no trip: an empty state with a way to start one', async () => {
    seedSignedIn();
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /No trip in progress/)).toBe(true);
    await press(r, 'Plan a trip');
    expect(probe.current).toBe('RoutePlanner');
  });

  test('on the road: where to, battery, the next stop, the backup, and that it is being watched', async () => {
    await startTrip({km: 'upcoming'});
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /^Jaipur$/)).toBe(true);
    expect(has(r, /Battery now \(estimated\)/)).toBe(true);
    expect(has(r, /Expected on arrival/)).toBe(true);
    expect(has(r, /Charging stop in 28 km\./)).toBe(true);
    expect(has(r, /Next charging stop/i)).toBe(true);
    expect(has(r, /Expected arrival/)).toBe(true);
    expect(has(r, /Charge to/)).toBe(true);
    expect(has(r, /Estimated stop/)).toBe(true);
    expect(has(r, /Backup ready/)).toBe(true);
    expect(has(r, /PlugOrbit is monitoring your charging stop\./)).toBe(true);
    expect(has(r, /What PlugOrbit did/)).toBe(true);
    expect(labelled(r, 'Open navigation').length).toBe(1);
  });

  test('the charger fills up: one clear decision, taken with one tap, trip preserved', async () => {
    const before = await startTrip({km: 'upcoming'});
    demoStore.set({stationOccupied: true});
    await services.trip.refresh();
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /We’ve found a better charging stop\./)).toBe(true);
    expect(has(r, /No free bay right now/)).toBe(true);
    expect(labelled(r, 'Switch route').length).toBe(1);
    // The hero doesn't repeat what the card says.
    expect(
      texts(r).filter(t => /We’ve found a better charging stop\./.test(t))
        .length,
    ).toBeLessThanOrEqual(2);
    await press(r, 'Switch route');
    const after = appStore.get().activeTrip!;
    expect(after.tripId).toBe(before.tripId);
    expect(after.pendingSwitch).toBeNull();
    expect(after.primaryStop!.stationId).toBe(
      before.primaryStop!.backup!.stationId,
    );
    expect(has(r, /We’ve changed your charging stop\./)).toBe(true);
  });

  test('staying put hides the card and does not nag', async () => {
    await startTrip({km: 'upcoming'});
    demoStore.set({stationOccupied: true});
    await services.trip.refresh();
    const r = await render([{name: 'SmartDrive' as never}]);
    await press(r, /^Stay with /);
    expect(appStore.get().activeTrip!.pendingSwitch).toBeNull();
    await act(async () => {
      await services.trip.refresh();
    });
    await flush();
    expect(labelled(r, 'Switch route')).toHaveLength(0);
  });

  test('offline: says so once, shows the saved plan, and never calls cached status LIVE', async () => {
    await startTrip({km: 'upcoming'});
    demoStore.set({offline: true});
    await services.trip.refresh();
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /OFFLINE TRIP MODE/)).toBe(true);
    expect(has(r, /We’ve kept your charging plan available\./)).toBe(true);
    expect(has(r, /Last updated/)).toBe(true);
    expect(texts(r).some(t => /^LIVE/.test(t))).toBe(false);
    expect(has(r, /^Estimated • /)).toBe(true);
  });

  test('at the charger: scan the QR, with the connector to use', async () => {
    await startTrip({km: 'at'});
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /You’re at /)).toBe(true);
    expect(has(r, /Use connector C\d/)).toBe(true);
    await press(r, 'Scan charger QR');
    expect(probe.current).toBe('ScanQr');
  });

  test('a charger that is full when you arrive offers the backup and a report', async () => {
    await startTrip({km: 'at'});
    demoStore.set({stationOccupied: true});
    await services.trip.refresh();
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /It looks busy right now/)).toBe(true);
    expect(labelled(r, 'Status differs? Use my backup').length).toBe(1);
    expect(labelled(r, /Report a problem/).length).toBeGreaterThan(0);
  });

  test('arrival: the summary, then Finish trip returns home with the trip archived', async () => {
    await startTrip({km: 'at'});
    const stop = appStore.get().activeTrip!.primaryStop!;
    const s = await services.session.start({
      stationId: stop.stationId,
      connectorId: stop.connectorId,
      targetSoc: stop.chargeToSoc,
      paymentMethodId: 'pm-upi',
    });
    appStore.set(x => ({
      session: x.session && {
        ...x.session,
        startedAt: x.session.startedAt - 3_600_000,
      },
    }));
    const stopped = await services.session.stop(s.id);
    await services.payment.pay(stopped.id, 'pm-upi');
    await services.trip.advance(appStore.get().activeTrip!.totalKm);
    const r = await render([{name: 'SmartDrive' as never}]);
    expect(has(r, /You’ve arrived in Jaipur\./)).toBe(true);
    expect(has(r, /Charging stops/)).toBe(true);
    expect(has(r, /Energy added/)).toBe(true);
    await press(r, 'Finish trip');
    expect(appStore.get().activeTrip).toBeNull();
    expect(appStore.get().completedTrips).toHaveLength(1);
    expect(probe.current).toBe('Home');
  });

  test('Smart Drive can be switched off for the trip', async () => {
    await startTrip();
    const r = await render([{name: 'SmartDrive' as never}]);
    const toggle = r.root.find(
      n =>
        n.props.accessibilityLabel === 'Smart Drive' &&
        typeof n.props.onValueChange === 'function',
    );
    await act(async () => {
      toggle.props.onValueChange(false);
    });
    await flush();
    expect(appStore.get().activeTrip!.smartDriveEnabled).toBe(false);
  });

  test('the demo controls drive the trip to the reminder', async () => {
    const trip = await startTrip();
    const r = await render([{name: 'SmartDrive' as never}]);
    const toggle = r.root.find(
      n =>
        n.props.accessibilityLabel === 'Demo controls' &&
        typeof n.props.onValueChange === 'function',
    );
    await act(async () => {
      toggle.props.onValueChange(true);
    });
    await flush();
    await press(r, 'Skip to the reminder');
    const after = appStore.get().activeTrip!;
    expect(after.km).toBeGreaterThan(trip.km);
    expect(
      appStore.get().notifications.some(n => /Charging stop in/.test(n.title)),
    ).toBe(true);
  });
});

describe('Backup alert in trip mode', () => {
  test('says "better charging stop", switches the trip, and goes to the new charger', async () => {
    const before = await startTrip({km: 'upcoming'});
    demoStore.set({stationOccupied: true});
    const r = await render([
      {
        name: 'BackupAlert' as never,
        params: {stationId: before.primaryStop!.stationId},
      },
    ]);
    expect(has(r, /We’ve found a better charging stop\./)).toBe(true);
    await press(r, 'Switch route');
    expect(probe.current).toBe('Navigation');
    expect(appStore.get().activeTrip!.primaryStop!.stationId).toBe(
      before.primaryStop!.backup!.stationId,
    );
  });
});

describe('Offline trip mode', () => {
  test('the saved plan has everything needed at the roadside', async () => {
    await startTrip({km: 'upcoming'});
    demoStore.set({offline: true});
    await services.trip.refresh();
    const r = await render([{name: 'OfflineMode' as never}]);
    expect(has(r, /OFFLINE TRIP MODE/)).toBe(true);
    expect(has(r, /Your charging stop/)).toBe(true);
    expect(has(r, /Your backup/)).toBe(true);
    expect(has(r, /How to start/)).toBe(true);
    expect(has(r, /If something’s wrong/)).toBe(true);
    expect(has(r, /We can’t confirm that without signal\./)).toBe(true);
    expect(texts(r).some(t => /^LIVE/.test(t))).toBe(false);
  });
});

describe('Receipt after a trip stop', () => {
  test('offers "Continue trip" and a calm confirmation', async () => {
    await startTrip({km: 'at'});
    const stop = appStore.get().activeTrip!.primaryStop!;
    const s = await services.session.start({
      stationId: stop.stationId,
      connectorId: stop.connectorId,
      targetSoc: stop.chargeToSoc,
      paymentMethodId: 'pm-upi',
    });
    appStore.set(x => ({
      session: x.session && {
        ...x.session,
        startedAt: x.session.startedAt - 3_600_000,
      },
    }));
    const stopped = await services.session.stop(s.id);
    await services.payment.pay(stopped.id, 'pm-upi');
    const r = await render([
      {name: 'Receipt' as never, params: {sessionId: stopped.id}},
    ]);
    expect(has(r, /You’re ready to continue\./)).toBe(true);
    await press(r, 'Continue trip');
    expect(probe.current).toBe('SmartDrive');
  });
});

describe('Alerts and Smart Drive preferences', () => {
  test('autoswitch and notification level are saved', async () => {
    seedSignedIn();
    const r = await render([{name: 'Alerts' as never}]);
    const toggle = r.root.find(
      n =>
        n.props.accessibilityLabel === 'Switch automatically' &&
        typeof n.props.onValueChange === 'function',
    );
    await act(async () => {
      toggle.props.onValueChange(true);
    });
    await flush();
    await press(r, 'Save');
    expect(appStore.get().smartDrivePrefs.autoSwitch).toBe(true);
    expect(appStore.get().smartDrivePrefs.notifyMode).toBe('calm');
  });
});

describe('Notifications inbox', () => {
  test('urgent and plan-changed messages are marked; quiet ones never arrive in calm mode', async () => {
    await startTrip({km: 'upcoming'});
    demoStore.set({stationOccupied: true});
    await services.trip.refresh();
    const titles = appStore.get().notifications.map(n => n.title);
    expect(titles).toContain('We’ve found a better charging stop.');
    expect(titles).not.toContain('You’re good to drive.');
    const r = await render([{name: 'Notifications' as never}]);
    expect(has(r, /Plan changed/)).toBe(true);
  });
});
