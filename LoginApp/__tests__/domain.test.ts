/**
 * @format
 */

import {
  DEMO_TIME_SCALE,
  computeSessionMetrics,
  estimatePreauthInr,
  invoiceFor,
  minutesToCharge,
} from '../src/domain/charging';
import {
  DEFAULT_FILTERS,
  applyFilters,
  organicScore,
  rankOrganic,
  stationHealth,
  waitLabel,
} from '../src/domain/rules';
import {
  LIVE_MAX_AGE_MS,
  dataTrust,
  isStale,
  timeAgo,
} from '../src/domain/trust';
import type {
  ChargingSession,
  Station,
  StationWithDistance,
  Vehicle,
} from '../src/domain/types';
import {formatDuration, formatInr} from '../src/utils/format';

const NOW = 1_700_000_000_000;

const NEXON: Vehicle = {
  id: 'v',
  make: 'Tata',
  model: 'Nexon EV',
  variant: 'Long Range',
  batteryKwh: 40.5,
  connectors: ['CCS2', 'Type2'],
  maxDcKw: 60,
  maxAcKw: 7.2,
  rangeKm100: 270,
};

const station = (
  over: Partial<StationWithDistance> = {},
): StationWithDistance => ({
  id: 's1',
  name: 'S1',
  operator: 'Op',
  address: 'Addr',
  latitude: 0,
  longitude: 0,
  rating: 4.5,
  successfulSessionsPct: 90,
  reliabilityPct: 90,
  sponsored: false,
  hours: 'Open 24/7',
  amenities: ['cafe'],
  connectors: [
    {
      id: 'c1',
      label: 'C1',
      type: 'CCS2',
      powerKw: 60,
      status: 'available',
      pricePerKwh: 18,
      idleFeePerMin: null,
    },
    {
      id: 'c2',
      label: 'C2',
      type: 'CHAdeMO',
      powerKw: 50,
      status: 'available',
      pricePerKwh: 16,
      idleFeePerMin: null,
    },
  ],
  integration: 'integrated',
  operatorInstructions: null,
  statusFeed: {source: 'operator_feed', updatedAt: NOW - 30_000},
  priceFeed: {source: 'operator_feed', updatedAt: NOW - 30_000},
  distanceKm: 4.8,
  detourMin: 8,
  ...over,
});

describe('dataTrust: LIVE only from a fresh operator feed', () => {
  test('fresh operator feed is live', () => {
    expect(
      dataTrust({source: 'operator_feed', updatedAt: NOW - 1000}, NOW),
    ).toBe('live');
  });

  test('operator feed that went quiet is only estimated', () => {
    const feed = {
      source: 'operator_feed' as const,
      updatedAt: NOW - LIVE_MAX_AGE_MS - 1,
    };
    expect(dataTrust(feed, NOW)).toBe('estimated');
  });

  test('google/aggregated data is never live, however fresh', () => {
    expect(dataTrust({source: 'google_places', updatedAt: NOW}, NOW)).toBe(
      'estimated',
    );
    expect(dataTrust({source: 'estimate', updatedAt: NOW}, NOW)).toBe(
      'estimated',
    );
  });

  test('user reports are user-confirmed; no source is unknown', () => {
    expect(dataTrust({source: 'user_report', updatedAt: NOW - 5000}, NOW)).toBe(
      'user',
    );
    expect(dataTrust({source: 'none', updatedAt: null}, NOW)).toBe('unknown');
    expect(dataTrust({source: 'operator_feed', updatedAt: null}, NOW)).toBe(
      'unknown',
    );
  });

  test('stale and time-ago helpers', () => {
    expect(
      isStale({source: 'operator_feed', updatedAt: NOW - 31 * 60_000}, NOW),
    ).toBe(true);
    expect(
      isStale({source: 'operator_feed', updatedAt: NOW - 60_000}, NOW),
    ).toBe(false);
    expect(timeAgo(NOW - 38_000, NOW)).toBe('38 sec ago');
    expect(timeAgo(NOW - 12 * 60_000, NOW)).toBe('12 min ago');
    expect(timeAgo(null, NOW)).toBe('never updated');
  });
});

describe('compatibility and filters', () => {
  const chademoOnly: Station = station({
    id: 'x',
    connectors: [
      {
        id: 'c',
        label: 'C',
        type: 'CHAdeMO',
        powerKw: 50,
        status: 'available',
        pricePerKwh: 15,
        idleFeePerMin: null,
      },
    ],
  });

  test('incompatible chargers are hidden by default', () => {
    const list = applyFilters(
      [station(), station({...chademoOnly, distanceKm: 1, detourMin: 1})],
      DEFAULT_FILTERS,
      NEXON,
    );
    expect(list.map(s => s.id)).toEqual(['s1']);
  });

  test('they only appear when explicitly included', () => {
    const list = applyFilters(
      [station(), station({...chademoOnly, distanceKm: 1, detourMin: 1})],
      {...DEFAULT_FILTERS, includeIncompatible: true},
      NEXON,
    );
    expect(list).toHaveLength(2);
  });

  test('health ignores connectors the car cannot use', () => {
    const s = station({
      connectors: [
        {
          id: 'a',
          label: 'A',
          type: 'CCS2',
          powerKw: 60,
          status: 'occupied',
          pricePerKwh: 18,
          idleFeePerMin: null,
        },
        {
          id: 'b',
          label: 'B',
          type: 'CHAdeMO',
          powerKw: 50,
          status: 'available',
          pricePerKwh: 18,
          idleFeePerMin: null,
        },
      ],
    });
    expect(stationHealth(s, NEXON)).toBe('busy');
  });

  test('min power and available-only narrow the list', () => {
    const slow = station({
      id: 'slow',
      connectors: [
        {
          id: 'a',
          label: 'A',
          type: 'CCS2',
          powerKw: 30,
          status: 'occupied',
          pricePerKwh: 18,
          idleFeePerMin: null,
        },
      ],
    });
    expect(
      applyFilters(
        [station(), slow],
        {...DEFAULT_FILTERS, minPowerKw: 50},
        NEXON,
      ).map(s => s.id),
    ).toEqual(['s1']);
    expect(
      applyFilters(
        [station(), slow],
        {...DEFAULT_FILTERS, availableOnly: true},
        NEXON,
      ).map(s => s.id),
    ).toEqual(['s1']);
  });
});

describe('ranking is organic: sponsorship never changes it', () => {
  test('score and order are identical with and without the sponsored flag', () => {
    const a = station({id: 'a', reliabilityPct: 95});
    const b = station({id: 'b', reliabilityPct: 70});
    const sponsoredB = {...b, sponsored: true};
    expect(organicScore(sponsoredB, NEXON)).toBe(organicScore(b, NEXON));
    expect(rankOrganic([sponsoredB, a], NEXON).map(s => s.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('wait estimates are ranges with a confidence label', () => {
  test('never a single false-precise number', () => {
    expect(
      waitLabel({
        minMinutes: 14,
        maxMinutes: 20,
        confidence: 'medium',
        basis: 'history',
      }),
    ).toBe('~14-20 min');
    expect(
      waitLabel({
        minMinutes: 0,
        maxMinutes: 0,
        confidence: 'high',
        basis: 'live_queue',
      }),
    ).toBe('No wait expected');
    expect(
      waitLabel({
        minMinutes: 0,
        maxMinutes: 0,
        confidence: 'low',
        basis: 'none',
      }),
    ).toBe('Wait unknown');
  });
});

describe('charging maths', () => {
  const session: ChargingSession = {
    id: 's',
    stationId: 'st',
    stationName: 'ChargeZone',
    connectorId: 'c',
    connectorLabel: 'C2',
    connectorType: 'CCS2',
    powerKw: 50,
    pricePerKwh: 18,
    batteryKwh: 40.5,
    startSoc: 42,
    targetSoc: 80,
    startedAt: NOW,
    stoppedAt: null,
    status: 'active',
    paymentMethodId: 'pm',
    preauthId: 'pa',
    preauthAmountInr: 700,
    receiptNo: null,
    failureReason: null,
  };

  test('metrics are a pure function of time, so they survive a restart', () => {
    const at = NOW + (6 * 60_000) / DEMO_TIME_SCALE; // 6 simulated minutes
    const a = computeSessionMetrics(session, at);
    const b = computeSessionMetrics({...session}, at);
    expect(a).toEqual(b);
    expect(a.socPercent).toBeGreaterThan(42);
    expect(a.socPercent).toBeLessThan(80);
    expect(a.reachedTarget).toBe(false);
    expect(a.minToTarget).toBeGreaterThan(0);
    expect(a.costInr).toBeCloseTo(a.energyKwh * 18, 5);
  });

  test('stops at the target and freezes after stop', () => {
    const late = computeSessionMetrics(session, NOW + 3_600_000);
    expect(late.socPercent).toBeCloseTo(80, 3);
    expect(late.reachedTarget).toBe(true);
    expect(late.minToTarget).toBe(0);

    const stopped = {
      ...session,
      stoppedAt: NOW + (3 * 60_000) / DEMO_TIME_SCALE,
    };
    const m1 = computeSessionMetrics(stopped, NOW + 10_000_000);
    const m2 = computeSessionMetrics(stopped, NOW + 99_000_000);
    expect(m1).toEqual(m2);
  });

  test('invoice matches the reference example (26.2 kWh at ₹18 + 18% GST)', () => {
    const inv = invoiceFor(26.2, 18);
    expect(inv.baseInr).toBe(471.6);
    expect(inv.gstInr).toBe(84.89);
    expect(inv.totalInr).toBe(556.49);
  });

  test('an invoice rebuilt from its own stored energy is identical (payment == receipt)', () => {
    const charged = invoiceFor(1.375, 16);
    const rebuilt = invoiceFor(charged.energyKwh, 16);
    expect(rebuilt).toEqual(charged);
    expect(charged.baseInr).toBe(
      Math.round(charged.energyKwh * 16 * 100) / 100,
    );
  });

  test('pre-authorisation covers the planned energy plus GST', () => {
    const amount = estimatePreauthInr(42, 80, 40.5, 18);
    const worst = ((80 - 42) / 100) * 40.5 * 18 * 1.18;
    expect(amount).toBeGreaterThanOrEqual(worst);
    expect(amount % 50).toBe(0);
  });

  test('time to charge grows with the energy needed', () => {
    expect(minutesToCharge(42, 80, 50, 40.5)).toBeGreaterThan(
      minutesToCharge(42, 60, 50, 40.5),
    );
    expect(minutesToCharge(80, 80, 50, 40.5)).toBe(0);
  });
});

describe('formatting', () => {
  test('rupees use Indian grouping', () => {
    expect(formatInr(556.49, true)).toBe('₹556.49');
    expect(formatInr(1234567)).toBe('₹12,34,567');
    expect(formatInr(437)).toBe('₹437');
  });

  test('durations', () => {
    expect(formatDuration(8)).toBe('8 min');
    expect(formatDuration(72)).toBe('1 h 12 min');
    expect(formatDuration(120)).toBe('2 h');
  });
});

describe('seed history', () => {
  test('every seeded session total equals its own invoice (no off-by-rupee demo data)', () => {
    const {seedState} = require('../src/store/seed');
    const history = seedState(Date.now()).history ?? [];
    expect(history.length).toBeGreaterThan(0);
    for (const h of history) {
      expect(h.costInr).toBe(invoiceFor(h.energyKwh, h.pricePerKwh).totalInr);
    }
  });
});
