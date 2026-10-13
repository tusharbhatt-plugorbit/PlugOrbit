import React, {createContext, useContext, useMemo} from 'react';
import {LIVE_SERVICES} from '../config/servicesMode';
import {createBackendSupportService} from './support';
import {createRouteService} from './mock/routeService';
import {createSmartDriveService} from './mock/smartDriveService';
import {createSessionService} from './mock/sessionService';
import {createPaymentService} from './mock/paymentService';
import {createStationService} from './mock/stationService';
import {
  createNotificationService,
  createPreferencesService,
  createSupportService,
  createVehicleService,
} from './mock/miscServices';
import type {Services} from './types';

export * from './types';

/**
 * True while chargers, their availability and the drive are sample data (the mock
 * layer), not Google Places listings and real roads. Screens use it to say so. It
 * follows the services mode (see config/servicesMode.ts). Payments, charging sessions
 * and vehicle telemetry stay simulated in both modes until an operator integration
 * exists; screens that show them say so.
 */
export const RUNS_ON_DEMO_DATA = !LIVE_SERVICES;

/** All services backed by the mock layer. Swap per service for a real backend. */
export function createMockServices(): Services {
  return {
    smartDrive: createSmartDriveService(),
    vehicle: createVehicleService(),
    station: createStationService(),
    route: createRouteService(),
    session: createSessionService(),
    payment: createPaymentService(),
    support: createSupportService(),
    notification: createNotificationService(),
    preferences: createPreferencesService(),
  };
}

/**
 * What the app runs on: the mock layer, with chargers, routes, the drive and support
 * swapped for live ones in live mode. Payments, sessions, vehicles, notifications and
 * preferences are mock in both.
 */
export function createDefaultServices(live: boolean = LIVE_SERVICES): Services {
  const mock = createMockServices();
  if (!live) {
    return mock;
  }
  return {
    ...mock,
    station: createStationService(true),
    route: createRouteService(true),
    smartDrive: createSmartDriveService(true),
    support: createBackendSupportService(),
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services?: Services;
  children: React.ReactNode;
}) {
  const value = useMemo(() => services ?? createDefaultServices(), [services]);
  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) {
    throw new Error('useServices must be used inside <ServicesProvider>');
  }
  return s;
}
