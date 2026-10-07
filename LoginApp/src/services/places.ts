import {MAX_RESULTS, SEARCH_RADIUS_M, googleApiKey} from '../config/google';
import type {Charger} from '../data/chargers';
import type {Coords} from '../utils/geo';

// Places API (New) – Nearby Search.
// https://developers.google.com/maps/documentation/places/web-service/nearby-search
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const CHARGER_TYPE = 'electric_vehicle_charging_station';
const TIMEOUT_MS = 12_000;

// Only request what the UI renders; the field mask also drives billing.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.evChargeOptions',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
].join(',');

type ConnectorAggregation = {
  type?: string;
  maxChargeRateKw?: number;
  count?: number;
  availableCount?: number;
  outOfServiceCount?: number;
};

type PlaceResult = {
  id?: string;
  displayName?: {text?: string};
  formattedAddress?: string;
  location?: {latitude?: number; longitude?: number};
  evChargeOptions?: {
    connectorCount?: number;
    connectorAggregation?: ConnectorAggregation[];
  };
  regularOpeningHours?: {
    openNow?: boolean;
    periods?: {open?: unknown; close?: unknown}[];
  };
  currentOpeningHours?: {openNow?: boolean};
};

export class PlacesError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PlacesError';
    this.status = status;
  }
}

function describeHours(place: PlaceResult): string | null {
  const regular = place.regularOpeningHours;
  const periods = regular?.periods;
  // A single period that never closes is how Google encodes "open 24 hours".
  if (periods && periods.length === 1 && periods[0].open && !periods[0].close) {
    return 'Open 24/7';
  }
  const openNow = place.currentOpeningHours?.openNow ?? regular?.openNow;
  if (openNow === undefined) {
    return null;
  }
  return openNow ? 'Open now' : 'Closed';
}

export function toCharger(place: PlaceResult): Charger | null {
  const {latitude, longitude} = place.location ?? {};
  if (!place.id || latitude === undefined || longitude === undefined) {
    return null;
  }

  const aggregates = place.evChargeOptions?.connectorAggregation ?? [];
  const rates = aggregates
    .map(a => a.maxChargeRateKw)
    .filter((r): r is number => typeof r === 'number');
  const hasAvailability = aggregates.some(a => a.availableCount !== undefined);
  const available = hasAvailability
    ? aggregates.reduce((sum, a) => sum + (a.availableCount ?? 0), 0)
    : null;
  const total =
    place.evChargeOptions?.connectorCount ??
    (aggregates.length > 0
      ? aggregates.reduce((sum, a) => sum + (a.count ?? 0), 0)
      : null);

  return {
    id: place.id,
    name: place.displayName?.text ?? 'EV charging station',
    address: place.formattedAddress ?? null,
    latitude,
    longitude,
    powerKw: rates.length > 0 ? Math.max(...rates) : null,
    available,
    total,
    hours: describeHours(place),
    pricePerKwh: null,
  };
}

export async function fetchNearbyChargers(
  center: Coords,
  signal?: AbortSignal,
): Promise<Charger[]> {
  if (!googleApiKey) {
    throw new PlacesError('Google API key is not configured.');
  }

  // Combine the caller's abort with our own timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) {
    controller.abort();
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: [CHARGER_TYPE],
        maxResultCount: MAX_RESULTS,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {center, radius: SEARCH_RADIUS_M},
        },
      }),
    });

    if (!response.ok) {
      let detail = `Places request failed (${response.status}).`;
      try {
        const body = await response.json();
        detail = body?.error?.message ?? detail;
      } catch {
        // Non-JSON error body: keep the generic message.
      }
      throw new PlacesError(detail, response.status);
    }

    const data: {places?: PlaceResult[]} = await response.json();
    return (data.places ?? [])
      .map(toCharger)
      .filter((c): c is Charger => c !== null);
  } catch (e) {
    if (e instanceof PlacesError) {
      throw e;
    }
    if (signal?.aborted) {
      throw e; // Caller cancelled: let the hook ignore it.
    }
    if (controller.signal.aborted) {
      throw new PlacesError('The charger search timed out.');
    }
    throw new PlacesError('Could not reach Google. Check your connection.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
