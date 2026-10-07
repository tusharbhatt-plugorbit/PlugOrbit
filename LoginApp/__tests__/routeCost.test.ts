/**
 * @format
 */

import {nearestAlternative} from '../src/domain/alternative';
import {stopCostLabel, tripCost} from '../src/domain/routeCost';
import {buildStations, VEHICLE_CATALOG} from '../src/services/mock/data';
import {withDistanceTo} from '../src/services/mock/stationService';

describe('stop and trip cost labels', () => {
  test('a stop without a published price says so, never a number', () => {
    expect(stopCostLabel(444)).toBe('₹444');
    expect(stopCostLabel(null)).toBe('Price not published');
  });

  test('trip totals never present a partial sum as the whole bill', () => {
    expect(tripCost([{costInr: 100}, {costInr: 250}]).label).toBe('₹350');
    expect(tripCost([{costInr: 100}, {costInr: null}]).label).toBe(
      '₹100 plus 1 unpriced stop',
    );
    expect(
      tripCost([{costInr: 100}, {costInr: null}, {costInr: null}]).label,
    ).toBe('₹100 plus 2 unpriced stops');
    expect(tripCost([{costInr: null}]).label).toBe('Price not published');
    expect(tripCost([{costInr: null}, {costInr: 80}]).knownInr).toBe(80);
    expect(tripCost([]).label).toBe('₹0');
  });
});

describe('nearestAlternative', () => {
  const nexon = {...VEHICLE_CATALOG[0], id: 'veh-1'};
  const all = buildStations(Date.now());
  const near = (id: string) => {
    const origin = all.find(s => s.id === id);
    if (!origin) {
      throw new Error(id);
    }
    return all
      .map(s => withDistanceTo(s, origin))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  };

  test('is never the charger it replaces, and prefers a free bay to a closer queue', () => {
    // City Mall has every bay taken; Tata Power Gurgaon (free) is close by.
    const alt = nearestAlternative(
      near('st-tata-citymall'),
      'st-tata-citymall',
      nexon,
    );
    expect(alt?.id).toBe('st-tata-gurgaon');
  });

  test('skips offline chargers', () => {
    const list = near('st-chargezone-neemrana').map(s =>
      s.id === 'st-glida-neemrana'
        ? {
            ...s,
            connectors: s.connectors.map(c => ({
              ...c,
              status: 'offline' as const,
            })),
          }
        : s,
    );
    const alt = nearestAlternative(list, 'st-chargezone-neemrana', nexon);
    expect(alt).not.toBeNull();
    expect(alt?.id).not.toBe('st-glida-neemrana');
  });

  test('skips anything too far to be a backup', () => {
    const lonely = near('st-chargezone-shahpura').filter(
      s => s.id === 'st-chargezone-shahpura' || s.distanceKm > 60,
    );
    expect(
      nearestAlternative(lonely, 'st-chargezone-shahpura', nexon),
    ).toBeNull();
  });
});
