/**
 * @format
 */

import {resolveServicesMode} from '../src/config/servicesMode';
import {createDefaultServices, createMockServices} from '../src/services';

describe('resolveServicesMode', () => {
  test('goes live automatically once a Places key is configured', () => {
    expect(resolveServicesMode(undefined, true)).toBe('live');
    expect(resolveServicesMode('', true)).toBe('live');
  });

  test('stays on labelled demo data without a Places key', () => {
    expect(resolveServicesMode(undefined, false)).toBe('demo');
    expect(resolveServicesMode('  ', false)).toBe('demo');
  });

  test('an explicit setting wins, in either direction', () => {
    expect(resolveServicesMode('demo', true)).toBe('demo');
    expect(resolveServicesMode('live', false)).toBe('live');
    expect(resolveServicesMode(' LIVE ', false)).toBe('live');
  });

  test('an unrecognised setting is ignored rather than guessed at', () => {
    expect(resolveServicesMode('production', true)).toBe('live');
    expect(resolveServicesMode('production', false)).toBe('demo');
  });
});

describe('createDefaultServices', () => {
  test('demo mode is exactly the mock layer', () => {
    const demo = createDefaultServices(false);
    const mock = createMockServices();
    expect(Object.keys(demo).sort()).toEqual(Object.keys(mock).sort());
  });

  test('live mode swaps chargers, routes, the drive and support, and keeps the rest mock', () => {
    const live = createDefaultServices(true);
    const mock = createMockServices();
    expect(Object.keys(live).sort()).toEqual(Object.keys(mock).sort());
    // Same shape, different implementations for the four live services.
    for (const key of ['station', 'route', 'smartDrive', 'support'] as const) {
      expect(live[key]).toBeDefined();
    }
    // Live support talks to the Backend, so it can fetch a ticket by id; the local one cannot.
    expect(typeof live.support.get).toBe('function');
    expect(mock.support.get).toBeUndefined();
  });
});
