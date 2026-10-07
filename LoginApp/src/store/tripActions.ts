import type {Route, SavedRoute} from '../domain/types';
import {appStore} from './appStore';

/**
 * Cache the plan the driver is following, and the stop + backup they chose, so a
 * weak highway signal (or an app restart) never loses them.
 */
export function cacheRoute(route: Route, stopIndex = 0): void {
  const stop = route.stops[stopIndex];
  appStore.set({
    activeRoute: route,
    chosen: stop
      ? {
          stationId: stop.station.id,
          connectorId: stop.connectorId,
          backupStationId: stop.backup.id,
          at: Date.now(),
        }
      : null,
  });
}

export function chooseStop(route: Route, stopIndex: number): void {
  cacheRoute(route, stopIndex);
}

export function clearRoute(): void {
  appStore.set({activeRoute: null, chosen: null});
}

export function savedRouteFor(
  route: Pick<Route, 'fromLabel' | 'toLabel'>,
): SavedRoute | undefined {
  return appStore
    .get()
    .savedRoutes.find(
      r => r.fromLabel === route.fromLabel && r.toLabel === route.toLabel,
    );
}

/** Returns true when the route is saved after the toggle. */
export function toggleSavedRoute(route: Route): boolean {
  const existing = savedRouteFor(route);
  if (existing) {
    appStore.set(s => ({
      savedRoutes: s.savedRoutes.filter(r => r.id !== existing.id),
    }));
    return false;
  }
  appStore.set(s => ({
    savedRoutes: [
      {
        id: `sr-${Date.now().toString(36)}`,
        fromLabel: route.fromLabel,
        toLabel: route.toLabel,
        strategy: route.strategy,
        savedAt: Date.now(),
      },
      ...s.savedRoutes,
    ],
  }));
  return true;
}

export function toggleFavouriteStation(id: string): boolean {
  const has = appStore.get().favouriteStationIds.includes(id);
  appStore.set(s => ({
    favouriteStationIds: has
      ? s.favouriteStationIds.filter(x => x !== id)
      : [id, ...s.favouriteStationIds],
  }));
  return !has;
}
