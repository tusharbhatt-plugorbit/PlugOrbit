import {ScenarioDriver} from '../../src/dev/scenarioDriver';
import {timeAgo} from '../../src/domain/trust';
import {
  MAX_CRITICAL_PER_TRIP,
  availabilityLine,
} from '../../src/intelligence/notifications';
import {
  createTrip,
  deriveWorldEvents,
  processEvent,
} from '../../src/intelligence/monitor';
import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {
  DELHI_JAIPUR_PATH,
  NEXON_EV,
  mockStations,
  noon,
  withStationStatus,
} from '../../src/dev/smartDriveFixtures';
import type {TripEvent} from '../../src/intelligence/types';

const kinds = (d: ScenarioDriver) => d.told.map(n => n.kind);

describe('TripMonitorService: events', () => {
  test('is a pure reducer: the same input gives the same output', () => {
    const a = new ScenarioDriver();
    const b = new ScenarioDriver();
    const e: TripEvent = {type: 'TRIP_STARTED', at: a.now};
    expect(
      processEvent(a.trip, e, {vehicle: NEXON_EV, world: a.world(), config}),
    ).toEqual(
      processEvent(b.trip, e, {vehicle: NEXON_EV, world: b.world(), config}),
    );
  });

  test('location updates move the car and use the battery the model predicts', () => {
    const d = new ScenarioDriver({soc: 72});
    d.start();
    d.driveTo(30);
    expect(d.trip.progressKm).toBeCloseTo(30, 3);
    expect(d.trip.currentSoC).toBeCloseTo(72 - 30 * (100 / 300), 1);
    expect(d.trip.distanceRemainingKm).toBeCloseTo(d.trip.totalKm - 30, 3);
    expect(d.trip.position.source).toBe('simulated');
  });

  test('a real battery reading wins over the model', () => {
    const d = new ScenarioDriver();
    d.start();
    d.dispatch({type: 'LOCATION_UPDATED', at: d.now, progressKm: 20, soc: 60});
    expect(d.trip.currentSoC).toBe(60);
  });

  test('every important change is a typed event', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(60);
    const id = d.trip.primaryStop!.station.id;
    d.takeOffline(id);
    d.tick();
    const types = d.events.map(e => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'TRIP_STARTED',
        'LOCATION_UPDATED',
        'CHARGER_STATUS_CHANGED',
        'CHARGER_BECAME_OFFLINE',
      ]),
    );
  });

  test('derives status changes only for the chargers the plan relies on', () => {
    const d = new ScenarioDriver();
    const world = d.world();
    const unrelated = withStationStatus(
      world.stations,
      'st-zeon-karolbagh',
      'offline',
      d.now,
    );
    expect(
      deriveWorldEvents(d.trip, {now: d.now, stations: unrelated}, NEXON_EV),
    ).toEqual([]);
    const primary = d.trip.primaryStop!.station.id;
    const hit = withStationStatus(world.stations, primary, 'occupied', d.now);
    expect(
      deriveWorldEvents(d.trip, {now: d.now, stations: hit}, NEXON_EV).map(
        e => e.type,
      ),
    ).toEqual(['CHARGER_STATUS_CHANGED', 'PRIMARY_CHARGER_OCCUPIED']);
  });

  test('an ended trip ignores further events', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(d.trip.totalKm);
    const frozen = d.trip;
    const u = d.tick(5);
    expect(u.trip).toBe(frozen);
    expect(u.notifications).toEqual([]);
  });
});

describe('ProactiveNotificationService: when to speak, when not to', () => {
  test('a charger going offline is a safety switch, announced once', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(40);
    const old = d.trip.primaryStop!.station;
    d.takeOffline(old.id);
    d.tick();
    const n = d.told.find(x => x.kind === 'charger_unavailable');
    expect(n?.level).toBe('important');
    expect(n?.title).toBe('We’ve changed your charging stop.');
    expect(n?.body).toContain('offline');
    expect(d.trip.primaryStop?.station.id).not.toBe(old.id);
    d.tick(1);
    d.tick(1);
    // The change itself is announced once, however many times we look again.
    expect(d.told.filter(x => x.kind === 'charger_unavailable')).toHaveLength(
      1,
    );
  });

  test('the same news is never sent twice', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 20);
    const approach = d.told.filter(n => n.kind === 'stop_approaching');
    d.tick();
    d.tick(2);
    expect(d.told.filter(n => n.kind === 'stop_approaching')).toHaveLength(
      approach.length,
    );
  });

  test('quiet mode lets only plan changes and safety alerts through', () => {
    const d = new ScenarioDriver({quiet: true});
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 3);
    expect(d.told).toEqual([]);
    d.takeOffline(d.trip.primaryStop!.station.id);
    d.tick();
    expect(d.told.map(n => n.level)).toEqual(['important']);
    // What it kept quiet about is still recorded, so nothing is hidden.
    expect(d.decisions.some(x => /Quiet mode/.test(x.why))).toBe(true);
  });

  test('one message per event: the most important wins', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 29);
    d.takeOffline(d.trip.primaryStop!.station.id);
    const u = d.tick();
    expect(u.notifications.length).toBeLessThanOrEqual(1);
  });

  test('turned off means silent', () => {
    const d = new ScenarioDriver();
    d.trip = {...d.trip, smartDriveEnabled: false};
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 3);
    expect(d.told).toEqual([]);
  });

  test('losing signal is a calm note that says how old the status is', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(30);
    d.dispatch({type: 'NETWORK_LOST', at: d.now});
    const n = d.told.find(x => x.kind === 'offline');
    expect(n?.level).toBe('info');
    expect(n?.title).toBe('You’re offline.');
    expect(n?.body).toMatch(
      /Your charging plan is still available\. Last status update: .+\./,
    );
    expect(d.trip.monitoringState).toBe('paused_offline');
    d.dispatch({type: 'NETWORK_RESTORED', at: d.now + 1000});
    expect(d.trip.monitoringState).toBe('monitoring');
    // Coming back online is not worth interrupting anyone for.
    expect(kinds(d).filter(k => k === 'back_online')).toEqual([]);
  });

  test('offline, the plan does not churn on stale data', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(30);
    const id = d.trip.primaryStop!.station.id;
    d.dispatch({type: 'NETWORK_LOST', at: d.now});
    d.occupy(id, 8);
    d.driveTo(60);
    expect(d.trip.primaryStop?.station.id).toBe(id);
  });

  test('a failed payment is flagged without drama', () => {
    const d = new ScenarioDriver();
    d.start();
    d.dispatch({type: 'PAYMENT_FAILED', at: d.now});
    const n = d.told.find(x => x.kind === 'payment_failed');
    expect(n?.level).toBe('important');
    expect(n?.body).not.toMatch(/error|invalid|failed:/i);
    expect(d.trip.actuals.paymentOk).toBe(false);
  });
});

describe('critical alerts are rare and meaningful', () => {
  test('low battery announces itself once, calmly', () => {
    const d = new ScenarioDriver({soc: 72});
    d.start();
    d.driveTo(105);
    d.dispatch({type: 'BATTERY_UPDATED', at: d.now, soc: 14});
    const crit = d.told.filter(n => n.level === 'critical');
    expect(crit).toHaveLength(1);
    expect(crit[0].title).toBe('Battery is getting low.');
    expect(crit[0].body).toMatch(
      /^We’ve prioritised the safest reachable charger, .+ away\.$/,
    );
    d.tick(1);
    d.tick(1);
    expect(d.told.filter(n => n.level === 'critical')).toHaveLength(1);
  });

  test(`never more than ${MAX_CRITICAL_PER_TRIP} per trip`, () => {
    const d = new ScenarioDriver({soc: 72});
    d.start();
    d.trip = {
      ...d.trip,
      counters: {...d.trip.counters, critical: MAX_CRITICAL_PER_TRIP},
    };
    d.driveTo(105);
    d.dispatch({type: 'BATTERY_UPDATED', at: d.now, soc: 13});
    expect(d.told.filter(n => n.level === 'critical')).toHaveLength(0);
    expect(
      d.decisions.some(x => /limited so they stay meaningful/.test(x.why)),
    ).toBe(true);
  });

  test('no jargon ever reaches the driver', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(105);
    d.dispatch({type: 'BATTERY_UPDATED', at: d.now, soc: 14});
    d.told.forEach(n => {
      expect(`${n.title} ${n.body}`).not.toMatch(
        /\b(SOC|SoC|ERROR|INVALID|NaN|undefined|null)\b/,
      );
    });
  });
});

describe('honest wording', () => {
  test('"currently available" is only said on a fresh operator feed', () => {
    const stations = mockStations(noon());
    const fresh = createTrip({
      tripId: 't',
      vehicle: NEXON_EV,
      origin: {label: 'A', coords: DELHI_JAIPUR_PATH.points[0]},
      destination: {label: 'B', coords: DELHI_JAIPUR_PATH.points[11]},
      polyline: DELHI_JAIPUR_PATH.points,
      startSoc: 72,
      now: noon(),
      world: {now: noon(), stations},
      config,
    });
    const stop = fresh.primaryStop!;
    expect(availabilityLine(stop, noon())).toBe(
      'Your selected connector is currently available.',
    );
    // Ten minutes later the same data is only an estimate.
    const later = availabilityLine(stop, noon() + 10 * 60000);
    expect(later).not.toMatch(/currently available/);
    expect(later).toContain(
      `last reported free ${timeAgo(
        stop.station.statusFeed.updatedAt,
        noon() + 10 * 60000,
      )}`,
    );
  });

  test('an unknown status is said to be unknown', () => {
    const d = new ScenarioDriver();
    const stop = {
      ...d.trip.primaryStop!,
      station: {
        ...d.trip.primaryStop!.station,
        connectors: d.trip.primaryStop!.station.connectors.map(c => ({
          ...c,
          status: 'unknown' as const,
        })),
        statusFeed: {source: 'none' as const, updatedAt: null},
      },
    };
    expect(availabilityLine(stop, d.now)).toMatch(/can’t see its status/);
  });
});

describe('the ledger: what the co-pilot watched and chose not to say', () => {
  test('records silent decisions with a reason, and tells the truth about counts', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 5);
    const ledger = d.trip.log;
    expect(ledger.length).toBeGreaterThan(1);
    expect(ledger.length).toBeLessThanOrEqual(40);
    expect(ledger.filter(l => l.kind === 'notified')).toHaveLength(
      d.trip.counters.told,
    );
    ledger.forEach(l => expect(l.text.length).toBeGreaterThan(3));
  });
});
