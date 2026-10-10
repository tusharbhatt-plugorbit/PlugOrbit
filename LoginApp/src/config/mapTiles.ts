import {MAP_TILE_ATTRIBUTION, MAP_TILE_REFERER, MAP_TILE_URL} from '@env';

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

/**
 * The address the map page is loaded "from". A page built from an HTML string
 * has no web address of its own, so its tile requests would carry no Referer,
 * and OpenStreetMap's tile servers refuse requests without one (the map stays
 * blank). Giving the page this base URL makes the WebView send it as the
 * Referer, which is also how OSM tells which app is asking. Nothing is loaded
 * from it. Set MAP_TILE_REFERER in `.env` to your own site for a real launch.
 */
export const TILE_REFERER: string =
  clean(MAP_TILE_REFERER) ||
  'https://github.com/tusharbhatt-plugorbit/PlugOrbit';

export const TILE_MAX_ZOOM = 19;
