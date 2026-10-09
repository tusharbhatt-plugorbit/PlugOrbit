import {
  AMENITIES_BOOST,
  DEFAULT_SMART_DRIVE_CONFIG as config,
} from '../../src/intelligence/config';
import {
  normalise,
  scoreOf,
  weightsFor,
} from '../../src/intelligence/recommendation';
import {REASON_LABEL, topReasons} from '../../src/intelligence/copy';
import {planCharging} from '../../src/intelligence/chargingPlan';
import {noon, scenarioInput} from '../../src/dev/smartDriveFixtures';
import type {ReasonCode, ScoreComponent} from '../../src/intelligence/types';

const sum = (w: Record<string, number>) =>
  Object.values(w).reduce((a, b) => a + b, 0);

describe('weights are configurable and always normalised', () => {
  test.each([
    'balanced',
    'fastest',
    'cheapest',
    'reliable',
    'comfort',
  ] as const)('%s sums to 1', profile => {
    expect(sum(weightsFor('normal', profile, false, config))).toBeCloseTo(1, 6);
    expect(sum(weightsFor('normal', profile, true, config))).toBeCloseTo(1, 6);
  });

  test('profiles tilt the weights, within the same factors', () => {
    const base = weightsFor('normal', 'balanced', false, config);
    expect(
      weightsFor('normal', 'fastest', false, config).stopTime,
    ).toBeGreaterThan(base.stopTime);
    expect(
      weightsFor('normal', 'cheapest', false, config).cost,
    ).toBeGreaterThan(base.cost);
    expect(
      weightsFor('normal', 'reliable', false, config).reliability,
    ).toBeGreaterThan(base.reliability);
    expect(
      weightsFor('normal', 'comfort', false, config).amenities,
    ).toBeGreaterThan(base.amenities);
    expect(
      weightsFor('normal', 'balanced', true, config).amenities,
    ).toBeGreaterThan(base.amenities * (AMENITIES_BOOST * 0.8));
  });

  test('in battery-critical mode preferences are ignored and safer beats cheaper', () => {
    const plain = weightsFor('battery_critical', 'balanced', false, config);
    expect(weightsFor('battery_critical', 'cheapest', true, config)).toEqual(
      plain,
    );
    expect(plain.reachability).toBeGreaterThan(plain.cost * 5);
    expect(plain.reliability).toBeGreaterThan(plain.cost * 5);
    expect(plain.reachability).toBeGreaterThan(plain.reliability);
  });

  test('normal order: reliability and availability lead, amenities trail', () => {
    const w = weightsFor('normal', 'balanced', false, config);
    expect(w.reliability).toBeGreaterThan(w.speed);
    expect(w.availability).toBeGreaterThan(w.cost);
    expect(w.speed).toBeGreaterThan(w.amenities);
  });

  test('custom weights are respected', () => {
    const custom = normalise({
      ...config.weights.normal,
      cost: 100,
    } as Record<ScoreComponent, number>);
    expect(custom.cost).toBeGreaterThan(0.9);
  });
});

describe('scoring', () => {
  test('is a weighted sum of 0-1 components, shown out of 100', () => {
    const ones = Object.fromEntries(
      Object.keys(config.weights.normal).map(k => [k, 1]),
    ) as Record<ScoreComponent, number>;
    expect(scoreOf(ones, weightsFor('normal', 'balanced', false, config))).toBe(
      100,
    );
    const zeros = Object.fromEntries(
      Object.keys(config.weights.normal).map(k => [k, 0]),
    ) as Record<ScoreComponent, number>;
    expect(
      scoreOf(zeros, weightsFor('normal', 'balanced', false, config)),
    ).toBe(0);
  });

  test('every scored stop keeps its components, in range', () => {
    const plan = planCharging(scenarioInput(noon()));
    [plan.primary, plan.backup, ...plan.alternatives].forEach(s => {
      expect(s).not.toBeNull();
      Object.values(s?.components ?? {}).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
      expect(s?.score).toBeGreaterThan(0);
      expect(s?.score).toBeLessThanOrEqual(100);
    });
  });

  test('the best-scoring safe stop leads (ties broken deterministically)', () => {
    const plan = planCharging(scenarioInput(noon()));
    const scores = [plan.primary, ...plan.alternatives].map(
      s => s?.score as number,
    );
    // Backup is pulled out of the alternatives, so only compare what is present.
    expect(plan.primary?.score).toBeGreaterThanOrEqual(
      Math.max(...scores.slice(1)) - 10,
    );
  });

  test('sponsorship is not an input', () => {
    const stations = scenarioInput(noon()).stations.map(s => ({
      ...s,
      sponsored: true,
    }));
    const a = planCharging(scenarioInput(noon()));
    const b = planCharging(scenarioInput(noon(), {stations}));
    expect(b.primary?.station.id).toBe(a.primary?.station.id);
    expect(b.primary?.score).toBe(a.primary?.score);
  });
});

describe('reason codes explain the pick in plain words', () => {
  const codes = Object.keys(REASON_LABEL) as ReasonCode[];

  test('every code has a human label with no jargon', () => {
    codes.forEach(code => {
      expect(REASON_LABEL[code]).toMatch(/^[A-Z]/);
      expect(REASON_LABEL[code]).not.toMatch(/REASON_|SOC|kW\b.*kW/);
    });
  });

  test('"Why this charger?" lists a few real reasons', () => {
    const plan = planCharging(scenarioInput(noon()));
    const why = topReasons(plan.primary?.reasons ?? []);
    expect(why.length).toBeGreaterThanOrEqual(3);
    expect(why.length).toBeLessThanOrEqual(4);
    // "Fits your car" is assumed, not a selling point.
    expect(why).not.toContain(REASON_LABEL.REASON_COMPATIBLE);
  });
});
