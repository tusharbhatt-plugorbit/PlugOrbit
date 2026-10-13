/**
 * @format
 */

import {createMockServices} from '../src/services';
import {ApiError} from '../src/services/types';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {isCompatible, stationHealth} from '../src/domain/rules';
import {stopCostLabel, tripCost} from '../src/domain/routeCost';
import type {Route, RouteStrategy, Vehicle} from '../src/domain/types';
import {appStore, resetAppStore} from '../src/store/appStore';
import {demoStore, resetDemo} from '../src/store/demoStore';
import {seedState} from '../src/store/seed';
import {cacheRoute} from '../src/store/tripActions';
import {distanceKm} from '../src/utils/geo';

const services = createMockServices();

const nexon: Vehicle = {...VEHICLE_CATALOG[0], id: 'veh-1'};
const STRATEGIES: RouteStrategy[] = ['fastest', 'cheapest', 'reliable'];

function boot(vehicle: Vehicle, soc = 60) {
  resetAppStore({
    ...seedState(Date.now()),
    vehicles: [vehicle],
    activeVehicleId: vehicle.id,
    battery: {percent: soc, source: 'manual', updatedAt: Date.now()},
  });
  resetDemo();
}

beforeEach(() => boot(nexon));

const plan = (
  startSoc: number,
  strategy: RouteStrategy = 'reliable',
  opts: {
    vehicle?: Vehicle;
    from?: string;
    to?: string;
    via?: string[];
  } = {},
) =>
  services.route.plan({
    fromLabel: opts.from ?? 'Delhi',
    toLabel: opts.to ?? 'Jaipur',
    via: opts.via,
    startSoc,
    strategy,
    vehicle: opts.vehicle ?? nexon,
    safetyReservePct: 12,
    avoidPaidParking: false,
  });

/** Every plan the sweeps below look at: cars x directions x strategies x SoC. */
async function sweep(
  visit: (route: Route, vehicle: Vehicle, tag: string) => Promise<void> | void,
) {
  for (const model of VEHICLE_CATALOG) {
    const vehicle: Vehicle = {...model, id: `veh-${model.modelId}`};
    for (const [from, to] of [
      ['Delhi', 'Jaipur'],
      ['Jaipur', 'Delhi'],
    ]) {
      for (const strategy of STRATEGIES) {
        for (const soc of [30, 42, 60, 85, 100]) {
          boot(vehicle, soc);
          let route: Route;
          try {
            route = await plan(soc, strategy, {vehicle, from, to});
          } catch (e) {
            expect(e).toBeInstanceOf(ApiError); // refusing is allowed
            continue;
          }
          await visit(
            route,
            vehicle,
            `${model.model} ${from}>${to} ${strategy} ${soc}%`,
          );
        }
      }
    }
  }
}

describe('reference scenario (the demo walkthrough)', () => {
  test('Delhi to Jaipur at 60% stops at Neemrana with Highway Hub as backup', async () => {
    const route = await plan(60);
    expect(route.stops).toHaveLength(1);
    const stop = route.stops[0];
    expect(stop.station.name).toBe('ChargeZone • Neemrana');
    expect(stop.arriveSoc).toBe(18);
    expect(stop.chargeToSoc).toBe(70);
    expect(stop.backup?.name).toBe('Statiq • Highway Hub');
    expect(stop.backup?.id).toBe('st-statiq-bawal');
    expect(stop.backupExtraMin).toBeLessThanOrEqual(30);
  });
});

describe('backup quality', () => {
  test('a backup is a short, reachable, compatible, usable detour; otherwise null with a reason', async () => {
    let stops = 0;
    let withBackup = 0;
    await sweep((route, vehicle, tag) => {
      const pctPerKm = 100 / vehicle.rangeKm100;
      route.stops.forEach(stop => {
        stops++;
        if (!stop.backup) {
          expect(stop.backupNote).toMatch(/no compatible backup/i);
          expect(stop.backupExtraMin).toBe(0);
          return;
        }
        withBackup++;
        const where = `${tag}: ${stop.station.name} -> ${stop.backup.name}`;
        expect({where, ok: stop.backup.id !== stop.station.id}).toEqual({
          where,
          ok: true,
        });
        expect(isCompatible(stop.backup, vehicle)).toBe(true);
        expect(stationHealth(stop.backup, vehicle)).not.toBe('offline');
        // The old planner offered backups 83-247 min / 90-150 km away.
        expect({where, extra: stop.backupExtraMin <= 30}).toEqual({
          where,
          extra: true,
        });
        const km = distanceKm(stop.station, stop.backup) * 1.16;
        expect({where, closeKm: km <= 45}).toEqual({where, closeKm: true});
        // ...and the driver must be able to drive there on the arrival SoC.
        expect({where, reach: stop.arriveSoc - km * pctPerKm >= 4}).toEqual({
          where,
          reach: true,
        });
      });
    });
    expect(stops).toBeGreaterThan(150);
    // The corridor is dense enough that most stops do have a real backup.
    expect(withBackup / stops).toBeGreaterThan(0.8);
  });

  test('says so honestly when nothing qualifies, instead of a far station', async () => {
    // Shahpura is 50 km from its neighbours: no real backup exists there.
    boot(nexon, 42);
    const route = await plan(42, 'reliable', {from: 'Jaipur', to: 'Delhi'});
    const lonely = route.stops.find(s => !s.backup);
    expect(lonely).toBeDefined();
    expect(lonely?.station.id).toBe('st-chargezone-shahpura');
    expect(lonely?.backupNote).toMatch(/no compatible backup charger/i);
    expect(lonely?.backupExtraMin).toBe(0);
  });
});

describe('charge-to percentages', () => {
  test('are whole numbers and never below the arrival level', async () => {
    let checked = 0;
    await sweep(route => {
      route.stops.forEach(s => {
        checked++;
        expect(Number.isInteger(s.arriveSoc)).toBe(true);
        expect(Number.isInteger(s.chargeToSoc)).toBe(true);
        expect(s.chargeToSoc).toBeGreaterThanOrEqual(s.arriveSoc);
      });
    });
    expect(checked).toBeGreaterThan(100);
  });

  test('a full Nexon no longer prints 70.35%', async () => {
    const route = await plan(100);
    expect(route.stops[0].chargeToSoc).toBe(70);
  });
});

describe('stop cost', () => {
  const kwhFor = (s: Route['stops'][number], v: Vehicle) =>
    ((s.chargeToSoc - s.arriveSoc) / 100) * v.batteryKwh;

  test('is priced at the connector the stop actually uses', async () => {
    let priced = 0;
    await sweep((route, vehicle, tag) => {
      route.stops.forEach(s => {
        const connector = s.station.connectors.find(
          c => c.id === s.connectorId,
        );
        expect(connector).toBeDefined();
        expect(vehicle.connectors).toContain(connector?.type);
        if (connector?.pricePerKwh == null) {
          expect({tag, cost: s.costInr}).toEqual({tag, cost: null});
          return;
        }
        priced++;
        // Whole-percent display values are within half a percent of the
        // exact maths, i.e. about Rs 6 on the dearest chargers.
        const expected = kwhFor(s, vehicle) * connector.pricePerKwh * 1.18;
        expect(Math.abs((s.costInr ?? NaN) - expected)).toBeLessThan(8);
      });
    });
    expect(priced).toBeGreaterThan(100);
  });

  test('the cheapest strategy at Neemrana Hub bills the CCS2 connector, not the Rs 11 Type2 one', async () => {
    const route = await plan(60, 'cheapest');
    const stop = route.stops[0];
    expect(stop.station.id).toBe('st-glida-neemrana');
    const connector = stop.station.connectors.find(
      c => c.id === stop.connectorId,
    );
    expect(connector?.type).toBe('CCS2');
    expect(connector?.pricePerKwh).toBe(15);
    expect(stop.costInr ?? 0).toBeGreaterThan(
      kwhFor(stop, nexon) * 15 * 1.18 - 8,
    );
  });

  test('is null, never an invented Rs 18, when no price is published', async () => {
    // Jio-bp Lodhi Road (no price feed) is the Delhi-Agra pick.
    const route = await plan(42, 'fastest', {to: 'Agra'});
    const unpriced = route.stops.find(s => s.station.id === 'st-jiobp-lodhi');
    expect(unpriced).toBeDefined();
    expect(unpriced?.costInr).toBeNull();
    expect(stopCostLabel(unpriced?.costInr ?? null)).toBe(
      'Price not published',
    );
    expect(tripCost(route.stops).label).toBe('Price not published');
  });
});

describe('Switch to backup', () => {
  test('lands on exactly the backup that was shown and recomputes the stop', async () => {
    const route = await plan(60);
    const shown = route.stops[0].backup;
    const next = await services.route.switchToBackup(route, 0);
    expect(next.stops[0].station.id).toBe(shown?.id);
    expect(next.stops[0].station.id).not.toBe(route.stops[0].station.id);
    // Battery maths is redone from the start for the new stop.
    expect(next.stops[0].arriveSoc).not.toBe(route.stops[0].arriveSoc);
    expect(next.stops[0].arriveSoc).toBeGreaterThanOrEqual(12);
    expect(next.arriveSoc).toBeGreaterThanOrEqual(12);
    expect(Number.isInteger(next.stops[0].chargeToSoc)).toBe(true);
    // The new stop gets its own backup, never the charger that just failed.
    expect(next.stops[0].backup).not.toBeNull();
    expect(next.stops[0].backup?.id).not.toBe(route.stops[0].station.id);
    expect(next.stops[0].backup?.id).not.toBe(next.stops[0].station.id);
    // And it can be switched again.
    const again = await services.route.switchToBackup(next, 0);
    expect(again.stops[0].station.id).toBe(next.stops[0].backup?.id);
    expect(
      again.stops.some(s => s.station.id === route.stops[0].station.id),
    ).toBe(false);
  });

  test('always lands on the shown backup, for every stop of every plan', async () => {
    let switched = 0;
    await sweep(async (route, _vehicle, tag) => {
      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        if (!stop.backup) {
          continue;
        }
        const next = await services.route.switchToBackup(route, i);
        switched++;
        expect({tag, landed: next.stops[i].station.id}).toEqual({
          tag,
          landed: stop.backup.id,
        });
        expect(next.stops.some(s => s.station.id === stop.station.id)).toBe(
          false,
        );
        // Stops before it are untouched; the road is the same road.
        expect(next.stops.slice(0, i).map(s => s.station.id)).toEqual(
          route.stops.slice(0, i).map(s => s.station.id),
        );
        expect(next.polyline).toEqual(route.polyline);
        next.stops.forEach(s => {
          expect(s.arriveSoc).toBeGreaterThanOrEqual(12);
          expect(s.backup !== null || s.backupNote !== undefined).toBe(true);
        });
      }
    });
    expect(switched).toBeGreaterThan(100);
  });

  test('keeps the waypoints of a multi-stop trip', async () => {
    for (const strategy of STRATEGIES) {
      const route = await plan(60, strategy, {via: ['Neemrana']});
      expect(route.via).toEqual(['Neemrana']);
      const next = await services.route.switchToBackup(route, 0);
      expect(next.via).toEqual(['Neemrana']);
      expect(next.polyline).toHaveLength(route.polyline.length);
      expect(next.polyline).toEqual(route.polyline);
      expect(next.distanceKm).toBe(route.distanceKm);
    }
  });

  test('refuses, rather than inventing one, when the stop has no backup', async () => {
    const route = await plan(42, 'reliable', {from: 'Jaipur', to: 'Delhi'});
    const index = route.stops.findIndex(s => !s.backup);
    expect(index).toBeGreaterThanOrEqual(0);
    await expect(
      services.route.switchToBackup(route, index),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('presenter "make my chosen charger occupied"', () => {
  test('applies to the charger that was chosen, not to the backup you switch to', async () => {
    const route = await plan(60);
    cacheRoute(route, 0);
    const failedId = route.stops[0].station.id;
    demoStore.set({stationOccupied: true});

    const failed = await services.station.get(failedId);
    expect(failed.connectors.every(c => c.status === 'occupied')).toBe(true);

    // BackupAlert: switch, then cache the new plan (the backup becomes chosen).
    const next = await services.route.switchToBackup(route, 0);
    cacheRoute(next, 0);
    expect(appStore.get().chosen?.stationId).toBe(next.stops[0].station.id);

    const landed = await services.station.get(next.stops[0].station.id);
    expect(landed.connectors.some(c => c.status === 'available')).toBe(true);
    // The charger that failed stays failed, and the next switch still works.
    const stillFailed = await services.station.get(failedId);
    expect(stillFailed.connectors.every(c => c.status === 'occupied')).toBe(
      true,
    );
    const again = await services.route.switchToBackup(next, 0);
    cacheRoute(again, 0);
    const second = await services.station.get(again.stops[0].station.id);
    expect(second.connectors.some(c => c.status === 'available')).toBe(true);
  });

  test('turning the switch off and on again targets the chosen charger of that moment', async () => {
    const route = await plan(60);
    cacheRoute(route, 0);
    demoStore.set({stationOccupied: true});
    await services.station.get(route.stops[0].station.id);

    const next = await services.route.switchToBackup(route, 0);
    cacheRoute(next, 0);
    demoStore.set({stationOccupied: false});
    demoStore.set({stationOccupied: true});

    const now = await services.station.get(next.stops[0].station.id);
    expect(now.connectors.every(c => c.status === 'occupied')).toBe(true);
    const old = await services.station.get(route.stops[0].station.id);
    expect(old.connectors.some(c => c.status === 'available')).toBe(true);
  });
});
