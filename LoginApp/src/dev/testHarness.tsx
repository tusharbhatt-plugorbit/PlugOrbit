import React from 'react';
import {AppNavigator} from '../navigation/AppNavigator';
import {useNavigationState} from '../navigation/NavigationContext';
import type {RouteName, TabName} from '../navigation/params';
import {REGISTRY} from '../navigation/registry';
import {ServicesProvider, createMockServices} from '../services';
import type {Services} from '../services/types';
import {VEHICLE_CATALOG} from '../services/mock/data';
import {resetAppStore} from '../store/appStore';
import {resetDemo} from '../store/demoStore';
import {seedState} from '../store/seed';
import type {ChargingSession} from '../domain/types';

export const NEXON = {...VEHICLE_CATALOG[0], id: 'veh-1'};

export function liveSession(
  status: ChargingSession['status'] = 'active',
  now = Date.now(),
): ChargingSession {
  return {
    id: 'PO-LIVE01',
    stationId: 'st-chargezone-neemrana',
    stationName: 'ChargeZone • Neemrana',
    connectorId: 'st-chargezone-neemrana-c2',
    connectorLabel: 'C2 • CCS2',
    connectorType: 'CCS2',
    powerKw: 60,
    pricePerKwh: 18,
    batteryKwh: 40.5,
    startSoc: 42,
    targetSoc: 80,
    startedAt: now - 25_000,
    stoppedAt: status === 'active' ? null : now - 5_000,
    status,
    paymentMethodId: 'pm-upi',
    preauthId: 'pa-1',
    preauthAmountInr: 700,
    receiptNo: null,
    failureReason:
      status === 'payment_failed' ? 'Your bank declined the payment.' : null,
  };
}

/** A signed-in account with a vehicle, seeded history and (optionally) a session. */
export function seedSignedIn(
  opts: {session?: ChargingSession['status']; soc?: number} = {},
) {
  const now = Date.now();
  resetDemo();
  resetAppStore({
    ...seedState(now),
    hydrated: true,
    signedIn: true,
    vehicles: [NEXON],
    activeVehicleId: NEXON.id,
    battery: {percent: opts.soc ?? 60, source: 'manual', updatedAt: now},
    session: opts.session ? liveSession(opts.session, now) : null,
  });
}

/** Records the visible route so tests can assert where a press led. */
export const probe: {
  current: RouteName | null;
  tab: TabName | null;
  depth: number;
} = {
  current: null,
  tab: null,
  depth: 0,
};

function Probe() {
  const s = useNavigationState();
  probe.current = s.current;
  probe.tab = s.tab;
  probe.depth = s.depth;
  return null;
}

/** The real navigator + registry, with a probe and no tab bar chrome. */
export function TestApp({
  tab,
  stack = [],
  services,
}: {
  tab?: TabName;
  stack?: ReadonlyArray<{name: RouteName; params?: unknown}>;
  /** Override individual services (fakes) on top of the mocks. */
  services?: Partial<Services>;
}) {
  const merged = React.useMemo(
    () => (services ? {...createMockServices(), ...services} : undefined),
    [services],
  );
  return (
    <ServicesProvider services={merged}>
      <AppNavigator
        registry={REGISTRY}
        initialTab={tab}
        initialStack={stack}
        renderTabBar={() => null}
        overlay={<Probe />}
      />
    </ServicesProvider>
  );
}
