/**
 * @format
 */

import {distanceKm, formatDistance} from '../src/utils/geo';

test('distanceKm matches the known length of one degree at the equator', () => {
  const km = distanceKm(
    {latitude: 0, longitude: 0},
    {latitude: 0, longitude: 1},
  );
  expect(km).toBeCloseTo(111.19, 1);
});

test('distanceKm is zero for the same point and symmetric', () => {
  const a = {latitude: 28.6139, longitude: 77.209};
  const b = {latitude: 28.4595, longitude: 77.0266};
  expect(distanceKm(a, a)).toBe(0);
  expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 10);
  expect(distanceKm(a, b)).toBeGreaterThan(20);
  expect(distanceKm(a, b)).toBeLessThan(30);
});

test('formatDistance switches between metres and kilometres', () => {
  expect(formatDistance(0.004)).toBe('10 m');
  expect(formatDistance(0.45)).toBe('450 m');
  expect(formatDistance(0.9996)).toBe('1.0 km');
  expect(formatDistance(2.44)).toBe('2.4 km');
  expect(formatDistance(12.6)).toBe('13 km');
});
