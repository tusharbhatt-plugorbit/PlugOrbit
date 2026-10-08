/**
 * @format
 *
 * Smaller guarantees that don't belong to one screen: the monitor host's
 * heartbeat, the cost of backtracking, one number everywhere, honest offline
 * snapshots, map pin roles and the words for a trip already running.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {TripMonitorHost} from '../src/app/TripMonitorHost';
import {describeError} from '../src/domain/describeError';
import {buildOfflineSnapshot} from '../src/domain/offlineTrip';
import {recommend, pickBackup} from '../src/domain/recommendation';
import {describeSocSource} from '../src/domain/socEstimate';
import {
  applyBattery,
  applyRouteChange,
  applyPosition,
  createTrip,
  planAllStops,
  switchCost,
} from '../src/domain/tripEngine';
import type {Station, Vehicle} from '../src/domain/types';
import {NEXON, seedSignedIn} from '../src/dev/testHarness';
import ChargerMarker from '../src/components/ChargerMarker';
import {createMockServices, ServicesProvider} from '../src/services';
import {TripInProgressError} from '../src/services/mock/tripService';
import {buildStations, VEHICLE_CATALOG} from '../src/services/mock/data';
import {waitFor} from '../src/services/mock/stationService';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';

const {act} = ReactTestRenderer;
const NOW = Date.now();
const services = createMockServices();

const plan = (soc = 72, to = 'Jaipur') =>
  services.route.plan({
    fromLabel: 'Delhi',
    toLabel: to,
    startSoc: soc,
    strategy: 'reliable',
    vehicle: NEXON,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });

describe('one number everywhere', () => {
  test.each([
    ['Delhi', 'Jaipur', 72],
    ['Jaipur', 'Delhi', 70],
    ['Delhi', 'Jaipur', 55],
  ])(
    '%s to %s at %s%: every stop costs and takes the same in the plan and the trip',
    async (from, to, soc) => {
      seedSignedIn({soc});
      const route = await services.route.plan({
        fromLabel: from,
        toLabel: to,
        startSoc: soc,
        strategy: 'reliable',
        vehicle: NEXON,
        safetyReservePct: 12,
        avoidPaidParking: false,
      });
      const planned = planAllStops(route, NEXON, NOW);
      expect(planned).toHaveLength(route.stops.length);
      route.stops.forEach((stop, i) => {
        const p = planned[i].plan;
        expect(p.arriveSoc).toBe(stop.arriveSoc);
        expect(p.chargeToSoc).toBe(stop.chargeToSoc);
        expect(p.chargeMin).toBe(stop.chargeMin);
        if (stop.costInr !== null && p.costInr !== null) {
          expect(Math.abs(p.costInr - stop.costInr)).toBeLessThanOrEqual(1);
        }
      });
    },
  );
});

describe('backtracking to a backup the car has passed', () => {
  test('costs battery, and the road ahead starts from that charger', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    let {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    const stop = trip.primaryStop!;
    // 3 km before the stop: its backup (~26 km earlier on the road) is behind.
    trip = applyPosition(trip, stop.alongKm - 3, {now: NOW, remindKm: 40}).trip;
    const cost = switchCost(trip, stop, stop.backup!);
    expect(cost.aheadKm).toBeLessThan(0);
    expect(cost.extraMin).toBeGreaterThan(30);
    const socBefore = trip.currentSoc;

    const switched = await services.route.switchToBackup(route, 0);
    const out = applyRouteChange(trip, switched, {
      now: NOW,
      auto: false,
      from: {
        fromStationId: stop.stationId,
        fromName: stop.stationName,
        toStationId: stop.backup!.stationId,
        toName: stop.backup!.stationName,
        reason: 'offline',
        aheadKm: null,
        savedMin: null,
        createdAt: NOW,
      },
    });
    const after = out.trip;
    expect(after.primaryStop!.stationId).toBe(stop.backup!.stationId);
    // The car is now at the backup, having used battery to get back to it.
    expect(after.km).toBeCloseTo(after.primaryStop!.alongKm, 5);
    expect(after.km).toBeLessThan(trip.km);
    expect(after.anchor.km).toBe(after.km);
    expect(after.anchor.soc).toBeLessThan(socBefore);
    expect(after.currentSoc).toBe(Math.round(after.anchor.soc));
  });

  test('a flat battery makes a far backup unreachable', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    let {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    trip = applyBattery(trip, 7, NOW).trip;
    expect(
      switchCost(trip, trip.primaryStop!, trip.primaryStop!.backup!).reachable,
    ).toBe(false);
  });
});

describe('the monitor host', () => {
  const hosts: ReactTestRenderer.ReactTestRenderer[] = [];
  async function mountHost() {
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <ServicesProvider services={services}>
          <TripMonitorHost />
        </ServicesProvider>,
      );
    });
    hosts.push(r);
    return r;
  }
  const tick = async (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      await act(async () => {
        jest.advanceTimersByTime(250);
      });
    }
  };

  afterEach(async () => {
    // Always, even when an assertion threw: a leaked host keeps driving.
    await act(async () => {
      hosts.splice(0).forEach(h => h.unmount());
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('does nothing when there is no trip', async () => {
    seedSignedIn();
    const advance = jest.spyOn(services.trip, 'advance');
    const refresh = jest.spyOn(services.trip, 'refresh');
    demoStore.set({autoDrive: true});
    jest.useFakeTimers();
    await mountHost();
    await tick(20_000);
    expect(advance).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('auto-drive moves the car along the route, one tick at a time', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    await services.trip.start({route, smartDrive: true});
    const start = appStore.get().activeTrip!.km;
    demoStore.set({autoDrive: true});
    jest.useFakeTimers();
    await mountHost();
    await tick(3000);
    expect(appStore.get().activeTrip!.km - start).toBeCloseTo(4.5, 5);
    // Switched off, it stops.
    demoStore.set({autoDrive: false});
    await tick(500);
    const parked = appStore.get().activeTrip!.km;
    await tick(3000);
    expect(appStore.get().activeTrip!.km).toBe(parked);
  });

  test('keeps watching: a charger that fills up is noticed without anyone opening the app', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    const trip = await services.trip.start({route, smartDrive: true});
    await services.trip.advance(trip.primaryStop!.alongKm - 28);
    jest.useFakeTimers();
    await mountHost();
    expect(appStore.get().activeTrip!.pendingSwitch).toBeNull();
    demoStore.set({stationOccupied: true});
    await tick(9000);
    expect(appStore.get().activeTrip!.pendingSwitch).not.toBeNull();
  });

  test('stops watching when the trip ends', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    await services.trip.start({route, smartDrive: true});
    const refresh = jest.spyOn(services.trip, 'refresh');
    jest.useFakeTimers();
    await mountHost();
    await tick(9000);
    expect(refresh).toHaveBeenCalled();
    await act(async () => {
      await services.trip.finish();
    });
    refresh.mockClear();
    await tick(20_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the saved plan', () => {
  const stations = buildStations(NOW);
  const station = (id: string): Station => stations.find(s => s.id === id)!;

  test('keeps the stop, its backup, how to start, and who to ask', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    const {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    const snap = buildOfflineSnapshot(trip, NOW);
    expect(snap.stops.map(s => s.role)).toEqual(['primary', 'backup']);
    const primary = snap.stops[0];
    expect(primary.connectorLabel).toMatch(/^C\d$/);
    expect(primary.accessInstructions).toMatch(/Scan the charger/);
    expect(primary.help).toMatch(/Profile > Support/);
    // No made-up phone numbers.
    expect(`${primary.help} ${primary.accessInstructions}`).not.toMatch(
      /\+?\d{8,}/,
    );
    expect(snap.route.polyline.length).toBeGreaterThan(2);
    expect(snap.savedAt).toBe(NOW);
  });

  test('an operator-run charger carries the operator’s own instructions', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    const {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    const external = {...station('st-glida-neemrana')};
    const snap = buildOfflineSnapshot(trip, NOW, {
      [trip.primaryStop!.stationId]: external,
    });
    expect(snap.stops[0].accessInstructions).toMatch(/Glida/);
    expect(snap.stops[0].help).toMatch(/Glida runs this charger/);
  });

  test('a fresher look wins over the planned one', async () => {
    seedSignedIn({soc: 72});
    const route = await plan();
    const {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    const id = trip.primaryStop!.stationId;
    const fresh: Station = {
      ...station(id),
      statusFeed: {source: 'operator_feed', updatedAt: NOW - 1000},
      connectors: station(id).connectors.map(c => ({
        ...c,
        status: 'occupied' as const,
      })),
    };
    const snap = buildOfflineSnapshot(trip, NOW, {[id]: fresh});
    expect(snap.stops[0].freeBays).toBe(0);
    expect(snap.stops[0].statusUpdatedAt).toBe(NOW - 1000);
  });
});

describe('the backup choice', () => {
  const stations = buildStations(NOW);
  const near = (id: string, km: number) => {
    const s = stations.find(x => x.id === id)!;
    return {
      station: {
        ...s,
        distanceKm: km,
        detourMin: Math.max(1, Math.round(km * 1.65)),
      },
    };
  };
  const ctx = {
    intent: 'charge_nearby' as const,
    vehicle: NEXON,
    socPercent: 45,
    reservePct: 12,
    now: NOW,
    waitOf: (s: Station, v: Vehicle) => waitFor(s, v, NOW),
  };

  test('prefers a different operator so one outage can’t take out both', () => {
    // Two similar ChargeZone sites and one Tata Power site, all close to each other.
    const rec = recommend(
      [
        near('st-chargezone-manesar', 5),
        near('st-chargezone-neemrana', 6),
        near('st-tata-gurgaon', 6),
      ],
      ctx,
    );
    const primary = rec.primary!;
    if (rec.backup) {
      const sameOperator =
        rec.backup.station.operator === primary.station.operator;
      const otherOperators = rec.ranked.filter(
        c =>
          c.station.id !== primary.station.id &&
          c.station.operator !== primary.station.operator,
      );
      // A different operator is chosen whenever one is within a few points.
      if (
        otherOperators.length > 0 &&
        otherOperators[0].score >= rec.backup.score - 5
      ) {
        expect(sameOperator).toBe(false);
      }
    }
    expect(rec.backup?.station.id).not.toBe(primary.station.id);
  });

  test('no backup when nothing is close enough, and the engine says so', () => {
    const rec = recommend([near('st-chargezone-neemrana', 5)], ctx);
    expect(rec.backup).toBeNull();
    expect(pickBackup(rec.primary!, rec.ranked)).toBeNull();
  });
});

describe('small honesty checks', () => {
  test('a battery worked out on the trip is called an estimate, not a reading', () => {
    const view = describeSocSource(
      {connected: false},
      {percent: 44, source: 'estimate', updatedAt: NOW - 60_000},
      NOW,
    )!;
    expect(view.label).toBe('Estimated on your trip');
    expect(view.fromCar).toBe(false);
    expect(view.detail).toMatch(/distance driven/);
  });

  test('a trip already running has its own plain explanation', () => {
    const copy = describeError(new TripInProgressError(), 'x');
    expect(copy.kind).toBe('trip');
    expect(copy.title).toBe('A trip is already running');
  });

  test('the map pin says when it is your stop or your backup', () => {
    const s = {
      ...buildStations(NOW).find(x => x.id === 'st-chargezone-neemrana')!,
      distanceKm: 1,
      detourMin: 1,
    };
    const labelOf = (role?: 'primary' | 'backup') => {
      let r!: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        r = ReactTestRenderer.create(
          <ChargerMarker
            station={s}
            vehicle={NEXON}
            selected={false}
            onSelect={() => {}}
            role={role}
          />,
        );
      });
      const label = r.root.findAll(
        n => typeof n.props.accessibilityLabel === 'string',
      )[0].props.accessibilityLabel as string;
      act(() => r.unmount());
      return label;
    };
    expect(labelOf('primary')).toMatch(/^Your charging stop, ChargeZone/);
    expect(labelOf('backup')).toMatch(/^Your backup, ChargeZone/);
    expect(labelOf()).toMatch(/^ChargeZone/);
  });

  test('every catalogue car gets a sensible expected-charging estimate, none invented', () => {
    VEHICLE_CATALOG.forEach(model => {
      const v = {...model, id: model.modelId} as Vehicle;
      const conn = stationsFor(v);
      if (conn) {
        expect(conn.peak).toBeLessThanOrEqual(Math.max(v.maxDcKw, v.maxAcKw));
      }
    });
  });
});

function stationsFor(v: Vehicle) {
  const {estimateVehicleCharge} = require('../src/domain/vehicleCharging');
  const conn = buildStations(NOW)
    .flatMap(s => s.connectors)
    .find(c => v.connectors.includes(c.type));
  if (!conn) {
    return null;
  }
  const e = estimateVehicleCharge(conn, v, 20, 80);
  return {peak: e.peakKw as number};
}
