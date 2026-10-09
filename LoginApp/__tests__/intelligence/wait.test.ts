import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {
  expectedWait,
  outlookAtArrival,
  waitMid,
} from '../../src/intelligence/wait';
import {
  NEXON_EV,
  mockStations,
  noon,
  withStationStatus,
} from '../../src/dev/smartDriveFixtures';
import type {Station} from '../../src/domain/types';

const now = noon();
const min = (m: number) => now + m * 60000;
const base = mockStations(now);
const neemrana = base.find(s => s.id === 'st-chargezone-neemrana') as Station;
const busy = (queue?: number) =>
  withStationStatus(base, neemrana.id, 'occupied', now, queue).find(
    s => s.id === neemrana.id,
  ) as Station;

describe('expected wait at arrival', () => {
  test('"no wait" needs a live feed AND an imminent arrival', () => {
    const soon = expectedWait(neemrana, NEXON_EV, now, min(8), config);
    expect(soon).toMatchObject({
      maxMinutes: 0,
      confidence: 'high',
      basis: 'live_queue',
    });
    // 100 minutes out, the same live bay proves nothing.
    const far = expectedWait(neemrana, NEXON_EV, now, min(100), config);
    expect(far.basis).toBe('reported');
    expect(far.maxMinutes).toBeGreaterThan(0);
    expect(far.confidence).toBe('low');
  });

  test('a bay reported free by a non-live source is never "no wait"', () => {
    const glida = base.find(s => s.id === 'st-glida-neemrana') as Station;
    const w = expectedWait(glida, NEXON_EV, now, min(5), config);
    expect(w.basis).toBe('reported');
    expect(w.maxMinutes).toBeGreaterThan(0);
  });

  test('every bay taken gives a range, never a single number', () => {
    const w = expectedWait(busy(), NEXON_EV, now, min(5), config);
    expect(w.basis).toBe('history');
    expect(w.maxMinutes).toBeGreaterThan(w.minMinutes);
  });

  test('a live queue lengthens the wait; an unreported one is not assumed', () => {
    const none = expectedWait(busy(0), NEXON_EV, now, min(5), config);
    const queued = expectedWait(busy(3), NEXON_EV, now, min(5), config);
    expect(queued.maxMinutes).toBeGreaterThan(none.maxMinutes + 10);
    // A queue on a feed that is no longer live is not believed.
    const stale = {
      ...busy(3),
      statusFeed: {
        source: 'operator_feed' as const,
        updatedAt: now - 20 * 60000,
      },
    };
    const w = expectedWait(stale, NEXON_EV, now, min(5), config);
    // The stale feed's queue is ignored, so it reads exactly like "no queue".
    expect(w.minMinutes).toBe(none.minMinutes);
    expect(w.maxMinutes).toBe(none.maxMinutes);
    expect(w.maxMinutes).toBeLessThan(queued.maxMinutes);
  });

  test('the further away, the more of a queue clears on its own', () => {
    const near = expectedWait(busy(3), NEXON_EV, now, min(5), config);
    const far = expectedWait(busy(3), NEXON_EV, now, min(45), config);
    expect(far.maxMinutes).toBeLessThan(near.maxMinutes);
  });

  test('an unknown status is unknown, not zero', () => {
    const zeon = base.find(s => s.id === 'st-zeon-karolbagh') as Station;
    const w = expectedWait(zeon, NEXON_EV, now, min(5), config);
    expect(w.basis).toBe('none');
    expect(waitMid(w)).toBeGreaterThan(0);
  });

  test('offline is unknown wait', () => {
    const dead = withStationStatus(base, neemrana.id, 'offline', now).find(
      s => s.id === neemrana.id,
    ) as Station;
    expect(expectedWait(dead, NEXON_EV, now, min(5), config).basis).toBe(
      'none',
    );
  });
});

describe('availability at arrival (rules, not a model)', () => {
  test('says which engine answered, and never claims a model', () => {
    const o = outlookAtArrival(neemrana, NEXON_EV, now, min(8), config);
    expect(o.basis).toBe('rules');
    expect(o.currentAvailability).toBe('available');
    expect(o.predictedAvailabilityAtArrival).toBe('likely_available');
    expect(o.predictionConfidence).toBe('high');
    expect(o.expectedArrivalTime).toBe(min(8));
  });

  test('gets less sure the further ahead it looks, and gives up past an hour', () => {
    const mid = outlookAtArrival(neemrana, NEXON_EV, now, min(40), config);
    expect(mid.predictionConfidence).toBe('low');
    expect(mid.predictedAvailabilityAtArrival).toBe('uncertain');
    const far = outlookAtArrival(neemrana, NEXON_EV, now, min(90), config);
    expect(far.predictedAvailabilityAtArrival).toBeNull();
    expect(far.predictionConfidence).toBeNull();
    expect(far.basis).toBe('none');
  });

  test('an unknown or offline charger gets no prediction at all', () => {
    const zeon = base.find(s => s.id === 'st-zeon-karolbagh') as Station;
    const o = outlookAtArrival(zeon, NEXON_EV, now, min(5), config);
    expect(o.currentAvailability).toBe('unknown');
    expect(o.predictedAvailabilityAtArrival).toBeNull();
  });

  test('a busy charger is likely busy when we are close', () => {
    const o = outlookAtArrival(busy(), NEXON_EV, now, min(5), config);
    expect(o.predictedAvailabilityAtArrival).toBe('likely_busy');
  });

  test('a real model, when registered, takes over', () => {
    const model = {
      predict: () => ({
        currentAvailability: 'available' as const,
        predictedAvailabilityAtArrival: 'likely_available' as const,
        predictionConfidence: 'high' as const,
        expectedArrivalTime: min(30),
        basis: 'model' as const,
      }),
    };
    expect(
      outlookAtArrival(neemrana, NEXON_EV, now, min(30), config, model).basis,
    ).toBe('model');
  });
});
