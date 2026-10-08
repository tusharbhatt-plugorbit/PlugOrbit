import {
  planCharging,
  summariseRuledOut,
} from '../../src/intelligence/chargingPlan';
import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {
  DELHI_JAIPUR_PATH,
  LEAF,
  NEXON_EV,
  mockStations,
  noon,
  scenarioInput,
  withStationStatus,
} from '../../src/dev/smartDriveFixtures';
import {buildPath} from '../../src/utils/path';

const now = noon();

describe('the first scenario: Nexon EV, 72%, Delhi to Jaipur', () => {
  const plan = planCharging(scenarioInput(now));

  test('knows the battery cannot finish the trip, but you can set off', () => {
    expect(plan.chargingRequired).toBe(true);
    expect(plan.readiness).toBe('good_to_drive');
    expect(plan.mode).toBe('normal');
    expect(plan.destination.socWithoutCharging.low).toBeLessThan(12);
  });

  test('selects a future primary stop AND a backup', () => {
    expect(plan.primary).not.toBeNull();
    expect(plan.backup).not.toBeNull();
    expect(plan.backup?.station.id).not.toBe(plan.primary?.station.id);
  });

  test('the primary is reachable with the reserve intact', () => {
    expect(plan.primary?.metrics.arriveSoc.low).toBeGreaterThanOrEqual(12);
  });

  test('the backup is also reachable, even from a dead primary', () => {
    expect(plan.backup?.metrics.arriveSoc.low).toBeGreaterThanOrEqual(12);
    expect(plan.backup?.fromPrimarySoc.low).toBeGreaterThanOrEqual(
      config.absoluteFloorPct,
    );
  });

  test('prefers a backup that fails independently', () => {
    expect(plan.backup?.independent).toBe(true);
    expect(plan.backup?.station.operator).not.toBe(
      plan.primary?.station.operator,
    );
  });

  test('is not simply the nearest, the fastest or the cheapest charger', () => {
    const all = [plan.primary, plan.backup, ...plan.alternatives].filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );
    const nearest = [...all].sort((a, b) => a.alongKm - b.alongKm)[0];
    const fastest = [...all].sort(
      (a, b) => b.metrics.chargerKw - a.metrics.chargerKw,
    )[0];
    const cheapest = [...all]
      .filter(s => s.metrics.cost.totalInr !== null)
      .sort(
        (a, b) =>
          (a.metrics.cost.totalInr as number) -
          (b.metrics.cost.totalInr as number),
      )[0];
    expect(plan.primary?.station.id).not.toBe(nearest.station.id);
    expect(plan.primary?.station.id).not.toBe(fastest.station.id);
    expect(plan.primary?.station.id).not.toBe(cheapest.station.id);
  });

  test('a stop that lets one charge finish the trip beats early top-ups', () => {
    expect(plan.stopsAfterPrimary).toBe(0);
    expect(plan.primary?.reasons).toContain('REASON_FEWER_STOPS');
  });

  test('charges just enough, not to 100%', () => {
    const m = plan.primary?.metrics;
    expect(m?.targetSoc).toBeLessThan(80);
    expect(m?.targetReason).toBe('finish_trip');
    expect(m?.savedVsCapMin).toBeGreaterThan(0);
  });

  test('every recommendation carries reason codes', () => {
    expect(plan.primary?.reasons.length).toBeGreaterThan(2);
    expect(plan.primary?.reasons).toContain('REASON_COMPATIBLE');
  });

  test('says what it ruled out and why', () => {
    expect(plan.considered).toBeGreaterThan(5);
    const summary = summariseRuledOut(plan.ruledOut);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.map(s => s.code)).toEqual(
      expect.arrayContaining(['UNREACHABLE']),
    );
  });

  test('is deterministic', () => {
    expect(planCharging(scenarioInput(now))).toEqual(plan);
  });
});

describe('safety is enforced before ranking', () => {
  test('nothing ruled out is ever recommended', () => {
    const plan = planCharging(scenarioInput(now));
    const ruled = new Set(plan.ruledOut.map(r => r.stationId));
    const chosen = [plan.primary, plan.backup, ...plan.alternatives]
      .filter(Boolean)
      .map(s => s?.station.id as string);
    chosen.forEach(id => expect(ruled.has(id)).toBe(false));
  });

  test('every recommended stop respects the reserve in normal mode', () => {
    const plan = planCharging(scenarioInput(now));
    [plan.primary, plan.backup, ...plan.alternatives].forEach(s => {
      expect(s?.metrics.arriveSoc.low).toBeGreaterThanOrEqual(12);
    });
  });

  test('a charger known to be offline is not recommended', () => {
    const first = planCharging(scenarioInput(now));
    const id = first.primary?.station.id as string;
    const stations = withStationStatus(mockStations(now), id, 'offline', now);
    const plan = planCharging(scenarioInput(now, {stations}));
    expect(plan.primary?.station.id).not.toBe(id);
    expect(plan.backup?.station.id).not.toBe(id);
    expect(plan.ruledOut.find(r => r.stationId === id)?.codes).toContain(
      'CHARGER_OFFLINE',
    );
  });

  test('a CHAdeMO car is only offered connectors it can plug into', () => {
    const plan = planCharging(scenarioInput(now, {vehicle: LEAF}));
    [plan.primary, plan.backup, ...plan.alternatives].forEach(s => {
      if (s) {
        // The Leaf also has a Type 2 (AC) port, so that is allowed; CCS2 is not.
        expect(LEAF.connectors).toContain(s.metrics.connectorType);
      }
    });
    // For a long trip the primary is a DC fast charger it can actually use.
    expect(plan.primary?.metrics.connectorType).toBe('CHAdeMO');
    expect(
      plan.ruledOut.some(r => r.codes.includes('INCOMPATIBLE_CONNECTOR')),
    ).toBe(true);
  });

  test('a stale feed is never labelled live', () => {
    const later = planCharging(scenarioInput(now, {now: now + 20 * 60000}));
    expect(later.primary?.dataConfidence).not.toBe('live');
  });
});

describe('necessity: no pointless stops', () => {
  test('does not stop at the start line with a nearly full battery', () => {
    const plan = planCharging(scenarioInput(now, {vehicle: LEAF}));
    // A 7 kW stop two hours long at km 0 used to win on many small advantages.
    expect(plan.primary?.alongKm).toBeGreaterThan(50);
    expect(plan.primary?.metrics.connectorType).toBe('CHAdeMO');
    expect(plan.tooEarly.length).toBeGreaterThan(0);
    expect(plan.tooEarly).not.toContain(plan.primary?.station.id);
  });

  test('skipped stops are safe ones, just not needed yet', () => {
    const plan = planCharging(scenarioInput(now, {vehicle: LEAF}));
    const ruled = new Set(plan.ruledOut.map(r => r.stationId));
    plan.tooEarly.forEach(id => expect(ruled.has(id)).toBe(false));
  });

  test('an honest answer for a car the corridor cannot serve well', () => {
    const plan = planCharging(scenarioInput(now, {vehicle: LEAF}));
    expect(plan.routeRisk).toBe('high');
    expect(plan.backup).toBeNull();
    expect(plan.limitedOptions).toBe(true);
  });

  test('the Nexon plan is unaffected (its stop was already well-timed)', () => {
    const plan = planCharging(scenarioInput(now));
    expect(plan.primary?.station.name).toContain('Neemrana');
  });

  test('a late top-up before the destination is still allowed', () => {
    // 20 km from Jaipur with 25%: a small top-up is needed and nothing is later.
    const plan = planCharging(scenarioInput(now, {progressKm: 232, soc: 14}));
    expect(plan.chargingRequired).toBe(true);
  });
});

describe('when charging is not needed', () => {
  const short = buildPath(DELHI_JAIPUR_PATH.points.slice(0, 4)); // Delhi to Manesar

  test('no stop is planned and the driver is told they are fine', () => {
    const plan = planCharging(scenarioInput(now, {path: short}));
    expect(plan.chargingRequired).toBe(false);
    expect(plan.primary).toBeNull();
    expect(plan.backup).toBeNull();
    expect(plan.readiness).toBe('good_to_drive');
    expect(plan.routeRisk).toBe('low');
  });
});

describe('battery-critical mode', () => {
  const low = scenarioInput(now, {progressKm: 105, soc: 14});

  test('engages at or below the critical level', () => {
    const plan = planCharging(low);
    expect(plan.mode).toBe('battery_critical');
    expect(plan.modeReason).toBe('low_battery');
    expect(plan.routeRisk).toBe('high');
  });

  test('may accept a charger that dips into the reserve, and says it is the safest', () => {
    const plan = planCharging(low);
    expect(plan.primary).not.toBeNull();
    expect(plan.primary?.warnings).toContain('RESERVE_BREACH_ACCEPTED');
    expect(plan.primary?.reasons).toContain('REASON_SAFEST_REACHABLE');
    expect(plan.primary?.metrics.arriveSoc.low).toBeGreaterThanOrEqual(
      config.absoluteFloorPct,
    );
  });

  test('picks the safest reachable charger even when a preference says otherwise', () => {
    const cheap = planCharging({...low, profile: 'cheapest'});
    const fast = planCharging({...low, profile: 'fastest'});
    const plain = planCharging(low);
    expect(cheap.primary?.station.id).toBe(plain.primary?.station.id);
    expect(fast.primary?.station.id).toBe(plain.primary?.station.id);
  });

  test('also engages when no charger can be reached with the reserve intact', () => {
    const plan = planCharging(scenarioInput(now, {progressKm: 172, soc: 26}));
    expect(plan.mode).toBe('battery_critical');
    expect(plan.modeReason).toBe('no_safe_option_with_reserve');
    expect(plan.primary).not.toBeNull();
    expect(plan.limitedOptions).toBe(true);
  });

  test('says so honestly when nothing can be reached at all', () => {
    const plan = planCharging(scenarioInput(now, {progressKm: 172, soc: 18}));
    expect(plan.primary).toBeNull();
    expect(plan.readiness).toBe('limited_options');
    expect(plan.routeRisk).toBe('high');
  });
});

describe('stability: a plan the driver has heard does not flip for nothing', () => {
  const first = planCharging(scenarioInput(now));
  const alt = first.alternatives[0];

  test('keeps the incumbent unless the gain is real', () => {
    const lax = {
      ...config,
      switchMinSavingMin: 999,
      switchScoreMargin: 999,
      switchLockSavingMin: 999,
    };
    const plan = planCharging(
      scenarioInput(now, {config: lax, incumbentId: alt.station.id}),
    );
    expect(plan.primary?.station.id).toBe(alt.station.id);
    expect(plan.switched).toBeNull();
    expect(plan.held?.stationId).toBe(first.primary?.station.id);
  });

  test('switches when the saving is clear', () => {
    const plan = planCharging(
      scenarioInput(now, {incumbentId: alt.station.id}),
    );
    if (plan.switched) {
      expect(plan.switched.from).toBe(alt.station.id);
      expect(plan.switched.to).toBe(plan.primary?.station.id);
      expect(plan.switched.reason).not.toBe('safety');
    } else {
      // Not worth changing: then the incumbent stays and the gain is recorded.
      expect(plan.primary?.station.id).toBe(alt.station.id);
    }
  });

  test('an incumbent that becomes unsafe is replaced, whatever the margin', () => {
    const id = first.primary?.station.id as string;
    const stations = withStationStatus(mockStations(now), id, 'offline', now);
    const plan = planCharging(
      scenarioInput(now, {stations, incumbentId: id, holdIncumbent: true}),
    );
    expect(plan.switched).toMatchObject({from: id, reason: 'safety'});
    expect(plan.primary?.station.id).not.toBe(id);
  });

  test('a charger the driver pinned stays, while it is safe', () => {
    const plan = planCharging(scenarioInput(now, {pinnedId: alt.station.id}));
    expect(plan.primary?.station.id).toBe(alt.station.id);
  });

  test('driving past a stop is not a "switch"', () => {
    const id = first.primary?.station.id as string;
    const plan = planCharging(
      scenarioInput(now, {progressKm: 140, soc: 28, incumbentId: id}),
    );
    expect(plan.switched).toBeNull();
  });

  test('a still-good backup is not swapped for a marginally better one', () => {
    const keep = first.backup?.station.id as string;
    const plan = planCharging(scenarioInput(now, {incumbentBackupId: keep}));
    expect(plan.backup?.station.id).toBe(keep);
  });
});

test('a stop stays in the plan until the driver has driven past it', () => {
  const first = planCharging(scenarioInput(now));
  const stop = first.primary!;
  const atJunction = planCharging(
    scenarioInput(now, {
      progressKm: stop.alongKm - 0.1,
      soc: 30,
      incumbentId: stop.station.id,
      holdIncumbent: true,
    }),
  );
  expect(atJunction.primary?.station.id).toBe(stop.station.id);
  const past = planCharging(
    scenarioInput(now, {
      progressKm: stop.alongKm + 2,
      soc: 29,
      excludeIds: [stop.station.id],
    }),
  );
  expect(past.primary?.station.id).not.toBe(stop.station.id);
});

test('uses the user-supplied reserve', () => {
  const careful = planCharging(scenarioInput(now, {reservePct: 25}));
  careful.primary &&
    expect(careful.primary.metrics.arriveSoc.low).toBeGreaterThanOrEqual(25);
  expect(NEXON_EV.id).toBe('veh-1');
});
