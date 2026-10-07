/**
 * @format
 */

import {createMockServices} from '../src/services';
import {IntegrationUnavailableError} from '../src/services';
import {
  ConnectorUnavailableError,
  PaymentRequiredError,
  SessionInProgressError,
} from '../src/services/mock/sessionService';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {appStore, resetAppStore} from '../src/store/appStore';
import {resetDemo, demoStore} from '../src/store/demoStore';
import {seedState} from '../src/store/seed';
import type {Vehicle} from '../src/domain/types';
import {computeSessionMetrics} from '../src/domain/charging';

const services = createMockServices();

const nexon: Vehicle = {...VEHICLE_CATALOG[0], id: 'veh-1'};
const DELHI = {latitude: 28.6139, longitude: 77.209};

function boot(soc = 60) {
  resetAppStore({
    ...seedState(Date.now()),
    vehicles: [nexon],
    activeVehicleId: nexon.id,
    battery: {percent: soc, source: 'manual', updatedAt: Date.now()},
  });
  resetDemo();
}

beforeEach(() => boot());

describe('stationService', () => {
  test('hides chargers the active vehicle cannot use by default', async () => {
    const list = await services.station.nearby({origin: DELHI, vehicle: nexon});
    expect(list.length).toBeGreaterThan(5);
    expect(
      list.every(s =>
        s.connectors.some(c => nexon.connectors.includes(c.type)),
      ),
    ).toBe(true);
    // A CHAdeMO-only vehicle sees a different set.
    const leaf = {...VEHICLE_CATALOG[9], id: 'veh-leaf'};
    const leafList = await services.station.nearby({
      origin: DELHI,
      vehicle: leaf,
    });
    expect(leafList.map(s => s.id)).not.toEqual(list.map(s => s.id));
  });

  test('presenter "no compatible" switch returns an empty list', async () => {
    demoStore.set({noCompatible: true});
    await expect(
      services.station.nearby({origin: DELHI, vehicle: nexon}),
    ).resolves.toEqual([]);
  });

  test('offline and API errors are thrown to the caller', async () => {
    demoStore.set({offline: true});
    await expect(
      services.station.nearby({origin: DELHI, vehicle: nexon}),
    ).rejects.toMatchObject({
      name: 'OfflineError',
    });
    demoStore.set({offline: false, apiError: true});
    await expect(
      services.station.nearby({origin: DELHI, vehicle: nexon}),
    ).rejects.toMatchObject({
      name: 'ApiError',
    });
  });

  test('wait estimates are ranges with a confidence label', async () => {
    const occupied = await services.station.waitEstimate('st-chargezone-sec16');
    const noWait = await services.station.waitEstimate('st-chargezone-manesar');
    expect(noWait.maxMinutes).toBe(0);
    expect(occupied.basis).toBeDefined();
    const busy = await services.station.waitEstimate('st-tata-citymall');
    expect(busy.maxMinutes).toBeGreaterThan(busy.minMinutes);
    expect(['low', 'medium', 'high']).toContain(busy.confidence);
  });
});

describe('routeService', () => {
  const request = (
    startSoc: number,
    strategy: 'fastest' | 'cheapest' | 'reliable' = 'reliable',
  ) => ({
    fromLabel: 'Delhi',
    toLabel: 'Jaipur',
    startSoc,
    strategy,
    vehicle: nexon,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });

  test('every recommended stop has a different backup station', async () => {
    for (const strategy of ['fastest', 'cheapest', 'reliable'] as const) {
      const route = await services.route.plan(request(60, strategy));
      expect(route.stops.length).toBeGreaterThan(0);
      route.stops.forEach(stop => {
        expect(stop.backup).toBeTruthy();
        expect(stop.backup.id).not.toBe(stop.station.id);
        expect(stop.station.connectors.length).toBeGreaterThan(0);
      });
    }
  });

  test('never plans below the safety reserve', async () => {
    const route = await services.route.plan(request(60));
    expect(route.arriveSoc).toBeGreaterThanOrEqual(12);
    route.stops.forEach(s => expect(s.arriveSoc).toBeGreaterThanOrEqual(12));
    expect(route.distanceKm).toBeGreaterThan(240);
    expect(route.distanceKm).toBeLessThan(330);
  });

  test('a full battery needs fewer stops than a low one', async () => {
    const low = await services.route.plan(request(45));
    const high = await services.route.plan(request(100));
    expect(low.stops.length).toBeGreaterThanOrEqual(high.stops.length);
  });

  test('refuses an unreachable plan instead of faking one', async () => {
    await expect(services.route.plan(request(13))).rejects.toThrow(
      /reachable|charge/i,
    );
  });

  test('switching to the backup replans without the failed station', async () => {
    const route = await services.route.plan(request(60));
    const failed = route.stops[0].station.id;
    const next = await services.route.switchToBackup(route, 0);
    expect(next.stops.some(s => s.station.id === failed)).toBe(false);
    next.stops.forEach(s => expect(s.backup.id).not.toBe(s.station.id));
  });
});

describe('sessionService + paymentService', () => {
  const connector = 'st-chargezone-manesar-c1';

  test('remote start needs a validated payment method', async () => {
    await expect(
      services.session.start({
        stationId: 'st-chargezone-manesar',
        connectorId: connector,
        targetSoc: 80,
        paymentMethodId: 'pm-wallet', // seeded as not validated
      }),
    ).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(appStore.get().session).toBeNull();
  });

  test('external stations never get a fake remote start', async () => {
    await expect(
      services.session.start({
        stationId: 'st-jiobp-lodhi',
        connectorId: 'st-jiobp-lodhi-c1',
        targetSoc: 80,
        paymentMethodId: 'pm-upi',
      }),
    ).rejects.toBeInstanceOf(IntegrationUnavailableError);
  });

  test('an occupied connector is refused', async () => {
    await expect(
      services.session.start({
        stationId: 'st-chargezone-sec16',
        connectorId: 'st-chargezone-sec16-c2',
        targetSoc: 80,
        paymentMethodId: 'pm-upi',
      }),
    ).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });

  test('integration outage falls back to operator instructions', async () => {
    demoStore.set({integrationDown: true});
    await expect(
      services.session.start({
        stationId: 'st-chargezone-manesar',
        connectorId: connector,
        targetSoc: 80,
        paymentMethodId: 'pm-upi',
      }),
    ).rejects.toBeInstanceOf(IntegrationUnavailableError);
  });

  test('start -> stop -> failed payment -> retry -> receipt in history', async () => {
    const started = await services.session.start({
      stationId: 'st-chargezone-manesar',
      connectorId: connector,
      targetSoc: 80,
      paymentMethodId: 'pm-upi',
    });
    expect(started.status).toBe('active');
    expect(started.preauthId).toBeTruthy();
    // Persisted in the store immediately (this is what restart recovery reads).
    expect(appStore.get().session?.id).toBe(started.id);

    const stopped = await services.session.stop(started.id);
    expect(stopped.status).toBe('payment_due');

    demoStore.set({paymentFail: 'next'});
    const failed = await services.payment.pay(started.id, 'pm-upi');
    expect(failed.ok).toBe(false);
    expect(appStore.get().session?.status).toBe('payment_failed');
    expect(appStore.get().session?.failureReason).toBeTruthy();

    const ok = await services.payment.pay(started.id, 'pm-card');
    expect(ok.ok).toBe(true);
    expect(appStore.get().session).toBeNull();
    expect(appStore.get().history[0].id).toBe(started.id);
    expect(appStore.get().history[0].status).toBe('paid');
  });

  const startInput = {
    stationId: 'st-chargezone-manesar',
    connectorId: connector,
    targetSoc: 80,
    paymentMethodId: 'pm-upi',
  };

  test('a second start never overwrites an open session', async () => {
    const first = await services.session.start(startInput);
    await expect(services.session.start(startInput)).rejects.toBeInstanceOf(
      SessionInProgressError,
    );
    expect(appStore.get().session?.id).toBe(first.id);
    // Same while the first one is stopped and still unpaid.
    await services.session.stop(first.id);
    await expect(services.session.start(startInput)).rejects.toBeInstanceOf(
      SessionInProgressError,
    );
    expect(appStore.get().session?.status).toBe('payment_due');
  });

  test('two simultaneous starts (double tap) open exactly one session', async () => {
    const results = await Promise.allSettled([
      services.session.start(startInput),
      services.session.start(startInput),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    expect(rejected?.reason).toBeInstanceOf(SessionInProgressError);
  });

  test('a pre-authorisation that errors leaves no phantom session', async () => {
    const pending = services.session.start(startInput);
    // Let the first service call finish, then break the payment gateway call.
    await new Promise<void>(r => setTimeout(() => r(), 0));
    demoStore.set({apiError: true});
    await expect(pending).rejects.toThrow();
    expect(appStore.get().session).toBeNull();
  });

  test('a session interrupted mid-authorisation is cleaned up', async () => {
    appStore.set({
      session: {
        ...(await services.session.start({
          stationId: 'st-chargezone-manesar',
          connectorId: connector,
          targetSoc: 80,
          paymentMethodId: 'pm-upi',
        })),
        status: 'authorising',
      },
    });
    await services.session.cancelPending();
    expect(appStore.get().session).toBeNull();
  });

  test('an active session recomputes the same numbers after a restart', async () => {
    const started = await services.session.start({
      stationId: 'st-chargezone-manesar',
      connectorId: connector,
      targetSoc: 80,
      paymentMethodId: 'pm-upi',
    });
    const later = started.startedAt + 90_000;
    const before = computeSessionMetrics(started, later);
    // "Restart": state is reloaded from its serialised form.
    const reloaded = JSON.parse(JSON.stringify(appStore.get().session));
    expect(computeSessionMetrics(reloaded, later)).toEqual(before);
  });
});
