import type {Route} from './types';
import {appStore} from '../store/appStore';

/** Pure toggle, kept separate so it can be unit tested without the store. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

/**
 * Saves or un-saves a charger. Returns true when it is now saved.
 * Favourites are a pure UI preference kept on the device, so this does not
 * need a service round trip (and works offline).
 */
export function toggleFavouriteStation(stationId: string): boolean {
  const next = toggleId(appStore.get().favouriteStationIds, stationId);
  appStore.set({favouriteStationIds: next});
  return next.includes(stationId);
}

export function removeSavedRoute(routeId: string): void {
  appStore.set(s => ({
    savedRoutes: s.savedRoutes.filter(r => r.id !== routeId),
  }));
}

/**
 * Makes a freshly planned route the cached active route, which is what the
 * Route result screen reads (and what keeps working on a weak highway signal).
 */
export function setActiveRoute(route: Route): void {
  appStore.set({activeRoute: route});
}
