import {
  evaluateArrival,
  evaluateRemoteStart,
  evaluateStation,
  evaluateStop,
  mayClaimLive,
} from '../../src/intelligence/safety';
import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../../src/intelligence/config';
import {
  LEAF,
  NEXON_EV,
  mockStations,
  noon,
  withStationStatus,
} from '../../src/dev/smartDriveFixtures';
import type {Station} from '../../src/domain/types';

const now = noon();
const stations = mockStations(now);
const get = (id: string): Station => stations.find(s => s.id === id) as Station;
const codes = (v: {code: string}[]) => v.map(x => x.code);
const soc = (n: number) => ({expected: n, low: n, high: n});
const facts = (arrive: number, etaAt = now + 600000) => ({
  etaAt,
  arriveSoc: soc(arrive),
  connector: null,
});

describe('SafetyRuleEngine: the charger itself', () => {
  test('a charger whose connectors are unknown is never recommended', () => {
    const unknown = {...get('st-chargezone-neemrana'), connectors: []};
    expect(codes(evaluateStation(unknown, NEXON_EV))).toEqual([
      'CONNECTOR_UNCONFIRMED',
    ]);
  });

  test('the vehicle must be compatible with a connector', () => {
    // Bawal is CCS2-only; a CHAdeMO car cannot use it.
    expect(codes(evaluateStation(get('st-statiq-bawal'), LEAF))).toEqual([
      'INCOMPATIBLE_CONNECTOR',
    ]);
    expect(evaluateStation(get('st-statiq-bawal'), NEXON_EV)).toEqual([]);
    // Neemrana has a CHAdeMO bay, so the Leaf is fine there.
    expect(evaluateStation(get('st-chargezone-neemrana'), LEAF)).toEqual([]);
  });

  test('a charger known to be offline is not recommended', () => {
    const dead = withStationStatus(
      stations,
      'st-chargezone-neemrana',
      'offline',
      now,
    ).find(s => s.id === 'st-chargezone-neemrana') as Station;
    expect(codes(evaluateStation(dead, NEXON_EV))).toEqual(['CHARGER_OFFLINE']);
  });

  test('one offline bay among working ones is fine', () => {
    // Behror has one working and one offline CCS2 bay.
    expect(evaluateStation(get('st-tata-behror'), NEXON_EV)).toEqual([]);
  });
});

describe('SafetyRuleEngine: reaching it', () => {
  const station = get('st-chargezone-neemrana');

  test('the charger must be reachable, keeping the reserve', () => {
    const ok = evaluateArrival(station, facts(30), now, 'normal', 12, config);
    expect(ok.violations).toEqual([]);

    const tight = evaluateArrival(station, facts(8), now, 'normal', 12, config);
    expect(codes(tight.violations)).toEqual(['BELOW_RESERVE']);

    const gone = evaluateArrival(station, facts(3), now, 'normal', 12, config);
    expect(codes(gone.violations)).toEqual(['UNREACHABLE']);
  });

  test('uses the pessimistic edge of the battery band', () => {
    const band = {
      etaAt: now + 600000,
      arriveSoc: {expected: 20, low: 9, high: 24},
      connector: null,
    };
    const r = evaluateArrival(station, band, now, 'normal', 12, config);
    expect(codes(r.violations)).toEqual(['BELOW_RESERVE']);
  });

  test('battery-critical mode may dip into the reserve, never the last of it', () => {
    const dip = evaluateArrival(
      station,
      facts(8),
      now,
      'battery_critical',
      12,
      config,
    );
    expect(dip.violations).toEqual([]);
    expect(dip.warnings).toContain('RESERVE_BREACH_ACCEPTED');
    const empty = evaluateArrival(
      station,
      facts(3),
      now,
      'battery_critical',
      12,
      config,
    );
    expect(codes(empty.violations)).toEqual(['UNREACHABLE']);
  });

  test('a charger that is closed on arrival is ruled out', () => {
    const rajiv = get('st-statiq-rajiv'); // Open 6 AM - 11 PM
    const lateNight = new Date(2026, 0, 15, 23, 30).getTime();
    expect(
      codes(
        evaluateArrival(rajiv, facts(40, lateNight), now, 'normal', 12, config)
          .violations,
      ),
    ).toEqual(['CLOSED_AT_ARRIVAL']);
    expect(
      evaluateArrival(rajiv, facts(40, now), now, 'normal', 12, config)
        .violations,
    ).toEqual([]);
  });

  test('caveats lower confidence but do not forbid the stop', () => {
    const odd: Station = {
      ...station,
      hours: 'Hours unknown',
      integration: 'external',
      statusFeed: {source: 'none', updatedAt: null},
    };
    const r = evaluateArrival(odd, facts(40), now, 'normal', 12, config);
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        'HOURS_UNKNOWN',
        'STATUS_UNKNOWN',
        'OPERATOR_APP_REQUIRED',
      ]),
    );
  });

  test('evaluateStop combines both sets of rules', () => {
    const v = evaluateStop({
      station: get('st-statiq-bawal'),
      vehicle: LEAF,
      facts: facts(3),
      now,
      mode: 'normal',
      reservePct: 12,
      config,
    });
    expect(v.safe).toBe(false);
    expect(codes(v.violations)).toEqual([
      'INCOMPATIBLE_CONNECTOR',
      'UNREACHABLE',
    ]);
  });
});

describe('LIVE is claimed only from a fresh operator feed', () => {
  test('fresh operator feed', () => {
    expect(mayClaimLive(get('st-chargezone-neemrana'), now)).toBe(true);
  });
  test('the same feed gone quiet is not live', () => {
    expect(mayClaimLive(get('st-chargezone-neemrana'), now + 10 * 60000)).toBe(
      false,
    );
  });
  test('Google-sourced and user-reported data are never live', () => {
    expect(mayClaimLive(get('st-jiobp-lodhi'), now)).toBe(false);
    expect(mayClaimLive(get('st-glida-neemrana'), now)).toBe(false);
  });
});

describe('remote start needs valid payment', () => {
  const methods = [
    {
      id: 'ok',
      kind: 'upi',
      label: 'UPI',
      detail: '',
      validated: true,
      isDefault: true,
    },
    {
      id: 'bad',
      kind: 'wallet',
      label: 'W',
      detail: '',
      validated: false,
      isDefault: false,
    },
  ] as const;
  const base = {
    station: get('st-chargezone-neemrana'),
    connectorId: 'st-chargezone-neemrana-c2',
    paymentMethods: methods,
    methodId: 'ok',
    preauthorised: true,
    operatorLinkDown: false,
  };

  test('allowed only with a validated method and a successful pre-authorisation', () => {
    expect(evaluateRemoteStart(base)).toEqual({allowed: true});
    expect(evaluateRemoteStart({...base, methodId: 'bad'})).toEqual({
      allowed: false,
      code: 'NO_VALID_PAYMENT',
    });
    expect(evaluateRemoteStart({...base, methodId: null})).toEqual({
      allowed: false,
      code: 'NO_VALID_PAYMENT',
    });
    expect(evaluateRemoteStart({...base, preauthorised: false})).toEqual({
      allowed: false,
      code: 'NO_PREAUTH',
    });
  });

  test('never claims control of a charger it does not control', () => {
    expect(
      evaluateRemoteStart({
        ...base,
        station: get('st-jiobp-lodhi'),
        connectorId: 'st-jiobp-lodhi-c1',
      }),
    ).toEqual({allowed: false, code: 'NOT_INTEGRATED'});
    expect(evaluateRemoteStart({...base, operatorLinkDown: true})).toEqual({
      allowed: false,
      code: 'OPERATOR_LINK_DOWN',
    });
  });

  test('a busy or unpriced connector cannot be started', () => {
    expect(
      evaluateRemoteStart({...base, connectorId: 'st-chargezone-neemrana-c1'}),
    ).toEqual({allowed: false, code: 'CONNECTOR_UNAVAILABLE'});
  });
});
