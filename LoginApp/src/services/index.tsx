import React, {createContext, useContext, useMemo} from 'react';
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
export const RUNS_ON_DEMO_DATA = false;

/** All services backed by the mock layer. Swap per service for a real backend. */
export function createMockServices(): Services {
  return {
    demo:true,
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

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services?: Services;
  children: React.ReactNode;
}) {
  const value = useMemo(() => services ?? {...createMockServices(), demo:false, station: createStationService(true), route: createRouteService(true), smartDrive: createSmartDriveService(true), support: createBackendSupportService()}, [services]);
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
