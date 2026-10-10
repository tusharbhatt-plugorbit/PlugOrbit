import {ScenarioDriver} from '../../src/dev/scenarioDriver';
import {GUIDED_HOLDS_BACK} from '../../src/intelligence/notifications';
import {INITIAL_SMART_DRIVE, assistModeOf} from '../../src/intelligence/types';

/**
 * Orbit Assist's two modes, on the SAME events. Guided never volunteers a
 * suggestion; it still tells the driver everything the plan itself needs.
 */

const setOff = (d: ScenarioDriver) => {
  d.start();
  d.driveTo(58);
  return d.trip.primaryStop!.station.id;
};

describe('assist mode', () => {
  test('older saved preferences, with no mode, behave as Orbit Assist', () => {
    expect(assistModeOf({})).toBe('assist');
    expect(assistModeOf(INITIAL_SMART_DRIVE.prefs)).toBe('assist');
    expect(assistModeOf({mode: 'guided'})).toBe('guided');
  });

  test('Orbit Assist volunteers a better charger when a queue forms', () => {
    const d = new ScenarioDriver({mode: 'assist'});
    const primary = setOff(d);
    const before = d.told.length;
    d.occupy(primary, 6);
    d.tick();
    expect(d.told.slice(before).map(n => n.kind)).toContain('better_charger');
  });

  test('Guided says nothing about it, and writes down that it held back', () => {
    const d = new ScenarioDriver({mode: 'guided'});
    const primary = setOff(d);
    const before = d.told.length;
    d.occupy(primary, 6);
    d.tick();
    expect(d.told.slice(before).map(n => n.kind)).not.toContain(
      'better_charger',
    );
    const held = d.decisions.filter(
      x => x.why === 'Guided mode: suggestions wait until you ask.',
    );
    expect(held.length).toBeGreaterThan(0);
    // Nothing was hidden: the decision is on record with what was noticed.
    held.forEach(x => {
      expect(x.notify).toBe(false);
      expect(x.noticed.length).toBeGreaterThan(0);
    });
  });

  test('Guided still tells the driver when the charger they are heading to dies', () => {
    const d = new ScenarioDriver({mode: 'guided'});
    const primary = setOff(d);
    const before = d.told.length;
    d.takeOffline(primary);
    d.tick();
    const kinds = d.told.slice(before).map(n => n.kind);
    // An unusable stop is the plan failing, not an optional improvement.
    expect(kinds.some(k => !GUIDED_HOLDS_BACK.has(k))).toBe(true);
  });

  test('Guided and Orbit Assist announce a low battery and the stop ahead identically', () => {
    const told = (mode: 'guided' | 'assist') => {
      const d = new ScenarioDriver({mode, soc: 16});
      d.start();
      d.driveTo(8);
      return d.told.map(n => [n.kind, n.level]);
    };
    const guided = told('guided');
    expect(guided).toContainEqual(['battery_critical', 'critical']);
    expect(guided).toContainEqual(['stop_approaching', 'action']);
    expect(guided).toEqual(told('assist'));
  });

  test('the same trip in either mode makes the same plan: only the talking differs', () => {
    const guided = new ScenarioDriver({mode: 'guided'});
    const assist = new ScenarioDriver({mode: 'assist'});
    [guided, assist].forEach(setOff);
    expect(guided.trip.primaryStop?.station.id).toBe(
      assist.trip.primaryStop?.station.id,
    );
    expect(guided.trip.backupStop?.station.id).toBe(
      assist.trip.backupStop?.station.id,
    );
  });
});
