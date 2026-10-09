import {ScenarioDriver} from '../../src/dev/scenarioDriver';
import {NEXON_EV} from '../../src/dev/smartDriveFixtures';
import {accuracyOf, buildOutcome} from '../../src/intelligence/analytics';
import {QUESTIONS, answerQuestion} from '../../src/intelligence/explain';
import {buildOfflineView, offlineTrust} from '../../src/intelligence/offline';
import {
  leansOf,
  profileFromPrefs,
  suggestionsFrom,
} from '../../src/intelligence/preferences';
import {idleStatus, tripStatus} from '../../src/intelligence/status';
import type {ChoiceSignal} from '../../src/intelligence/types';
import type {TripPreferences} from '../../src/domain/types';

const prefs: TripPreferences = {
  minArrivalSocPct: 12,
  strategy: 'reliable',
  avoidPaidParking: false,
  preferAmenities: false,
};

describe('Layer 5: the conversation explains, it does not decide', () => {
  const d = new ScenarioDriver();
  d.start();
  d.driveTo(40);
  const trip = d.trip;

  test('every suggested question gets an answer built from the plan', () => {
    QUESTIONS.forEach(q => {
      const a = answerQuestion(trip, q.id);
      expect(a.question).toBe(q.id);
      expect(a.text.length).toBeGreaterThan(20);
      expect(a.text).not.toMatch(/undefined|NaN|\bnull\b/);
    });
  });

  test('"Why are we stopping here?" speaks of real strengths and real minutes', () => {
    const a = answerQuestion(trip, 'why_here');
    expect(a.text).toMatch(
      /^This station is slightly farther than the closest option|is the closest reliable charger/,
    );
    expect(a.reasons.length).toBeGreaterThan(2);
  });

  test('"Can I skip this charger?" says what skipping would cost', () => {
    const a = answerQuestion(trip, 'skip');
    expect(a.text).toMatch(/\d+%/);
    expect(a.text).toMatch(/You can|Skipping/);
  });

  test('"Find me something cheaper" only offers a real, safe, cheaper option', () => {
    const a = answerQuestion(trip, 'cheaper');
    if (a.action) {
      expect(a.action.kind).toBe('switch');
      const safe = [
        trip.plan.primary,
        trip.plan.backup,
        ...trip.plan.alternatives,
      ]
        .filter(Boolean)
        .map(s => s?.station.id);
      expect(safe).toContain(a.action.stationId);
      expect(a.action.stationId).not.toBe(trip.plan.primary?.station.id);
      expect(a.text).toMatch(/₹\d+ cheaper/);
      expect(a.text).toMatch(/Want me to switch\?/);
    } else {
      expect(a.text).toMatch(/lowest-cost|hasn’t published/);
    }
  });

  test('it can never offer a charger the safety rules removed', () => {
    const ruled = new Set(trip.plan.ruledOut.map(r => r.stationId));
    QUESTIONS.forEach(q => {
      const a = answerQuestion(trip, q.id);
      if (a.action) {
        expect(ruled.has(a.action.stationId)).toBe(false);
      }
    });
  });

  test('the battery answer shows the charge-just-enough saving', () => {
    const a = answerQuestion(trip, 'battery');
    expect(a.text).toMatch(/I recommend charging to \d+%/);
    expect(a.text).toMatch(/to spare|next stop/);
  });

  test('with no stop planned it says so instead of inventing one', () => {
    const a = answerQuestion(
      {...trip, plan: {...trip.plan, primary: null, chargingRequired: false}},
      'why_here',
    );
    expect(a.text).toMatch(/No charging stop is planned/);
  });
});

describe('DriverPreferenceModel: learns, but never silently', () => {
  const sig = (leans: ChoiceSignal['leans'], i: number): ChoiceSignal => ({
    at: i,
    tripId: `t${i}`,
    chosenId: 'a',
    recommendedId: 'b',
    leans,
  });

  test('needs real evidence before suggesting anything', () => {
    expect(
      suggestionsFrom([sig(['faster'], 1), sig(['faster'], 2)], prefs, []),
    ).toEqual([]);
  });

  test('a clear pattern becomes a SUGGESTION the driver can accept', () => {
    const signals = [1, 2, 3, 4, 5].map(i => sig(['faster'], i));
    const [s] = suggestionsFrom(signals, prefs, []);
    expect(s.id).toBe('faster');
    expect(s.title).toBe('You usually pick faster chargers');
    expect(s.evidence).toEqual({count: 5, total: 5});
    expect(s.apply).toEqual({strategy: 'fastest'});
    // It only proposes: nothing about the preferences changed.
    expect(prefs.strategy).toBe('reliable');
  });

  test('a mixed history is not a pattern', () => {
    const signals = [
      sig(['faster'], 1),
      sig(['cheaper'], 2),
      sig([], 3),
      sig(['faster'], 4),
      sig([], 5),
    ];
    expect(suggestionsFrom(signals, prefs, [])).toEqual([]);
  });

  test('a dismissed suggestion stays dismissed; an adopted one is not repeated', () => {
    const signals = [1, 2, 3, 4].map(i => sig(['faster'], i));
    expect(suggestionsFrom(signals, prefs, ['faster'])).toEqual([]);
    expect(
      suggestionsFrom(signals, {...prefs, strategy: 'fastest'}, []),
    ).toEqual([]);
  });

  test('amenities are a preference of their own', () => {
    const signals = [1, 2, 3, 4].map(i => sig(['amenities'], i));
    expect(suggestionsFrom(signals, prefs, [])[0].apply).toEqual({
      preferAmenities: true,
    });
    expect(
      suggestionsFrom(signals, {...prefs, preferAmenities: true}, []),
    ).toEqual([]);
  });

  test('choices are read from real differences between the stops', () => {
    const d = new ScenarioDriver();
    const p = d.trip.plan.primary!;
    const cheaperStop = {
      ...p,
      metrics: {
        ...p.metrics,
        cost: {
          ...p.metrics.cost,
          totalInr: (p.metrics.cost.totalInr ?? 400) - 100,
        },
      },
    };
    expect(leansOf(cheaperStop, p)).toContain('cheaper');
    expect(leansOf(p, p)).toEqual([]);
  });

  test('the trip strategy maps to the planner profile', () => {
    expect(profileFromPrefs({...prefs, strategy: 'fastest'})).toBe('fastest');
    expect(profileFromPrefs({...prefs, strategy: 'cheapest'})).toBe('cheapest');
    expect(profileFromPrefs(prefs)).toBe('balanced');
  });
});

describe('OfflineTripService', () => {
  const d = new ScenarioDriver();
  d.start();
  d.driveTo(30);
  d.dispatch({type: 'NETWORK_LOST', at: d.now});

  test('keeps the whole plan available with no signal', () => {
    const v = buildOfflineView(d.trip, d.now + 18 * 60000)!;
    expect(v.headline).toBe('You’re offline.');
    expect(v.subline).toBe('Your charging plan is still available.');
    expect(v.destination.label).toBe('Jaipur');
    expect(v.routePoints).toBeGreaterThan(5);
    expect(v.stops.map(s => s.role)).toEqual(['primary', 'backup']);
    v.stops.forEach(s => {
      expect(s.coords.latitude).toBeGreaterThan(20);
      expect(s.connectorLabel).toBeTruthy();
      expect(s.chargerKw).toBeGreaterThan(0);
      expect(s.hours).toBeTruthy();
      expect(s.access).toMatch(/Without signal/);
      expect(s.operator).toBeTruthy();
    });
  });

  test('says how old the last status is', () => {
    const v = buildOfflineView(d.trip, d.now + 18 * 60000)!;
    expect(v.lastUpdate).toMatch(/^Last status update: .+\.$/);
  });

  test('NEVER shows a cached status as live, however fresh the cache', () => {
    // Even at the instant it was cached, an operator feed reads as live...
    const fresh = d.trip.plan.primary!.station.statusFeed;
    expect(offlineTrust(fresh, fresh.updatedAt as number)).toBe('estimated');
    // ...so the offline view cannot print LIVE.
    const v = buildOfflineView(d.trip, (fresh.updatedAt as number) + 1000)!;
    v.stops.forEach(s => {
      expect(s.status.trust).not.toBe('live');
      expect(s.status.label).not.toMatch(/LIVE/);
    });
  });

  test('prices are last-known, with their age', () => {
    const v = buildOfflineView(d.trip, d.now + 60000)!;
    expect(v.stops[0].price).toMatch(/₹\d+(\.\d+)?\/kWh, last known/);
  });

  test('no trip, nothing to show', () => {
    expect(buildOfflineView(null, 0)).toBeNull();
  });
});

describe('status line', () => {
  test('reassures by default', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(20);
    expect(tripStatus(d.trip)).toMatchObject({
      tone: 'good',
      headline: 'Your trip is on track.',
    });
    expect(tripStatus(d.trip).detail).toMatch(
      /Next stop: .+ ahead\. Your backup is ready\./,
    );
  });

  test('turns amber when the stop is near and red only when it must', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveTo(d.trip.primaryStop!.alongKm - 10);
    expect(tripStatus(d.trip).tone).toBe('watch');
    d.dispatch({type: 'BATTERY_UPDATED', at: d.now, soc: 12});
    expect(tripStatus(d.trip)).toMatchObject({
      tone: 'alert',
      headline: 'Battery is getting low.',
    });
  });

  test('Home with no trip, from the battery alone', () => {
    const base = {vehicle: NEXON_EV, reservePct: 12, criticalPct: 15};
    expect(idleStatus({...base, soc: 68})).toMatchObject({
      tone: 'good',
      headline: 'You’re good to drive.',
    });
    expect(idleStatus({...base, soc: 68}).detail).toMatch(
      /^About \d+ km before your 12% reserve\.$/,
    );
    expect(idleStatus({...base, soc: 14})).toMatchObject({
      tone: 'alert',
      headline: 'Battery is getting low.',
    });
    expect(idleStatus({...base, soc: null}).tone).toBe('watch');
    expect(idleStatus({...base, soc: 50, vehicle: null}).headline).toMatch(
      /Add your car/,
    );
  });
});

describe('feedback loop', () => {
  test('compares prediction with reality and summarises accuracy', () => {
    const d = new ScenarioDriver();
    d.start();
    d.driveToStop();
    const stop = d.trip.primaryStop!;
    d.dispatch({
      type: 'SESSION_STARTED',
      at: d.now + 6 * 60000,
      stationId: stop.station.id,
      startSoc: stop.metrics.arriveSoc.expected + 2,
      targetSoc: stop.metrics.targetSoc,
    });
    d.dispatch({
      type: 'SESSION_ENDED',
      at: d.now + 26 * 60000,
      soc: stop.metrics.targetSoc,
    });
    const out = buildOutcome(d.trip, {costInr: 400, rating: 4});
    expect(out.followedPlan).toBe(true);
    expect(out.error.arriveSocPts).toBeCloseTo(2, 0);
    expect(out.actual.chargeMinutes).toBe(20);
    expect(typeof out.error.waitInRange).toBe('boolean');
    expect(out.error.costInr).not.toBeNull();
    const acc = accuracyOf([out, out]);
    expect(acc).toMatchObject({trips: 2});
    expect(acc.arriveSocErrPts).toBeCloseTo(2, 0);
  });

  test('nothing to compare means null, never zero', () => {
    expect(accuracyOf([])).toEqual({
      trips: 0,
      arriveSocErrPts: null,
      waitWithinRangePct: null,
      chargeWithinRangePct: null,
      costErrInr: null,
    });
  });
});
