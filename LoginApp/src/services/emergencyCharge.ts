import type {Station, Vehicle} from '../domain/types';
import {DEFAULT_SMART_DRIVE_CONFIG as config} from '../intelligence/config';
import {safeReachKm, socAfterKm} from '../intelligence/battery';
import {evaluateStation, evaluateArrival} from '../intelligence/safety';
import {chooseConnector} from '../intelligence/stopMetrics';
import type {Coords} from '../utils/geo';
import {distanceKm} from '../utils/geo';
import {roadRoute, type RoadGeometry} from './roadRouting';
import {googleStations} from './mock/stationService';
import {ApiError} from './types';

export class EmergencyChargerNotFound extends ApiError {}

/** Search all directions around departure, then verify actual road distance. */
export async function emergencyChargeRoute(origin: Coords, destination: Coords, vehicle: Vehicle, soc: number, now: number): Promise<{road: RoadGeometry; station: Station}> {
  const reach = safeReachKm(vehicle, soc, config.absoluteFloorPct, config);
  if (reach <= 0) throw new ApiError('Battery is below the safe driving floor. Do not set off; charge where you are or request roadside assistance.');
  const nearby = await googleStations(origin, true, Math.max(100, Math.min(50000, reach * 1000)));
  const candidates = nearby.filter(s => evaluateStation(s, vehicle).length === 0 && distanceKm(origin,s) <= reach)
    .sort((a,b) => distanceKm(origin,a)-distanceKm(origin,b));
  let best: {station: Station; road: RoadGeometry} | null = null;
  // An aerial distance is a lower bound: stop once no remaining candidate can beat the best road distance.
  for (const station of candidates) {
    if (best && distanceKm(origin,station) > best.road.distanceKm) break;
    const leg = await roadRoute([origin, station]);
    const verdict = evaluateArrival(station, {etaAt: now + leg.durationMin * 60000,
      arriveSoc: socAfterKm(vehicle,soc,leg.distanceKm,config), connector: chooseConnector(station,vehicle)}, now, 'battery_critical', config.minimumSafetyReservePct, config);
    if (verdict.violations.length === 0 && (!best || leg.distanceKm < best.road.distanceKm)) best = {station, road:leg};
  }
  if (!best) throw new EmergencyChargerNotFound('No reachable compatible charger was confirmed nearby. Google may not publish connector details. Verify a nearby operator or request roadside assistance; do not drive toward the destination on this battery.');
  const onward = await roadRoute([best.station, destination]);
  return {station:best.station, road:{points:[...best.road.points, ...onward.points.slice(1)],
    distanceKm:best.road.distanceKm + onward.distanceKm, durationMin:best.road.durationMin + onward.durationMin}};
}
