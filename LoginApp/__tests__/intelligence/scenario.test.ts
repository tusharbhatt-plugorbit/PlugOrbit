import {ScenarioDriver} from '../../src/dev/scenarioDriver';
import {accuracyOf, buildOutcome} from '../../src/intelligence/analytics';
import {tripStatus} from '../../src/intelligence/status';

/**
 * The product's first scenario, end to end on mock data: Tata Nexon EV, 72%,
 * Delhi to Jaipur. Each block below is a stage of the flow in the brief.
 */
describe('Smart Drive: the first scenario', () => {
  const d = new ScenarioDriver({soc: 72});

  test('1-4  enter a destination, PlugOrbit works it out, and says you are good to drive', () => {
    expect(d.trip.origin.label).toBe('Delhi');
    expect(d.trip.destination.label).toBe('Jaipur');
    expect(d.trip.phase).toBe('ready');
    const status = tripStatus(d.trip);
    expect(status.tone).toBe('good');
    expect(status.headline).toBe('You’re good to drive.');
    expect(status.detail).toMatch(/No charging needed right now/);
    // The trip does need a stop later: "charging required: yes".
    expect(d.trip.chargingRequired).toBe(true);
  });

  test('5    starting the trip welcomes the driver once', () => {
    d.start();
    expect(d.trip.phase).toBe('driving');
    expect(d.said()).toEqual(['INFO You’re good to drive.']);
  });

  test('6-7  it has already chosen a primary charger and a backup', () => {
    expect(d.trip.primaryStop?.station.name).toContain('Neemrana');
    expect(d.trip.backupStop).not.toBeNull();
    expect(d.trip.backupStop?.station.id).not.toBe(
      d.trip.primaryStop?.station.id,
    );
    expect(d.trip.monitoringState).toBe('monitoring');
  });

  test('8    for the first stretch it stays silent', () => {
    d.driveTo(60);
    expect(d.said()).toEqual(['INFO You’re good to drive.']);
    // ...but it was checking the whole time, and kept count.
    expect(d.trip.counters.checks).toBeGreaterThan(10);
    expect(d.trip.counters.told).toBe(1);
  });

  test('9-10 the stop becomes relevant, and only then does it speak up', () => {
    d.driveTo(d.trip.primaryStop!.alongKm - 29);
    const approaching = d.told.find(n => n.kind === 'stop_approaching');
    expect(approaching).toBeDefined();
    expect(approaching?.level).toBe('action');
    expect(approaching?.title).toMatch(/^Charging stop coming up in \d+ km\.$/);
    expect(approaching?.body).toMatch(/We’ve selected .*Neemrana/);
    expect(approaching?.body).toMatch(/Expected battery on arrival: \d+%/);
    expect(approaching?.body).toMatch(/Recommended charge: \d+% → \d+%/);
    expect(approaching?.body).toMatch(/Your backup is ready\./);
  });

  test('11-12 the primary fills up: it notices, and does not panic over a short wait', () => {
    const before = d.told.length;
    d.occupy(d.trip.primaryStop!.station.id, 0);
    d.tick();
    const events = d.events.map(e => e.type);
    expect(events).toContain('CHARGER_STATUS_CHANGED');
    expect(events).toContain('PRIMARY_CHARGER_OCCUPIED');
    // Busy, but the wait is short and it is still the best option: stays quiet
    // or sends at most a calm heads-up, never a plan change.
    const newOnes = d.told.slice(before);
    newOnes.forEach(n => expect(['info', 'action']).toContain(n.level));
  });

  test('13-15 a long queue makes another charger clearly better: ONE calm plan-change message', () => {
    const oldPrimary = d.trip.primaryStop!.station.id;
    const before = d.told.length;
    d.occupy(oldPrimary, 6);
    d.tick();
    const changed = d.told.slice(before).filter(n => n.level === 'important');
    expect(changed).toHaveLength(1);
    expect(changed[0].kind).toBe('better_charger');
    expect(changed[0].title).toBe('We’ve found a better charging stop.');
    expect(changed[0].cta).toEqual({
      label: 'Switch route',
      action: 'switch_route',
    });
    expect(d.trip.primaryStop?.station.id).not.toBe(oldPrimary);
    expect(d.trip.lastChange).toMatchObject({
      from: oldPrimary,
      acknowledged: false,
    });
  });

  test('16   it does not flip back and forth on the same news', () => {
    const switches = () => d.told.filter(n => n.level === 'important').length;
    const n = switches();
    d.tick();
    d.tick(2);
    d.tick(3);
    expect(switches()).toBe(n);
  });

  test('17   the driver reaches the new stop', () => {
    d.driveToStop();
    expect(d.trip.phase).toBe('at_stop');
    expect(d.told.map(n => n.kind)).toContain('near_charger');
    expect(d.trip.prediction).not.toBeNull();
    expect(d.trip.arrivedAtStopAt).not.toBeNull();
  });

  let target = 0;

  test('18-20 charging starts', () => {
    const stop = d.trip.primaryStop!;
    target = d.trip.recommendedTargetSoC as number;
    expect(target).toBe(stop.metrics.targetSoc);
    d.dispatch({
      type: 'SESSION_STARTED',
      at: d.now,
      stationId: stop.station.id,
      startSoc: d.trip.currentSoC,
      targetSoc: target,
    });
    expect(d.trip.phase).toBe('charging');
    expect(d.told.at(-1)?.kind).toBe('charging_started');
    expect(d.trip.session?.targetSoc).toBe(target);
  });

  test('21-22 it tells you the moment you have enough, not at 100%', () => {
    const before = d.told.length;
    // Charge up in a few readings.
    const to = target;
    for (let soc = d.trip.currentSoC + 5; soc < to; soc += 5) {
      d.now += 120000;
      d.dispatch({type: 'BATTERY_UPDATED', at: d.now, soc});
    }
    d.now += 120000;
    d.dispatch({type: 'TARGET_SOC_REACHED', at: d.now, soc: to});
    const enough = d.told.slice(before).find(n => n.kind === 'enough_charge');
    expect(enough?.title).toBe(`You’re at ${to}%.`);
    expect(enough?.body).toBe('That’s enough for the rest of your trip.');
    expect(enough?.cta?.action).toBe('continue_trip');
    expect(to).toBeLessThan(80);
  });

  test('23   the driver carries on', () => {
    d.now += 60000;
    d.dispatch({type: 'SESSION_ENDED', at: d.now, soc: target});
    expect(d.trip.session).toBeNull();
    expect(d.trip.phase).toBe('continuing');
    expect(d.told.at(-1)?.kind).toBe('ready_to_continue');
    expect(tripStatus(d.trip).headline).toBe('You’re ready to go.');
    // The stop just used is never planned again.
    d.driveTo(d.trip.progressKm + 5);
    expect(d.trip.plan.primary?.station.id).not.toBe(d.trip.visitedStopIds[0]);
    expect(d.trip.chargingRequired).toBe(false);
  });

  test('24   the destination is reached', () => {
    d.driveTo(d.trip.totalKm);
    expect(d.trip.phase).toBe('arrived');
    expect(d.trip.monitoringState).toBe('ended');
    expect(d.told.at(-1)?.title).toBe('You’ve arrived.');
    // The trip never ran dry.
    expect(d.trip.currentSoC).toBeGreaterThan(5);
  });

  test('25   prediction versus reality is saved', () => {
    const outcome = buildOutcome(d.trip, {costInr: 330, rating: 5});
    expect(outcome.followedPlan).toBe(true);
    expect(outcome.predicted.targetSoc).toBe(d.trip.prediction?.targetSoc);
    expect(outcome.actual.arriveSoc).not.toBeNull();
    expect(outcome.error.arriveSocPts).not.toBeNull();
    expect(Math.abs(outcome.error.arriveSocPts as number)).toBeLessThan(3);
    expect(outcome.copilot.checks).toBeGreaterThan(20);
    const acc = accuracyOf([outcome]);
    expect(acc.trips).toBe(1);
    expect(acc.arriveSocErrPts).not.toBeNull();
  });

  test('over the whole trip silence dominates: few messages, none critical', () => {
    // The natural arc of a 282 km trip with a charger swap is about ten messages.
    expect(d.told.length).toBeLessThanOrEqual(11);
    expect(d.trip.counters.checks).toBeGreaterThan(d.told.length * 4);
    expect(d.told.filter(n => n.level === 'critical')).toHaveLength(0);
    // One plan change, announced once. (The only other IMPORTANT message is the
    // honest "options are limited here" warning, which is about a thin stretch.)
    expect(d.told.filter(n => n.kind === 'better_charger')).toHaveLength(1);
    expect(
      d.told.filter(n => n.level === 'important').length,
    ).toBeLessThanOrEqual(2);
    // "Limited options" is never announced while parked at a charger.
    d.decisions
      .filter(x => x.draft?.kind === 'limited_options')
      .forEach(x =>
        expect(x.draft?.at).toBeLessThan(d.trip.arrivedAtStopAt ?? Infinity),
      );
  });
});
