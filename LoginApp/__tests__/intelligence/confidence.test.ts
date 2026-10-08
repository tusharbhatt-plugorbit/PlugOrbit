import {
  chargeConfidenceOf,
  dataConfidenceOf,
} from '../../src/intelligence/confidence';
import {CHARGE_CONFIDENCE_LABEL} from '../../src/intelligence/copy';
import {
  NEXON_EV,
  mockStations,
  noon,
  withStationStatus,
} from '../../src/dev/smartDriveFixtures';
import type {Station} from '../../src/domain/types';

const now = noon();
const base = mockStations(now);
const get = (id: string, list: readonly Station[] = base): Station =>
  list.find(s => s.id === id) as Station;

describe('data confidence vs charge confidence', () => {
  test('a healthy live charger: live data, high charge confidence', () => {
    const s = get('st-chargezone-neemrana');
    expect(dataConfidenceOf(s, now)).toBe('live');
    expect(chargeConfidenceOf(s, NEXON_EV, now, [])).toBe('high');
  });

  test('they are different ideas: certain data can still mean a poor chance', () => {
    const busy = get(
      'st-chargezone-neemrana',
      withStationStatus(base, 'st-chargezone-neemrana', 'occupied', now),
    );
    // We are fully sure every bay is taken...
    expect(dataConfidenceOf(busy, now)).toBe('live');
    // ...which is exactly why a smooth stop is not likely.
    expect(chargeConfidenceOf(busy, NEXON_EV, now, [])).not.toBe('high');
  });

  test('an operator feed that went quiet is estimated, never live', () => {
    const s = get('st-chargezone-neemrana');
    expect(dataConfidenceOf(s, now + 10 * 60000)).toBe('estimated');
  });

  test('user-reported and unknown sources keep their own labels', () => {
    expect(dataConfidenceOf(get('st-glida-neemrana'), now)).toBe('user');
    expect(dataConfidenceOf(get('st-zeon-karolbagh'), now)).toBe('unknown');
  });

  test('without being able to see the bays, it can never be high', () => {
    const blind: Station = {
      ...get('st-chargezone-neemrana'),
      statusFeed: {source: 'none', updatedAt: null},
      connectors: get('st-chargezone-neemrana').connectors.map(c => ({
        ...c,
        status: 'unknown',
      })),
    };
    expect(chargeConfidenceOf(blind, NEXON_EV, now, [])).not.toBe('high');
  });

  test('"high" needs fresh evidence: an estimate is at most medium', () => {
    const s = get('st-chargezone-neemrana');
    expect(chargeConfidenceOf(s, NEXON_EV, now, [])).toBe('high');
    // Same charger, same history, but the feed went quiet two hours ago.
    expect(chargeConfidenceOf(s, NEXON_EV, now + 2 * 3600000, [])).toBe(
      'medium',
    );
  });

  test('staleness lowers it', () => {
    const s = get('st-chargezone-neemrana');
    const fresh = chargeConfidenceOf(s, NEXON_EV, now, []);
    const old = chargeConfidenceOf(s, NEXON_EV, now + 2 * 3600000, []);
    expect(['high', 'medium', 'low'].indexOf(old)).toBeGreaterThan(
      ['high', 'medium', 'low'].indexOf(fresh),
    );
  });

  test('a charger with unconfirmed connectors is low', () => {
    const s: Station = {...get('st-chargezone-neemrana'), connectors: []};
    expect(chargeConfidenceOf(s, NEXON_EV, now, [])).toBe('low');
  });

  test('uses words, not invented percentages', () => {
    expect(Object.values(CHARGE_CONFIDENCE_LABEL).join(' ')).not.toMatch(/\d/);
  });
});
