import {MAP_TILE_ATTRIBUTION, MAP_TILE_URL} from '@env';

const clean = (v: string | undefined) => (v ?? '').trim();

/**
 * Raster tiles for the fallback map, which is drawn on Android when the build
 * has no Google Maps key (see ChargerMap). Needs no key.
 *
 * The default is the public OpenStreetMap server, fine for development and
 * demos. Its usage policy (operations.osmfoundation.org/policies/tiles) rules
 * out heavy or commercial traffic, so for a real launch set MAP_TILE_URL (and
 * MAP_TILE_ATTRIBUTION) in LoginApp/.env to a provider you have an agreement
 * with, or, better, give the build a Google Maps key and this is not used.
 * `{z}/{x}/{y}` (and optional `{s}`, `{r}`) are filled in by Leaflet.
 */
export const TILE_URL: string =
  clean(MAP_TILE_URL) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** HTML shown in the corner of the map; the default credits OpenStreetMap. */
export const TILE_ATTRIBUTION: string =
  clean(MAP_TILE_ATTRIBUTION) ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const TILE_MAX_ZOOM = 19;
