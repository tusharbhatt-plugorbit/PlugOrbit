import type {Station, Vehicle} from '../domain/types';
import {DEFAULT_SMART_DRIVE_CONFIG} from '../intelligence/config';
import type {PlanInput} from '../intelligence/chargingPlan';
import {
  DELHI_JAIPUR_CORRIDOR,
  VEHICLE_CATALOG,
  buildStations,
} from '../services/mock/data';
import {buildPath} from '../utils/path';

/** The Tata Nexon EV the product scenario is written around. */
export const NEXON_EV: Vehicle = {...VEHICLE_CATALOG[0], id: 'veh-1'};

/** A CHAdeMO car: almost none of the corridor's chargers can serve it. */
export const LEAF: Vehicle = {
  ...(VEHICLE_CATALOG.find(
    v => v.modelId === 'nissan-leaf',
  ) as (typeof VEHICLE_CATALOG)[number]),
  id: 'veh-leaf',
};

/** Noon local time, so opening hours never depend on when the tests run. */
export function noon(): number {
  return new Date(2026, 0, 15, 12, 0, 0).getTime();
}

/** Delhi to Jaipur on the real NH48 corridor, as the planners see it. */
export const DELHI_JAIPUR_PATH = buildPath(DELHI_JAIPUR_CORRIDOR);

export function mockStations(now: number): Station[] {
  return buildStations(now);
}

/** Planner input for the first product scenario: Nexon, 72%, Delhi to Jaipur. */
export function scenarioInput(
  now: number,
  overrides: Partial<PlanInput> = {},
): PlanInput {
  return {
    now,
    vehicle: NEXON_EV,
    path: DELHI_JAIPUR_PATH,
    progressKm: 0,
    soc: 72,
    stations: mockStations(now),
    config: DEFAULT_SMART_DRIVE_CONFIG,
    ...overrides,
  };
}

/** Replace one station's connector statuses (a charger filling up or dying). */
export function withStationStatus(
  stations: readonly Station[],
  stationId: string,
  status: 'occupied' | 'offline' | 'available',
  now: number,
  queueLength?: number,
): Station[] {
  return stations.map(s =>
    s.id !== stationId
      ? s
      : {
          ...s,
          connectors: s.connectors.map(c => ({...c, status})),
          statusFeed: {source: 'operator_feed', updatedAt: now - 5000},
          ...(queueLength === undefined ? {} : {queueLength}),
        },
  );
}
