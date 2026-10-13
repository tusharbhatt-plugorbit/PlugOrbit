/**
 * @format
 */

import {normalizeRoutingBase} from '../src/services/roadRouting';

describe('road routing endpoint', () => {
  test('defaults to the public OSRM demo server', () => {
    expect(normalizeRoutingBase(undefined)).toBe('https://router.project-osrm.org');
    expect(normalizeRoutingBase('   ')).toBe('https://router.project-osrm.org');
  });

  test('uses a configured server and ignores trailing slashes', () => {
    expect(normalizeRoutingBase(' https://osrm.example.com// ')).toBe(
      'https://osrm.example.com',
    );
  });
});
