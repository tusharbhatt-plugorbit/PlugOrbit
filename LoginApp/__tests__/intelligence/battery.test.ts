import {
  consumptionFactor,
  driveMinutes,
  pctPerKm,
  safeReachKm,
  socAfterKm,
  socNeededFor,
} from '../../src/intelligence/battery';
import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {NEXON_EV} from '../../src/dev/smartDriveFixtures';

describe('BatteryPredictionService', () => {
  test('with no conditions it matches the rest of the app (range at 100%)', () => {
    expect(consumptionFactor()).toBe(1);
    expect(pctPerKm(NEXON_EV)).toBeCloseTo(100 / NEXON_EV.rangeKm100, 6);
  });

  test('an unknown condition never makes the estimate rosier', () => {
    expect(consumptionFactor({})).toBe(1);
    expect(consumptionFactor({temperatureC: 5})).toBeGreaterThan(1);
    expect(consumptionFactor({temperatureC: 40})).toBeGreaterThan(1);
    expect(consumptionFactor({elevationGainM: 800})).toBeGreaterThan(1);
    expect(consumptionFactor({speedKmh: 110})).toBeGreaterThan(1);
    expect(consumptionFactor({speedKmh: 66})).toBeCloseTo(1, 6);
  });

  test('predictions are a band: low <= expected <= high, and clamped', () => {
    const r = socAfterKm(NEXON_EV, 60, 90, config);
    expect(r.low).toBeLessThan(r.expected);
    expect(r.expected).toBeLessThan(r.high);
    expect(socAfterKm(NEXON_EV, 10, 500, config).low).toBe(0);
    expect(socAfterKm(NEXON_EV, 90, 0, config).high).toBe(90);
  });

  test('safe reach uses the pessimistic edge', () => {
    const km = safeReachKm(NEXON_EV, 72, 12, config);
    const naive = ((72 - 12) / 100) * NEXON_EV.rangeKm100;
    expect(km).toBeLessThan(naive);
    expect(km).toBeGreaterThan(naive * 0.85);
    // Driving exactly that far lands on the floor.
    expect(socAfterKm(NEXON_EV, 72, km, config).low).toBeCloseTo(12, 4);
  });

  test('battery needed round-trips with safe reach', () => {
    const need = socNeededFor(NEXON_EV, 100, 12, config);
    expect(safeReachKm(NEXON_EV, need, 12, config)).toBeCloseTo(100, 4);
    expect(socNeededFor(NEXON_EV, 0, 12, config)).toBe(12);
  });

  test('traffic stretches time, not energy', () => {
    const base = driveMinutes(66, config);
    expect(base).toBeCloseTo(60, 6);
    expect(driveMinutes(66, config, {trafficDelayFactor: 1.5})).toBeCloseTo(
      90,
      6,
    );
    expect(driveMinutes(66, config, {speedKmh: 33})).toBeCloseTo(120, 6);
    expect(pctPerKm(NEXON_EV, {trafficDelayFactor: 2})).toBe(
      pctPerKm(NEXON_EV),
    );
  });
});
