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
  REPORTED_FREE_WAIT,
  applyFilters,
  availabilityHeadline,
  availableCount,
  compatibleConnectors,
  hasRating,
  hasUnconfirmedConnectors,
  isCompatible,
  isDemoFallback,
  isOutsideDemoArea,
  lowestPrice,
  maxPowerKw,
  organicScore,
  rankOrganic,
  stationHealth,
  waitAtTime,
  waitBasisLabel,
  waitLabel,
} from '../src/domain/rules';
import {
  LIVE_MAX_AGE_MS,
  dataTrust,
  isStale,
  priceAgeLabel,
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

describe('waits never claim more than their source can back', () => {
  const live = {source: 'operator_feed' as const, updatedAt: NOW - 20_000};
  const estimated = {source: 'google_places' as const, updatedAt: NOW - 60_000};

  test('"No wait expected" belongs to a live queue only', () => {
    expect(
      waitLabel({
        minMinutes: 0,
        maxMinutes: 0,
        confidence: 'high',
        basis: 'live_queue',
      }),
    ).toBe('No wait expected');
    // A zero range from any other basis is not a promise of no wait.
    expect(
      waitLabel({
        minMinutes: 0,
        maxMinutes: 0,
        confidence: 'low',
        basis: 'reported',
      }),
    ).toBe('Wait unknown');
  });

  test('a bay reported free by a non-live source is a wide, low range', () => {
    expect(REPORTED_FREE_WAIT.confidence).toBe('low');
    expect(REPORTED_FREE_WAIT.maxMinutes).toBeGreaterThan(0);
    expect(waitLabel(REPORTED_FREE_WAIT)).toBe('Up to ~10 min');
    expect(waitBasisLabel(REPORTED_FREE_WAIT)).toMatch(/not a live feed/);
  });

  test('a live wait is re-stated once its feed stops being live', () => {
    const noWait = {
      minMinutes: 0,
      maxMinutes: 0,
      confidence: 'high' as const,
      basis: 'live_queue' as const,
    };
    expect(waitAtTime(noWait, live, NOW)).toBe(noWait);
    expect(waitAtTime(noWait, live, NOW + LIVE_MAX_AGE_MS + 60_000)).toBe(
      REPORTED_FREE_WAIT,
    );
    expect(waitAtTime(noWait, estimated, NOW)).toBe(REPORTED_FREE_WAIT);
    const history = {
      minMinutes: 10,
      maxMinutes: 18,
      confidence: 'medium' as const,
      basis: 'history' as const,
    };
    expect(waitAtTime(history, estimated, NOW)).toBe(history);
  });
});

describe('availability headline says LIVE only for a live feed', () => {
  const two = station({
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
        type: 'CCS2',
        powerKw: 60,
        status: 'occupied',
        pricePerKwh: 18,
        idleFeePerMin: null,
      },
    ],
  });

  test('live operator feed', () => {
    expect(availabilityHeadline(two, NEXON, NOW)).toBe('Live now: 1 of 2 free');
  });

  test('estimated, user and stale feeds say when they were last reported', () => {
    expect(
      availabilityHeadline(
        {...two, statusFeed: {source: 'google_places', updatedAt: NOW - 240_000}},
        NEXON,
        NOW,
      ),
    ).toBe('Last reported 4 min ago: 1 of 2 free');
    expect(
      availabilityHeadline(
        {...two, statusFeed: {source: 'user_report', updatedAt: NOW - 18 * 60_000}},
        NEXON,
        NOW,
      ),
    ).toBe('Last reported 18 min ago: 1 of 2 free');
    expect(
      availabilityHeadline(
        {
          ...two,
          statusFeed: {source: 'operator_feed', updatedAt: NOW - 20 * 60_000},
        },
        NEXON,
        NOW,
      ),
    ).toBe('Last reported 20 min ago: 1 of 2 free');
  });

  test('no status never turns into "0 free"', () => {
    const unknown = {
      ...two,
      connectors: two.connectors.map(c => ({...c, status: 'unknown' as const})),
      statusFeed: {source: 'none' as const, updatedAt: null},
    };
    expect(availabilityHeadline(unknown, NEXON, NOW)).toBe('Status unknown');
    expect(
      availabilityHeadline({...unknown, connectors: []}, NEXON, NOW),
    ).toBe('Status unknown');
  });

  test('counts only the bays this car can use', () => {
    const mixed = station(); // C1 CCS2 + C2 CHAdeMO, both free
    expect(availabilityHeadline(mixed, NEXON, NOW)).toBe('Live now: 1 of 1 free');
  });
});

describe('prices always say how old they are', () => {
  test('only a fresh operator feed is stated plainly', () => {
    expect(
      priceAgeLabel({source: 'operator_feed', updatedAt: NOW - 120_000}, NOW),
    ).toBe('Price updated 2 min ago');
    expect(
      priceAgeLabel({source: 'operator_feed', updatedAt: NOW - 3600_000}, NOW),
    ).toBe('Price (estimated), updated 1 h ago');
    expect(
      priceAgeLabel({source: 'user_report', updatedAt: NOW - 46 * 60_000}, NOW),
    ).toBe('Price (user-confirmed), updated 46 min ago');
    expect(priceAgeLabel({source: 'none', updatedAt: null}, NOW)).toBe(
      'Price never updated',
    );
  });
});

describe('a charger whose connectors are unknown is never "compatible"', () => {
  const unconfirmed = station({
    id: 'g-x',
    connectors: [],
    rating: 0,
    reliabilityPct: 0,
    successfulSessionsPct: 0,
    integration: 'external',
    statusFeed: {source: 'none', updatedAt: null},
    priceFeed: {source: 'none', updatedAt: null},
  });

  test('it is flagged, and hidden by default when a car is set', () => {
    expect(hasUnconfirmedConnectors(unconfirmed)).toBe(true);
    expect(hasUnconfirmedConnectors(station())).toBe(false);
    expect(isCompatible(unconfirmed, NEXON)).toBe(false);
    expect(applyFilters([unconfirmed], DEFAULT_FILTERS, NEXON)).toEqual([]);
  });

  test('it can be revealed, but connector filters can never match it', () => {
    const reveal = {...DEFAULT_FILTERS, includeIncompatible: true};
    expect(applyFilters([unconfirmed], reveal, NEXON)).toEqual([unconfirmed]);
    for (const narrower of [
      {connector: 'CCS2' as const},
      {minPowerKw: 50},
      {availableOnly: true},
    ]) {
      expect(applyFilters([unconfirmed], {...reveal, ...narrower}, NEXON)).toEqual(
        [],
      );
    }
    // With no car set nothing can be ruled out, so nothing is hidden.
    expect(applyFilters([unconfirmed], DEFAULT_FILTERS, null)).toEqual([
      unconfirmed,
    ]);
  });

  test('every derived number stays a real number', () => {
    expect(compatibleConnectors(unconfirmed, NEXON)).toEqual([]);
    expect(availableCount(unconfirmed, NEXON)).toBe(0);
    expect(lowestPrice(unconfirmed, NEXON)).toBeNull();
    expect(maxPowerKw(unconfirmed, NEXON)).toBe(0);
    expect(stationHealth(unconfirmed, NEXON)).toBe('unknown');
    const score = organicScore(unconfirmed, NEXON);
    expect(Number.isFinite(score)).toBe(true);
    expect(rankOrganic([unconfirmed, station()], NEXON)[0].id).toBe('s1');
  });

  test('an unrated charger has no rating to show', () => {
    expect(hasRating(unconfirmed)).toBe(false);
    expect(hasRating(station())).toBe(true);
  });
});

describe('the demo chargers are around New Delhi', () => {
  const DELHI = {latitude: 28.6139, longitude: 77.209};
  const CALIFORNIA = {latitude: 37.42, longitude: -122.08};
  const MUMBAI = {latitude: 19.076, longitude: 72.8777};

  test('far-away phones are outside the demo area, nearby ones are not', () => {
    expect(isOutsideDemoArea(CALIFORNIA, DELHI)).toBe(true);
    expect(isOutsideDemoArea(MUMBAI, DELHI)).toBe(true);
    expect(isOutsideDemoArea({latitude: 26.9124, longitude: 75.7873}, DELHI)).toBe(
      false,
    );
  });

  test('results from around Delhi are recognised as a fallback', () => {
    expect(isDemoFallback(CALIFORNIA, [DELHI])).toBe(true);
    expect(isDemoFallback(DELHI, [DELHI])).toBe(false);
    expect(isDemoFallback(CALIFORNIA, [])).toBe(false);
    // One charger actually near the phone means it was a normal search.
    expect(isDemoFallback(CALIFORNIA, [DELHI, CALIFORNIA])).toBe(false);
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

describe('reservation hold', () => {
  const {heldReservation} = require('../src/domain/reservation');
  const base = {
    id: 'r1',
    stationId: 's',
    stationName: 'S',
    connectorLabel: 'C1',
    arrivalAt: 1_000_000,
    holdMinutes: 10,
    status: 'held',
    createdAt: 0,
  };
  test('is held until the slot plus the grace period, then released', () => {
    expect(heldReservation(base, 1_000_000 + 9 * 60_000)).toBe(base);
    expect(heldReservation(base, 1_000_000 + 10 * 60_000 + 1)).toBeNull();
  });
  test('cancelled or missing reservations never count as held', () => {
    expect(heldReservation({...base, status: 'cancelled'}, 0)).toBeNull();
    expect(heldReservation(null, 0)).toBeNull();
  });
});

describe('maskUpi', () => {
  const {maskUpi} = require('../src/domain/paymentForm');
  test('tells different handles on the same bank apart', () => {
    expect(maskUpi('ravi@okaxis')).not.toBe(maskUpi('rahul@okaxis'));
    expect(maskUpi('ravi.k@okaxis')).toBe('ra•••k@okaxis');
  });
  test('fully hides very short handles', () => {
    expect(maskUpi('ab@okaxis')).toBe('•••@okaxis');
    expect(maskUpi('abc@okaxis')).not.toContain('abc');
  });
});
