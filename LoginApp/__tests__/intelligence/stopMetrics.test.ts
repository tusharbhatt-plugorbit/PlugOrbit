import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {
  chargeTargetFor,
  chooseConnector,
  computeStopMetrics,
  estimateStopsAfter,
  stopCostFor,
} from '../../src/intelligence/stopMetrics';
import {NEXON_EV, mockStations, noon} from '../../src/dev/smartDriveFixtures';
import type {Station} from '../../src/domain/types';

const now = noon();
const stations = mockStations(now);
const get = (id: string) => stations.find(s => s.id === id) as Station;

describe('connector choice', () => {
  test('picks a free, compatible, working bay', () => {
    const c = chooseConnector(get('st-chargezone-neemrana'), NEXON_EV);
    expect(c?.type).toBe('CCS2');
    expect(c?.status).toBe('available');
  });
  test('never an offline bay', () => {
    expect(chooseConnector(get('st-tata-behror'), NEXON_EV)?.id).toBe(
      'st-tata-behror-c1',
    );
  });
  test('none when nothing fits', () => {
    expect(
      chooseConnector(
        {...get('st-chargezone-neemrana'), connectors: []},
        NEXON_EV,
      ),
    ).toBeNull();
  });
});

describe('charge target: how much, not "to 100%"', () => {
  const args = {
    vehicle: NEXON_EV,
    powerKw: 60,
    reservePct: 12,
    hasLaterOptions: false,
    config,
  };

  test('just enough to finish with the reserve and a small buffer', () => {
    const t = chargeTargetFor({...args, arriveSoc: 25, remainingKmAfter: 100});
    expect(t.reason).toBe('finish_trip');
    // 12% reserve + 100 km at ~0.367%/km + 4% buffer, about 53%.
    expect(t.targetSoc).toBeGreaterThanOrEqual(52);
    expect(t.targetSoc).toBeLessThanOrEqual(55);
    expect(t.savedVsCapMin).toBeGreaterThan(0);
  });

  test('never above the comfort cap when another stop can finish the job', () => {
    const t = chargeTargetFor({
      ...args,
      arriveSoc: 20,
      remainingKmAfter: 300,
      hasLaterOptions: true,
    });
    expect(t.targetSoc).toBe(config.maxChargeToPct);
    expect(t.reason).toBe('reach_next_stop');
    expect(t.savedVsCapMin).toBeNull();
  });

  test('beyond the cap only when nothing follows, and never past the hard cap', () => {
    const t = chargeTargetFor({...args, arriveSoc: 20, remainingKmAfter: 190});
    expect(t.targetSoc).toBeGreaterThan(config.maxChargeToPct);
    expect(t.targetSoc).toBeLessThanOrEqual(config.hardChargeCapPct);
    const huge = chargeTargetFor({
      ...args,
      arriveSoc: 20,
      remainingKmAfter: 900,
    });
    expect(huge.targetSoc).toBe(config.hardChargeCapPct);
  });

  test('a stop must add something useful, and never "charge down"', () => {
    const t = chargeTargetFor({...args, arriveSoc: 60, remainingKmAfter: 10});
    expect(t.targetSoc).toBeGreaterThanOrEqual(70);
    const high = chargeTargetFor({
      ...args,
      arriveSoc: 79.6,
      remainingKmAfter: 5,
    });
    expect(high.targetSoc).toBeGreaterThan(79.6);
  });
});

describe('total cost', () => {
  const neemranaC2 = get('st-chargezone-neemrana').connectors[1];

  test('energy plus tax, with unknown parts kept unknown', () => {
    const cost = stopCostFor(neemranaC2, 21, 68, NEXON_EV.batteryKwh, config);
    const kwh = ((68 - 21) / 100) * NEXON_EV.batteryKwh;
    expect(cost.energyInr).toBe(Math.round(kwh * 18));
    expect(cost.taxInr).toBe(Math.round(kwh * 18 * 0.18));
    expect(cost.totalInr).toBe(Math.round(kwh * 18 * 1.18));
    expect(cost.parkingInr).toBeNull();
    expect(cost.idleInr).toBe(0);
  });

  test('no published price means no total, not a partial sum', () => {
    const noPrice = {...neemranaC2, pricePerKwh: null};
    const cost = stopCostFor(noPrice, 21, 68, NEXON_EV.batteryKwh, config);
    expect(cost.energyInr).toBeNull();
    expect(cost.totalInr).toBeNull();
    expect(cost.taxInr).toBeNull();
  });

  test('a platform fee, when configured, is included and taxed', () => {
    const cost = stopCostFor(neemranaC2, 21, 68, NEXON_EV.batteryKwh, {
      platformFeeInr: 20,
    });
    const kwh = ((68 - 21) / 100) * NEXON_EV.batteryKwh;
    expect(cost.platformInr).toBe(20);
    expect(cost.totalInr).toBe(Math.round((kwh * 18 + 20) * 1.18));
  });
});

describe('stop metrics for this car, not for the charger', () => {
  const station = get('st-statiq-bawal'); // advertises 120 kW
  const connector = chooseConnector(station, NEXON_EV)!;
  const metrics = computeStopMetrics({
    station,
    connector,
    vehicle: NEXON_EV,
    now,
    progressKm: 0,
    soc: 72,
    alongKm: 98,
    lateralKm: 0.6,
    totalKm: 282,
    reservePct: 12,
    hasLaterOptions: false,
    config,
  });

  test('a 120 kW charger does not mean 120 kW for a 60 kW car', () => {
    expect(metrics.chargerKw).toBe(120);
    expect(metrics.expectedKw).toBeLessThanOrEqual(NEXON_EV.maxDcKw);
    expect(metrics.expectedKw).toBeGreaterThan(40);
  });

  test('arrival battery is a band that matches the distance driven', () => {
    expect(metrics.arriveSoc.expected).toBeCloseTo(72 - 98.6 * (100 / 300), 1);
    expect(metrics.arriveSoc.low).toBeLessThan(metrics.arriveSoc.expected);
  });

  test('total stop time is detour + wait + charge + back to route', () => {
    const wait =
      metrics.wait.basis === 'none'
        ? {min: 0, max: 10}
        : {min: metrics.wait.minMinutes, max: metrics.wait.maxMinutes};
    expect(metrics.totalStopMin.min).toBe(
      metrics.detourMin +
        wait.min +
        metrics.chargeMinutes.min +
        metrics.rejoinMin,
    );
    expect(metrics.totalStopMin.max).toBe(
      metrics.detourMin +
        wait.max +
        metrics.chargeMinutes.max +
        metrics.rejoinMin,
    );
    expect(metrics.totalStopMin.max).toBeGreaterThan(metrics.totalStopMin.min);
  });

  test('estimates are ranges, never a single false-precise number', () => {
    expect(metrics.chargeMinutes.max).toBeGreaterThan(
      metrics.chargeMinutes.min,
    );
  });
});

describe('looking past a stop', () => {
  const others = [60, 120, 180, 240].map(alongKm => ({alongKm}));

  test('knows when one stop is enough', () => {
    expect(
      estimateStopsAfter({
        vehicle: NEXON_EV,
        fromAlongKm: 125,
        totalKm: 282,
        reservePct: 12,
        others,
        config,
      }),
    ).toEqual({stopsAfter: 0, feasible: true});
  });

  test('counts the extra stops a bad choice forces', () => {
    const r = estimateStopsAfter({
      vehicle: NEXON_EV,
      fromAlongKm: 45,
      totalKm: 282,
      reservePct: 12,
      others,
      config,
    });
    expect(r.feasible).toBe(true);
    expect(r.stopsAfter).toBeGreaterThanOrEqual(1);
  });

  test('says so when the trip cannot be finished', () => {
    expect(
      estimateStopsAfter({
        vehicle: NEXON_EV,
        fromAlongKm: 45,
        totalKm: 282,
        reservePct: 12,
        others: [],
        config,
      }).feasible,
    ).toBe(false);
  });
});
