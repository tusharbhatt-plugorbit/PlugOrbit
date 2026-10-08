/**
 * @format
 *
 * The PlugOrbit decision engine: battery, vehicle-specific charging, charge
 * confidence, arrival outlook, trip impact, cost, route confidence, the
 * recommendation scorer and the trip state machine. All pure, no UI.
 */
import {
  batteryBand,
  batteryStatus,
  safeRangeKm,
  socCostOfKm,
} from '../src/domain/battery';
import {
  chargeConfidence,
  chargeConfidencePercent,
} from '../src/domain/chargeConfidence';
import {arrivalOutlook, NO_PREDICTION} from '../src/domain/arrivalOutlook';
import {chargeTargetFor, chargingNeed} from '../src/domain/chargingPlan';
import {
  coDriverEvents,
  CRITICAL_COOLDOWN_MS,
  DEFAULT_SMART_DRIVE_PREFS,
  deliveryFor,
} from '../src/domain/coDriver';
import {costLines, stopCostBreakdown} from '../src/domain/costBreakdown';
import {isOpenAt} from '../src/domain/openingHours';
import {
  Candidate,
  chooseConnector,
  compareCritical,
  recommend,
  RecommendationContext,
  scoreCharger,
  WEIGHTS,
} from '../src/domain/recommendation';
import {routeConfidence} from '../src/domain/routeConfidence';
import {extraMinutes, impactLabel, tripImpact} from '../src/domain/tripImpact';
import type {
  Station,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from '../src/domain/types';
import {estimateVehicleCharge} from '../src/domain/vehicleCharging';
import {buildStations, VEHICLE_CATALOG} from '../src/services/mock/data';
import {
  applyBattery,
  applyChargeEnded,
  applyOffline,
  applyPosition,
  applyStatusCheck,
  beginCharging,
  createTrip,
  decideSwitch,
  finishCharging,
  kmToStop,
  stopHealth,
} from '../src/domain/tripEngine';
import {driverStatus, tripStatus} from '../src/domain/tripStatus';
import {createRouteService} from '../src/services/mock/routeService';
import {waitFor} from '../src/services/mock/stationService';
import {resetAppStore} from '../src/store/appStore';
import {resetDemo} from '../src/store/demoStore';

const NEXON: Vehicle = {...VEHICLE_CATALOG[0], id: 'veh-1'};
const COMET: Vehicle = {
  ...VEHICLE_CATALOG.find(v => v.modelId === 'mg-comet')!,
  id: 'veh-2',
};
const LEAF: Vehicle = {
  ...VEHICLE_CATALOG.find(v => v.modelId === 'nissan-leaf')!,
  id: 'veh-3',
};

const NOW = new Date(2026, 5, 10, 14, 0, 0).getTime();
const all = buildStations(NOW);
const station = (id: string): Station => {
  const s = all.find(x => x.id === id);
  if (!s) {
    throw new Error(`no station ${id}`);
  }
  return s;
};
const near = (s: Station, km = 3): StationWithDistance => ({
  ...s,
  distanceKm: km,
  detourMin: Math.max(1, Math.round(km * 1.65)),
});
/** Every connector gets one status, with a fresh operator feed. */
const withStatus = (
  s: Station,
  status: Station['connectors'][number]['status'],
): Station => ({
  ...s,
  connectors: s.connectors.map(c => ({...c, status})),
  statusFeed: {source: 'operator_feed', updatedAt: NOW - 5000},
});

const waitOf = (s: Station, v: Vehicle): WaitEstimate => waitFor(s, v, NOW);
const cand = (s: StationWithDistance): Candidate => ({station: s});

const ctx = (
  over: Partial<RecommendationContext> = {},
): RecommendationContext => ({
  intent: 'charge_nearby',
  vehicle: NEXON,
  socPercent: 40,
  reservePct: 12,
  now: NOW,
  waitOf,
  ...over,
});

beforeEach(() => {
  resetDemo();
  resetAppStore();
});

// ================================================================= battery ==

describe('battery', () => {
  test('bands follow the thresholds, and a bigger reserve widens "low"', () => {
    expect(batteryBand(72)).toBe('comfortable');
    expect(batteryBand(30)).toBe('watch');
    expect(batteryBand(18)).toBe('low');
    expect(batteryBand(10)).toBe('critical');
    expect(batteryBand(5)).toBe('critical');
    expect(batteryBand(26, 20)).toBe('low');
    expect(batteryBand(26, 10)).toBe('watch');
  });

  test('range maths', () => {
    expect(socCostOfKm(NEXON, 30)).toBeCloseTo(10, 5);
    expect(safeRangeKm(NEXON, 72, 12)).toBeCloseTo(180, 5);
    expect(safeRangeKm(NEXON, 5, 12)).toBe(0);
  });

  test('driver wording is calm, not alarmist', () => {
    expect(batteryStatus(NEXON, 72, 12).headline).toBe('You’re good to drive.');
    expect(batteryStatus(NEXON, 18, 12).headline).toBe(
      'Charging recommended before your trip.',
    );
    const critical = batteryStatus(NEXON, 8, 12);
    expect(critical.headline).toBe(
      'Battery is low. We’ve found the safest charging option.',
    );
    expect(critical.tone).toBe('critical');
    const text = JSON.stringify(batteryStatus(NEXON, 8, 12));
    expect(text).not.toMatch(/WARNING|ERROR/);
  });
});

// ===================================================== vehicle-specific kW ==

describe('vehicle-specific charging', () => {
  test('a 120 kW charger does not charge a 60 kW car at 120 kW', () => {
    const fast = station('st-statiq-bawal').connectors[0]; // 120 kW CCS2
    const e = estimateVehicleCharge(fast, NEXON, 20, 80);
    expect(e.chargerKw).toBe(120);
    expect(e.peakKw).toBe(60);
    expect(e.limitedBy).toBe('car');
    expect(e.avgKw).toBeCloseTo(60, 0);
    // 24.3 kWh at 60 kW is ~24 min
    expect(e.minutes).toBeGreaterThanOrEqual(24);
    expect(e.minutes).toBeLessThanOrEqual(25);
  });

  test('the same car on a slower charger is limited by the charger', () => {
    const slow = station('st-tata-cp').connectors[1]; // 30 kW CCS2
    const e = estimateVehicleCharge(slow, NEXON, 20, 80);
    expect(e.peakKw).toBe(30);
    expect(e.limitedBy).toBe('charger');
    expect(e.minutes).toBeGreaterThan(
      estimateVehicleCharge(
        station('st-statiq-bawal').connectors[0],
        NEXON,
        20,
        80,
      ).minutes,
    );
  });

  test('a car that cannot fast charge cannot use a DC connector', () => {
    const dc = station('st-statiq-bawal').connectors[0];
    expect(estimateVehicleCharge(dc, COMET, 20, 80).canCharge).toBe(false);
    const ac = station('st-chargezone-sec16').connectors[2]; // Type2
    expect(estimateVehicleCharge(ac, COMET, 20, 80).canCharge).toBe(true);
  });
});

// ================================================================ confidence ==

describe('Charge Confidence', () => {
  test('a live, reliable, integrated charger is High, with reasons', () => {
    const c = chargeConfidence(station('st-chargezone-neemrana'), NEXON, NOW);
    expect(c.level).toBe('high');
    expect(c.label).toBe('High Charge Confidence');
    expect(c.reasons.length).toBeGreaterThan(1);
    expect(c.reasons.length).toBeLessThanOrEqual(4);
    expect(c.reasons[0].text).toMatch(/Live status/);
  });

  test('without a live feed it can never be High', () => {
    const est: Station = {
      ...station('st-chargezone-neemrana'),
      statusFeed: {source: 'google_places', updatedAt: NOW - 60_000},
    };
    const c = chargeConfidence(est, NEXON, NOW);
    expect(c.level).not.toBe('high');
    expect(c.reasons[0].text).toMatch(/estimated/);
    expect(c.reasons[0].tone).toBe('warn');
  });

  test('a fresh driver confirmation on a dependable charger can be High', () => {
    const fresh: Station = {
      ...station('st-chargezone-neemrana'),
      statusFeed: {source: 'user_report', updatedAt: NOW - 3 * 60_000},
    };
    expect(
      chargeConfidence(fresh, NEXON, NOW, {userConfirmations: 2}).level,
    ).toBe('high');
    const old: Station = {
      ...fresh,
      statusFeed: {source: 'user_report', updatedAt: NOW - 50 * 60_000},
    };
    expect(chargeConfidence(old, NEXON, NOW).level).not.toBe('high');
  });

  test('no status and no history is Low', () => {
    const blind: Station = {
      ...station('st-zeon-karolbagh'),
      reliabilityPct: 0,
      successfulSessionsPct: 0,
    };
    const c = chargeConfidence(blind, NEXON, NOW);
    expect(c.level).toBe('low');
    expect(c.reasons.map(r => r.text).join(' ')).toMatch(/can’t see/);
  });

  test('out-of-service bays lower it and are named', () => {
    const base = station('st-tata-behror'); // C2 offline
    const c = chargeConfidence(base, NEXON, NOW);
    expect(c.reasons.some(r => /out of service/.test(r.text))).toBe(true);
  });

  test('no percentage exists until there is real session history', () => {
    const c = chargeConfidence(station('st-chargezone-neemrana'), NEXON, NOW);
    expect(chargeConfidencePercent(c, null)).toBeNull();
    expect(chargeConfidencePercent(c, 5)).toBeNull();
    expect(chargeConfidencePercent(c, 120)).toBe(Math.round(c.score));
    const est = chargeConfidence(
      {
        ...station('st-chargezone-neemrana'),
        statusFeed: {source: 'estimate', updatedAt: NOW},
      },
      NEXON,
      NOW,
    );
    expect(chargeConfidencePercent(est, 500)).toBeNull();
  });
});

// ================================================================== outlook ==

describe('arrival outlook', () => {
  test('there is no predicted availability in Phase 1', () => {
    const o = arrivalOutlook(station('st-chargezone-neemrana'), NEXON, 30, NOW);
    expect(o.predicted).toBeNull();
    expect(
      NO_PREDICTION({
        station: station('st-tata-cp'),
        vehicle: NEXON,
        etaMin: 5,
        now: NOW,
      }),
    ).toBeNull();
  });

  test('a plugged-in predictor fills the slot, nothing else changes', () => {
    const o = arrivalOutlook(
      station('st-chargezone-neemrana'),
      NEXON,
      30,
      NOW,
      ({etaMin}) => ({
        probability: 0.78,
        etaMin,
        basis: 'model',
        confidence: 'medium',
      }),
    );
    expect(o.predicted?.probability).toBe(0.78);
  });

  test('one free bay and a long drive is flagged, not predicted', () => {
    const one = withStatus(station('st-chargezone-sec16'), 'occupied');
    const s: Station = {
      ...one,
      connectors: one.connectors.map((c, i) =>
        i === 0 ? {...c, status: 'available'} : c,
      ),
    };
    const lowRisk = arrivalOutlook(s, NEXON, 5, NOW);
    expect(lowRisk.risk).toBe('low');
    const farRisk = arrivalOutlook(s, NEXON, 25, NOW);
    expect(farRisk.risk).toBe('medium');
    expect(farRisk.note).toMatch(/could change/);
  });

  test('occupied is high risk; unknown is unknown, never "0 free"', () => {
    expect(
      arrivalOutlook(
        withStatus(station('st-chargezone-sec16'), 'occupied'),
        NEXON,
        10,
        NOW,
      ).risk,
    ).toBe('high');
    const unknown = arrivalOutlook(
      station('st-zeon-karolbagh'),
      NEXON,
      10,
      NOW,
    );
    expect(unknown.risk).toBe('unknown');
    expect(unknown.freeNow).toBeNull();
  });
});

// ============================================================ impact & cost ==

describe('trip impact and cost', () => {
  test('total impact adds detour, wait range and charging', () => {
    const wait: WaitEstimate = {
      minMinutes: 0,
      maxMinutes: 6,
      confidence: 'medium',
      basis: 'history',
    };
    const i = tripImpact({detourMin: 8, wait, chargeMin: 24});
    expect(i.totalMinMinutes).toBe(32);
    expect(i.totalMaxMinutes).toBe(38);
    expect(impactLabel(i)).toBe('~32-38 min');
  });

  test('an unknown wait is a floor, and says so', () => {
    const i = tripImpact({
      detourMin: 2,
      wait: {minMinutes: 0, maxMinutes: 0, confidence: 'low', basis: 'none'},
      chargeMin: 20,
    });
    expect(i.waitKnown).toBe(false);
    expect(impactLabel(i)).toBe('~22 min or more');
  });

  test('a backup is never shown as negative extra time', () => {
    const a = tripImpact({
      detourMin: 5,
      wait: waitOf(station('st-tata-cp'), NEXON),
      chargeMin: 30,
    });
    const b = tripImpact({
      detourMin: 1,
      wait: waitOf(station('st-tata-cp'), NEXON),
      chargeMin: 10,
    });
    expect(extraMinutes(a, b)).toBe(0);
    expect(extraMinutes(b, a)).toBeGreaterThan(0);
  });

  test('cost breakdown adds energy and GST, and never invents a parking fee', () => {
    const s = station('st-chargezone-neemrana');
    const c = stopCostBreakdown({
      station: s,
      connector: s.connectors[1],
      vehicle: NEXON,
      fromSoc: 20,
      toSoc: 80,
    });
    expect(c.energyKwh).toBeCloseTo(24.3, 1);
    expect(c.energyInr).toBeCloseTo(437.4, 0);
    expect(c.taxesInr).toBeCloseTo(78.73, 0);
    expect(c.totalInr).toBe(516);
    expect(c.parkingInr).toBeNull();
    expect(c.hasParking).toBe(true);
    const lines = costLines(c, n => `₹${n}`);
    expect(lines.find(l => l.label === 'Parking')?.value).toBe('Not published');
    expect(lines.find(l => l.label === 'PlugOrbit fee')?.value).toBe('₹0');
  });

  test('a connector with no published price has no total', () => {
    const jio = station('st-jiobp-lodhi');
    const c = stopCostBreakdown({
      station: jio,
      connector: jio.connectors[0],
      vehicle: NEXON,
      fromSoc: 20,
      toSoc: 80,
    });
    expect(c.totalInr).toBeNull();
    expect(costLines(c, n => `₹${n}`)).toEqual([
      {label: 'Price', value: 'Not published', muted: true},
    ]);
  });
});

// ============================================================ opening hours ==

describe('opening hours', () => {
  const at = (h: number, m = 0) => new Date(2026, 5, 10, h, m).getTime();
  test('24/7, a daytime window, a window past midnight, and unknown', () => {
    expect(isOpenAt('Open 24/7', at(3))).toBe(true);
    expect(isOpenAt('Open 6 AM - 11 PM', at(5, 30))).toBe(false);
    expect(isOpenAt('Open 6 AM - 11 PM', at(6))).toBe(true);
    expect(isOpenAt('Open 6 AM - 11 PM', at(23))).toBe(false);
    expect(isOpenAt('Open 10 PM - 4 AM', at(1))).toBe(true);
    expect(isOpenAt('Open 10 PM - 4 AM', at(12))).toBe(false);
    expect(isOpenAt('Hours unknown', at(12))).toBeNull();
  });
});

// ================================================================ charge plan ==

describe('charging plan', () => {
  test('the target is enough to finish, rounded up to 5, never over 80', () => {
    expect(chargeTargetFor(20, 40, 12)).toBe(60);
    expect(chargeTargetFor(20, 90, 12)).toBe(80);
    expect(chargeTargetFor(85, 10, 12)).toBe(85);
  });

  test('need: charge only when the reserve would be broken', () => {
    const fine = chargingNeed({
      vehicle: NEXON,
      socPercent: 72,
      remainingKm: 100,
      reservePct: 12,
    });
    expect(fine.required).toBe(false);
    expect(fine.targetSoc).toBeNull();
    const needs = chargingNeed({
      vehicle: NEXON,
      socPercent: 72,
      remainingKm: 270,
      reservePct: 12,
    });
    expect(needs.required).toBe(true);
    expect(needs.shortfallPct).toBeGreaterThan(0);
    expect(needs.targetSoc).not.toBeNull();
    expect(needs.targetSoc!).toBeLessThanOrEqual(80);
  });
});

// ============================================================== recommendation ==

describe('recommendation engine', () => {
  const pool = (ids: string[], km = 4) =>
    ids.map(id => cand(near(station(id), km)));

  test('Charge nearby picks one charger and one backup, with reasons', () => {
    const r = recommend(
      pool([
        'st-chargezone-sec16',
        'st-tata-cp',
        'st-statiq-rajiv',
        'st-tata-gurgaon',
        'st-chargezone-manesar',
      ]),
      ctx(),
    );
    expect(r.status).toBe('ok');
    expect(r.primary).not.toBeNull();
    expect(r.backup).not.toBeNull();
    expect(r.backup!.station.id).not.toBe(r.primary!.station.id);
    expect(r.primary!.reasons.length).toBeGreaterThan(0);
    expect(r.primary!.reasons.length).toBeLessThanOrEqual(3);
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test('hides chargers the car cannot use and never trusts unconfirmed plugs', () => {
    const google: StationWithDistance = {
      ...near(station('st-zeon-karolbagh')),
      id: 'g-1',
      connectors: [],
    };
    const r = recommend(
      [...pool(['st-statiq-rajiv', 'st-chargezone-manesar']), cand(google)],
      ctx({vehicle: LEAF}),
    );
    expect(r.ranked.map(c => c.station.id)).toEqual(['st-statiq-rajiv']);
    expect(r.excluded.find(e => e.stationId === 'g-1')?.reason).toBe(
      'unconfirmed_connectors',
    );
    expect(
      r.excluded.find(e => e.stationId === 'st-chargezone-manesar')?.reason,
    ).toBe('incompatible');
  });

  test('sponsorship has no effect on the score', () => {
    const base = near(station('st-jiobp-lodhi'), 4);
    const a = scoreCharger({station: {...base, sponsored: false}}, ctx(), null);
    const b = scoreCharger({station: {...base, sponsored: true}}, ctx(), null);
    expect('score' in a && 'score' in b && a.score === b.score).toBe(true);
    Object.values(WEIGHTS).forEach(w =>
      expect(Object.keys(w)).not.toContain('sponsored'),
    );
  });

  test('a closed charger is left out; unknown hours are not treated as closed', () => {
    const night = new Date(2026, 5, 10, 3, 0).getTime();
    const closed = near(station('st-statiq-rajiv'), 4); // 6 AM - 11 PM
    const r = recommend(
      [cand(closed), cand(near(station('st-chargezone-sec16'), 4))],
      ctx({now: night}),
    );
    expect(r.excluded.find(e => e.stationId === closed.id)?.reason).toBe(
      'closed',
    );
    const unknownHours: StationWithDistance = {
      ...near(station('st-chargezone-sec16'), 4),
      hours: 'Hours unknown',
    };
    expect('score' in scoreCharger({station: unknownHours}, ctx(), null)).toBe(
      true,
    );
  });

  test('a charger the battery cannot reach is excluded, and the empty state says why', () => {
    const far = near(station('st-statiq-bawal'), 120);
    const r = recommend(
      [cand(far)],
      ctx({socPercent: 12, intent: 'battery_critical'}),
    );
    expect(r.status).toBe('none_reachable');
    expect(r.primary).toBeNull();
    expect(r.excluded[0].reason).toBe('unreachable');
  });

  test('Charge nearby balances reliability, availability, speed and price', () => {
    const reliableFree = near(station('st-chargezone-manesar'), 6);
    const cheapButBusy = near(
      withStatus(station('st-tata-citymall'), 'occupied'),
      2,
    );
    const r = recommend([cand(cheapButBusy), cand(reliableFree)], ctx());
    expect(r.primary!.station.id).toBe(reliableFree.id);
  });

  describe('Battery critical priority order', () => {
    const critical = ctx({intent: 'battery_critical', socPercent: 14});

    test('reliability beats price', () => {
      const reliable = near(station('st-chargezone-manesar'), 8); // reliability 89, 18/kWh
      const cheapShaky: StationWithDistance = {
        ...near(station('st-chargezone-manesar'), 8),
        id: 'cheap-shaky',
        name: 'Cheap & shaky',
        reliabilityPct: 40,
        successfulSessionsPct: 40,
        connectors: station('st-chargezone-manesar').connectors.map(c => ({
          ...c,
          pricePerKwh: 8,
        })),
      };
      const r = recommend([cand(cheapShaky), cand(reliable)], critical);
      expect(r.primary!.station.id).toBe(reliable.id);
    });

    test('availability beats distance, distance beats speed, speed beats price', () => {
      const mk = (id: string, over: Partial<StationWithDistance>) =>
        ({
          ...near(station('st-chargezone-manesar'), 6),
          id,
          name: id,
          ...over,
        } as StationWithDistance);
      const freeFar = mk('free-far', {distanceKm: 9});
      const busyNear = mk('busy-near', {
        distanceKm: 2,
        connectors: station('st-chargezone-manesar').connectors.map(c => ({
          ...c,
          status: 'occupied' as const,
        })),
      });
      expect(
        recommend([cand(busyNear), cand(freeFar)], critical).primary!.station
          .id,
      ).toBe('free-far');

      const nearer = mk('nearer', {distanceKm: 3});
      const farther = mk('farther', {distanceKm: 12});
      expect(
        recommend([cand(farther), cand(nearer)], critical).primary!.station.id,
      ).toBe('nearer');
    });

    test('compareCritical never lets a lower price outrank higher reliability', () => {
      const a = scoreCharger(
        {station: near(station('st-chargezone-manesar'), 6)},
        critical,
        null,
      );
      const bStation: StationWithDistance = {
        ...near(station('st-chargezone-manesar'), 6),
        reliabilityPct: 30,
        successfulSessionsPct: 30,
        connectors: station('st-chargezone-manesar').connectors.map(c => ({
          ...c,
          pricePerKwh: 5,
        })),
      };
      const b = scoreCharger({station: bStation}, critical, null);
      if (!('score' in a) || !('score' in b)) {
        throw new Error('expected both to score');
      }
      expect(compareCritical(a, b)).toBeLessThan(0);
    });

    test('the critical weights contain no price', () => {
      expect(Object.keys(WEIGHTS.battery_critical)).not.toContain('price');
    });
  });

  test('the connector chosen is a free one, then the quickest for this car', () => {
    const neemrana = station('st-chargezone-neemrana');
    const c = chooseConnector(neemrana, NEXON)!;
    expect(c.status).toBe('available');
    expect(c.type).toBe('CCS2'); // CHAdeMO is not usable by the Nexon
    const allOffline = withStatus(neemrana, 'offline');
    expect(chooseConnector(allOffline, NEXON)).toBeNull();
  });

  test('a comparison appears only when fastest/cheapest differ from the pick', () => {
    const r = recommend(
      pool([
        'st-chargezone-sec16',
        'st-tata-cp',
        'st-statiq-bawal',
        'st-tata-gurgaon',
      ]),
      ctx(),
    );
    if (r.comparison) {
      expect(r.comparison.some(c => c.kind === 'pick')).toBe(true);
      expect(r.comparison.length).toBeGreaterThan(1);
    }
    const solo = recommend(pool(['st-chargezone-sec16']), ctx());
    expect(solo.comparison).toBeNull();
    expect(solo.backup).toBeNull();
  });
});

// ============================================================= notification ==

describe('co-driver manners', () => {
  const event = (
    level: 'informational' | 'action' | 'important' | 'critical',
  ) => ({key: `k-${level}`, level} as const);

  test('calm mode: quiet updates stay quiet, actions reach the driver', () => {
    const calm = DEFAULT_SMART_DRIVE_PREFS;
    expect(deliveryFor(event('informational'), calm, [], null, NOW)).toEqual({
      inbox: false,
      toast: false,
    });
    expect(deliveryFor(event('action'), calm, [], null, NOW)).toEqual({
      inbox: true,
      toast: true,
    });
    expect(deliveryFor(event('important'), calm, [], null, NOW).toast).toBe(
      true,
    );
  });

  test('"all" also keeps quiet updates in the inbox, without a toast', () => {
    const all2 = {...DEFAULT_SMART_DRIVE_PREFS, notifyMode: 'all' as const};
    expect(deliveryFor(event('informational'), all2, [], null, NOW)).toEqual({
      inbox: true,
      toast: false,
    });
  });

  test('critical-only silences everything but critical', () => {
    const only = {
      ...DEFAULT_SMART_DRIVE_PREFS,
      notifyMode: 'critical_only' as const,
    };
    expect(deliveryFor(event('important'), only, [], null, NOW).inbox).toBe(
      false,
    );
    expect(deliveryFor(event('critical'), only, [], null, NOW)).toEqual({
      inbox: true,
      toast: true,
    });
  });

  test('critical alerts are rare: no second toast inside the cooldown', () => {
    const calm = DEFAULT_SMART_DRIVE_PREFS;
    expect(deliveryFor(event('critical'), calm, [], NOW - 60_000, NOW)).toEqual(
      {inbox: true, toast: false},
    );
    expect(
      deliveryFor(
        event('critical'),
        calm,
        [],
        NOW - CRITICAL_COOLDOWN_MS - 1,
        NOW,
      ).toast,
    ).toBe(true);
  });

  test('the same event is never delivered twice', () => {
    expect(
      deliveryFor(
        event('action'),
        DEFAULT_SMART_DRIVE_PREFS,
        ['k-action'],
        null,
        NOW,
      ),
    ).toEqual({inbox: false, toast: false});
  });

  test('the words are calm and carry no developer jargon', () => {
    const e = coDriverEvents.stopUpcoming({
      tripId: 't',
      at: NOW,
      stationId: 's',
      stationName: 'ChargeZone Neemrana',
      distanceKm: 28,
      arriveSoc: 21,
      chargeToSoc: 68,
      stopMin: 24,
    });
    expect(e.title).toBe('Charging stop in 28 km.');
    expect(e.body).toContain('Expected arrival battery: 21%');
    expect(e.body).toContain('No action needed yet.');
    expect(`${e.title} ${e.body}`).not.toMatch(/WARNING|ERROR|API|EVSE/);
    expect(
      coDriverEvents.batteryCritical({tripId: 't', at: NOW, soc: 7}).level,
    ).toBe('critical');
  });
});

// ================================================================= the trip ==

describe('stop health and the switch decision', () => {
  const live = (s: Station) => withStatus(s, 'available');

  test('health: free, occupied, offline, unconfirmed', () => {
    const base = station('st-chargezone-neemrana');
    expect(stopHealth(live(base), NEXON, NOW).state).toBe('ok');
    expect(stopHealth(withStatus(base, 'occupied'), NEXON, NOW)).toMatchObject({
      state: 'unusable',
      cause: 'occupied',
    });
    expect(stopHealth(withStatus(base, 'offline'), NEXON, NOW)).toMatchObject({
      state: 'unusable',
      cause: 'offline',
    });
    expect(stopHealth(station('st-zeon-karolbagh'), NEXON, NOW)).toMatchObject({
      state: 'watch',
      cause: 'unconfirmed',
    });
  });

  const okHealth = stopHealth(live(station('st-statiq-bawal')), NEXON, NOW);
  const longQueue: WaitEstimate = {
    minMinutes: 14,
    maxMinutes: 22,
    confidence: 'medium',
    basis: 'history',
  };
  const shortQueue: WaitEstimate = {
    minMinutes: 2,
    maxMinutes: 5,
    confidence: 'medium',
    basis: 'history',
  };
  const free: WaitEstimate = {
    minMinutes: 0,
    maxMinutes: 0,
    confidence: 'high',
    basis: 'live_queue',
  };
  const occupied = stopHealth(
    withStatus(station('st-chargezone-neemrana'), 'occupied'),
    NEXON,
    NOW,
  );
  const offline = stopHealth(
    withStatus(station('st-chargezone-neemrana'), 'offline'),
    NEXON,
    NOW,
  );

  test('an offline stop switches to a working backup', () => {
    const d = decideSwitch({
      primary: {health: offline, wait: free},
      backup: {health: okHealth, wait: free, extraMin: 6, reachable: true},
    });
    expect(d).toMatchObject({switch: true, reason: 'offline'});
  });

  test('an occupied stop switches when waiting costs more than the backup', () => {
    const d = decideSwitch({
      primary: {health: occupied, wait: longQueue},
      backup: {health: okHealth, wait: free, extraMin: 6, reachable: true},
    });
    expect(d.switch).toBe(true);
    expect(d.reason).toBe('occupied');
    expect(d.savedMin).toBe(16);
  });

  test('a short wait does not justify leaving the plan', () => {
    const d = decideSwitch({
      primary: {health: occupied, wait: shortQueue},
      backup: {health: okHealth, wait: free, extraMin: 6, reachable: true},
    });
    expect(d.switch).toBe(false);
  });

  test('never offers a backup that is itself unusable, or no backup at all', () => {
    expect(
      decideSwitch({
        primary: {health: offline, wait: free},
        backup: {
          health: occupied,
          wait: longQueue,
          extraMin: 6,
          reachable: true,
        },
      }).switch,
    ).toBe(false);
    expect(
      decideSwitch({primary: {health: offline, wait: free}, backup: null})
        .switch,
    ).toBe(false);
  });

  test('a healthy stop is never left', () => {
    expect(
      decideSwitch({
        primary: {health: okHealth, wait: free},
        backup: {health: okHealth, wait: free, extraMin: 3, reachable: true},
      }).switch,
    ).toBe(false);
  });
});

describe('the trip, start to finish', () => {
  const planRoute = (soc = 72) =>
    createRouteService().plan({
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
      startSoc: soc,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });

  const start = async (soc = 72, smartDrive = true) => {
    const route = await planRoute(soc);
    return createTrip({route, vehicle: NEXON, smartDrive, now: NOW});
  };

  test('a trip starts calm: "You\'re good to drive", monitoring, with a backup', async () => {
    const {trip, events} = await start();
    expect(trip.phase).toBe('driving');
    expect(trip.chargingRequired).toBe(true);
    expect(trip.primaryStop).not.toBeNull();
    expect(trip.backupStop).not.toBeNull();
    expect(trip.monitoringStatus).toBe('monitoring');
    expect(trip.recommendationReason.length).toBeGreaterThan(0);
    expect(trip.dataConfidence).toMatch(/high|medium|low/);
    expect(trip.totalTripImpact!.totalMaxMinutes).toBeGreaterThan(0);
    expect(trip.tripRisk).toMatch(/high|medium|low/);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('You’re good to drive.');
    expect(events[0].level).toBe('informational');
    expect(trip.log).toHaveLength(1);
  });

  test('the stop numbers match the route the planner produced', async () => {
    const {trip} = await start();
    const stop = trip.route.stops[0];
    expect(trip.primaryStop!.arriveSoc).toBe(stop.arriveSoc);
    expect(trip.primaryStop!.chargeToSoc).toBe(stop.chargeToSoc);
    expect(trip.primaryStop!.stationId).toBe(stop.station.id);
    expect(trip.primaryStop!.backup!.stationId).toBe(stop.backup!.id);
  });

  test('far from the stop, nothing is said; then one reminder; then "you\'re close"', async () => {
    let {trip} = await start();
    const stopAt = trip.primaryStop!.alongKm;
    const remind = 40;
    const drive = (km: number) => {
      const out = applyPosition(trip, km, {now: NOW, remindKm: remind});
      trip = out.trip;
      return out.events;
    };

    expect(drive(stopAt - 90)).toEqual([]);
    expect(trip.phase).toBe('driving');

    const upcoming = drive(stopAt - 28);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].kind).toBe('stop_upcoming');
    expect(upcoming[0].title).toBe('Charging stop in 28 km.');
    expect(upcoming[0].level).toBe('action');

    // Driving on inside the same window must not nag.
    expect(drive(stopAt - 20)).toEqual([]);

    const close = drive(stopAt - 5);
    expect(close.map(e => e.kind)).toEqual(['approaching']);

    expect(drive(stopAt - 4)).toEqual([]);
    const arrived = drive(stopAt - 0.1);
    expect(arrived).toEqual([]);
    expect(trip.phase).toBe('at_charger');
    expect(trip.km).toBe(stopAt);
    expect(kmToStop(trip)).toBe(0);
  });

  test('the car cannot drive past a planned charger it has not used', async () => {
    const {trip} = await start();
    const out = applyPosition(trip, trip.totalKm, {now: NOW, remindKm: 40});
    expect(out.trip.km).toBe(trip.primaryStop!.alongKm);
    expect(out.trip.phase).toBe('at_charger');
  });

  test('battery falls as the car drives, from where it was last known', async () => {
    const {trip} = await start(72);
    const out = applyPosition(trip, 100, {now: NOW, remindKm: 40});
    // 100 km of a 300 km car is a third of the battery.
    expect(out.trip.currentSoc).toBe(Math.round(72 - 100 / 3));
  });

  // A queue of 12-24 minutes at the occupied primary; everything else is live.
  const queue = (primaryId: string) => (s: Station, v: Vehicle) =>
    s.id === primaryId
      ? ({
          minMinutes: 12,
          maxMinutes: 24,
          confidence: 'medium',
          basis: 'history',
        } as WaitEstimate)
      : waitOf(s, v);

  test('the primary goes occupied: it is noticed, the backup compared, a switch suggested', async () => {
    const {trip: planned} = await start();
    // 28 km before the stop, the backup (a charger on the same highway) is
    // still AHEAD, so switching to it costs almost nothing.
    const trip = applyPosition(planned, planned.primaryStop!.alongKm - 28, {
      now: NOW,
      remindKm: 40,
    }).trip;
    const primary = withStatus(
      {...trip.route.stops[0].station} as Station,
      'occupied',
    );
    const backup = withStatus(
      {...trip.route.stops[0].backup!} as Station,
      'available',
    );
    const check = (t: typeof trip, at: number) =>
      applyStatusCheck(
        t,
        {
          now: at,
          primary: near(primary, 0),
          backup: near(backup, 0),
          waitOf: queue(primary.id),
        },
        false,
      );

    const out = check(trip, NOW);
    expect(out.autoSwitch).toBeNull();
    const pending = out.trip.pendingSwitch!;
    expect(pending).not.toBeNull();
    expect(pending.toStationId).toBe(trip.primaryStop!.backup!.stationId);
    expect(pending.reason).toBe('occupied');
    expect(pending.aheadKm).toBeGreaterThan(0);
    expect(pending.aheadKm!).toBeLessThan(28);
    expect(pending.savedMin).toBeGreaterThanOrEqual(2);
    expect(out.trip.monitoringStatus).toBe('switch_available');
    expect(out.events.map(e => e.kind)).toEqual(['switch_suggested']);
    expect(out.events[0].level).toBe('important');
    expect(out.events[0].title).toBe('We’ve found a better charging stop.');
    expect(out.events[0].body).toMatch(/ahead on your route/);
    // The trip itself is untouched while the driver decides.
    expect(out.trip.primaryStop).toEqual(trip.primaryStop);
    expect(out.trip.km).toBe(trip.km);

    // The same trouble seen again is not announced again.
    const again = check(out.trip, NOW + 10_000);
    expect(again.events).toEqual([]);
    expect(again.trip.pendingSwitch).not.toBeNull();
  });

  test('the same queue is worth waiting out once the backup is behind you', async () => {
    const {trip: planned} = await start();
    // 2 km from the stop, the backup is ~25 km back: going back costs ~45 min.
    const trip = applyPosition(planned, planned.primaryStop!.alongKm - 2, {
      now: NOW,
      remindKm: 40,
    }).trip;
    const primary = withStatus(
      {...trip.route.stops[0].station} as Station,
      'occupied',
    );
    const backup = withStatus(
      {...trip.route.stops[0].backup!} as Station,
      'available',
    );
    const out = applyStatusCheck(
      trip,
      {
        now: NOW,
        primary: near(primary, 0),
        backup: near(backup, 0),
        waitOf: queue(primary.id),
      },
      false,
    );
    expect(out.trip.pendingSwitch).toBeNull();
    expect(out.events.map(e => e.kind)).toContain('availability_changed');
    expect(out.events.map(e => e.kind)).not.toContain('switch_suggested');
  });

  test('an offline primary is left even when the backup is behind', async () => {
    const {trip: planned} = await start();
    const trip = applyPosition(planned, planned.primaryStop!.alongKm - 2, {
      now: NOW,
      remindKm: 40,
    }).trip;
    const out = applyStatusCheck(
      trip,
      {
        now: NOW,
        primary: near(
          withStatus({...trip.route.stops[0].station} as Station, 'offline'),
          0,
        ),
        backup: near(
          withStatus({...trip.route.stops[0].backup!} as Station, 'available'),
          0,
        ),
        waitOf,
      },
      false,
    );
    expect(out.trip.pendingSwitch?.reason).toBe('offline');
    // It's behind the car, so no "km ahead" is claimed.
    expect(out.trip.pendingSwitch?.aheadKm).toBeNull();
  });

  test('a backup the battery cannot reach is never offered', async () => {
    const {trip: planned} = await start(30);
    // Re-anchor so the (earlier) backup is out of reach behind a nearly flat battery.
    const trip = applyBattery(
      applyPosition(planned, 0, {now: NOW, remindKm: 40}).trip,
      9,
      NOW,
    ).trip;
    const moved = {...trip, km: trip.km + 0};
    const out = applyStatusCheck(
      moved,
      {
        now: NOW,
        primary: near(
          withStatus({...trip.route.stops[0].station} as Station, 'offline'),
          0,
        ),
        backup: near(
          withStatus({...trip.route.stops[0].backup!} as Station, 'available'),
          0,
        ),
        waitOf,
      },
      false,
    );
    expect(out.trip.pendingSwitch).toBeNull();
  });

  test('with Smart Drive allowed to act, the switch is handed back to be applied', async () => {
    const {trip} = await start();
    const primary = withStatus(
      {...trip.route.stops[0].station} as Station,
      'offline',
    );
    const backup = withStatus(
      {...trip.route.stops[0].backup!} as Station,
      'available',
    );
    const out = applyStatusCheck(
      trip,
      {now: NOW, primary: near(primary, 0), backup: near(backup, 0), waitOf},
      true,
    );
    expect(out.autoSwitch).not.toBeNull();
    expect(out.autoSwitch!.reason).toBe('offline');
    expect(out.trip.pendingSwitch).toBeNull();
  });

  test('Smart Drive switched off means the driver is always asked', async () => {
    const {trip} = await start(72, false);
    const primary = withStatus(
      {...trip.route.stops[0].station} as Station,
      'offline',
    );
    const backup = withStatus(
      {...trip.route.stops[0].backup!} as Station,
      'available',
    );
    const out = applyStatusCheck(
      trip,
      {now: NOW, primary: near(primary, 0), backup: near(backup, 0), waitOf},
      true,
    );
    expect(out.autoSwitch).toBeNull();
    expect(out.trip.pendingSwitch).not.toBeNull();
  });

  test('a recovered charger withdraws the suggestion', async () => {
    const {trip} = await start();
    const bad = withStatus(
      {...trip.route.stops[0].station} as Station,
      'offline',
    );
    const backup = withStatus(
      {...trip.route.stops[0].backup!} as Station,
      'available',
    );
    const first = applyStatusCheck(
      trip,
      {now: NOW, primary: near(bad, 0), backup: near(backup, 0), waitOf},
      false,
    );
    expect(first.trip.pendingSwitch).not.toBeNull();
    const good = withStatus(
      {...trip.route.stops[0].station} as Station,
      'available',
    );
    const second = applyStatusCheck(
      first.trip,
      {
        now: NOW + 5000,
        primary: near(good, 0),
        backup: near(backup, 0),
        waitOf,
      },
      false,
    );
    expect(second.trip.pendingSwitch).toBeNull();
    expect(second.trip.monitoringStatus).toBe('monitoring');
  });

  test('losing signal keeps the plan, says so once, and recovers quietly', async () => {
    const {trip} = await start();
    const off = applyOffline(trip, NOW);
    expect(off.trip.monitoringStatus).toBe('offline');
    expect(off.trip.offlineSince).toBe(NOW);
    expect(off.trip.primaryStop).not.toBeNull();
    expect(off.events.map(e => e.kind)).toEqual(['offline']);
    expect(off.events[0].body).toMatch(/charging plan/);
    expect(applyOffline(off.trip, NOW + 1000).events).toEqual([]);
    const back = applyStatusCheck(
      off.trip,
      {
        now: NOW + 60_000,
        primary: near(
          withStatus({...trip.route.stops[0].station} as Station, 'available'),
          0,
        ),
        backup: near(
          withStatus({...trip.route.stops[0].backup!} as Station, 'available'),
          0,
        ),
        waitOf,
      },
      false,
    );
    expect(back.trip.monitoringStatus).toBe('monitoring');
    expect(back.trip.offlineSince).toBeNull();
    expect(back.events.map(e => e.kind)).toEqual(['back_online']);
  });

  test('plug in, charge, pay: the trip resumes from the new battery and stays on track', async () => {
    let {trip} = await start(72);
    const stopAt = trip.primaryStop!.alongKm;
    trip = applyPosition(trip, stopAt, {now: NOW, remindKm: 40}).trip;
    expect(trip.phase).toBe('at_charger');

    const began = beginCharging(trip, NOW + 1000);
    expect(began.trip.phase).toBe('charging');
    expect(began.events.map(e => e.title)).toEqual([
      'Charging started successfully.',
    ]);
    // A charging car doesn't move.
    expect(
      applyPosition(began.trip, stopAt + 30, {now: NOW, remindKm: 40}).trip.km,
    ).toBe(stopAt);

    const target = began.trip.primaryStop!.chargeToSoc;
    const stopped = applyChargeEnded(began.trip, target, NOW + 2000);
    expect(stopped.events).toHaveLength(1);
    expect(stopped.events[0].kind).toBe('enough_charge');
    expect(stopped.events[0].title).toBe(`You’re at ${target}%.`);
    expect(stopped.events[0].body).toMatch(/enough/);

    const done = finishCharging(
      stopped.trip,
      {endSoc: target, energyKwh: 20, costInr: 430, chargeMin: 24},
      NOW + 3000,
    );
    expect(done.trip.phase).toBe('driving');
    expect(done.trip.stopIndex).toBe(1);
    expect(done.trip.anchor).toEqual({km: stopAt, soc: target});
    expect(done.trip.currentSoc).toBe(target);
    expect(done.trip.stats).toEqual({
      stopsCompleted: 1,
      energyKwh: 20,
      costInr: 430,
      chargeMin: 24,
    });
    expect(done.events.map(e => e.kind)).toEqual(['ready_to_continue']);
    // The plan had one stop, so none is left: nothing more to charge for.
    expect(done.trip.primaryStop).toBeNull();
    expect(done.trip.chargingRequired).toBe(false);
    expect(done.trip.expectedArrivalSoc).toBeGreaterThanOrEqual(12);
  });

  test('drive to the destination: arrival is announced once and the trip stops running', async () => {
    let {trip} = await start(72);
    const stopAt = trip.primaryStop!.alongKm;
    trip = applyPosition(trip, stopAt, {now: NOW, remindKm: 40}).trip;
    trip = beginCharging(trip, NOW).trip;
    trip = finishCharging(
      trip,
      {
        endSoc: trip.primaryStop!.chargeToSoc,
        energyKwh: 20,
        costInr: 400,
        chargeMin: 24,
      },
      NOW,
    ).trip;
    const out = applyPosition(trip, trip.totalKm, {now: NOW, remindKm: 40});
    expect(out.trip.phase).toBe('arrived');
    expect(out.events.map(e => e.kind)).toEqual(['destination_arrived']);
    expect(out.trip.currentSoc).toBeGreaterThanOrEqual(12);
    expect(
      applyPosition(out.trip, trip.totalKm, {now: NOW, remindKm: 40}).events,
    ).toEqual([]);
  });

  test('a corrected battery re-projects the plan; a very low one is critical', async () => {
    const {trip} = await start(72);
    const lower = applyBattery(trip, 55, NOW);
    expect(lower.trip.anchor).toEqual({km: 0, soc: 55});
    expect(lower.trip.primaryStop!.arriveSoc).toBeLessThan(
      trip.primaryStop!.arriveSoc,
    );
    expect(lower.events[0].kind).toBe('plan_updated');
    const critical = applyBattery(trip, 6, NOW);
    expect(critical.events[0].kind).toBe('battery_critical');
    expect(critical.events[0].level).toBe('critical');
    // Too low to reach the planned charger at all: the plan says so loudly.
    const stranded = applyBattery(trip, 40, NOW);
    expect(stranded.events[0].kind).toBe('no_reliable_charger');
    expect(stranded.events[0].level).toBe('critical');
  });

  test('no charging needed on a short trip: reassurance, no stop', async () => {
    const route = await createRouteService().plan({
      fromLabel: 'Delhi',
      toLabel: 'Gurgaon',
      startSoc: 80,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });
    const {trip, events} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    expect(trip.chargingRequired).toBe(false);
    expect(trip.primaryStop).toBeNull();
    expect(trip.monitoringStatus).toBe('idle');
    expect(events[0].body).toMatch(/No charging needed/);
    expect(routeConfidence(route, NOW).level).toBe('high');
    expect(tripStatus(trip, 40).headline).toBe('Your trip is on track.');
  });
});

describe('status lines', () => {
  test('home: no car, no battery, then the battery speaks', () => {
    const base = {trip: null, reservePct: 12, remindKm: 40};
    expect(driverStatus({...base, vehicle: null, battery: null}).action).toBe(
      'add_vehicle',
    );
    expect(driverStatus({...base, vehicle: NEXON, battery: null}).action).toBe(
      'set_battery',
    );
    const ok = driverStatus({
      ...base,
      vehicle: NEXON,
      battery: {percent: 68, source: 'manual', updatedAt: NOW},
    });
    expect(ok.headline).toBe('You’re good to drive.');
    expect(ok.tone).toBe('good');
    const low = driverStatus({
      ...base,
      vehicle: NEXON,
      battery: {percent: 8, source: 'manual', updatedAt: NOW},
    });
    expect(low.tone).toBe('critical');
    expect(low.action).toBe('battery_critical');
  });

  test('trip: good for now, then a stop coming up, then arrived', async () => {
    const route = await createRouteService().plan({
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
      startSoc: 72,
      strategy: 'reliable',
      vehicle: NEXON,
      safetyReservePct: 12,
      avoidPaidParking: false,
    });
    let {trip} = createTrip({
      route,
      vehicle: NEXON,
      smartDrive: true,
      now: NOW,
    });
    const stopAt = trip.primaryStop!.alongKm;
    expect(tripStatus(trip, 40).headline).toBe('You’re good for now.');
    expect(tripStatus(trip, 40).detail).toMatch(
      /No charging needed for ~\d+ km/,
    );
    trip = applyPosition(trip, stopAt - 30, {now: NOW, remindKm: 40}).trip;
    expect(tripStatus(trip, 40).headline).toBe('Charging stop in 30 km.');
    expect(tripStatus(trip, 40).detail).toMatch(/backup is ready/);
  });
});
