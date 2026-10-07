import {DEFAULT_CENTER} from '../config/google';
import {Coords, distanceKm} from '../utils/geo';

export type Filter = 'All' | 'Fast' | 'Available' | 'Near me';

export type Charger = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  // Max connector power in kW; null when Google doesn't report it.
  powerKw: number | null;
  // Live bay counts; null when Google doesn't report availability.
  available: number | null;
  total: number | null;
  // Human-readable opening hours ("Open 24/7", "Open now", "Closed").
  hours: string | null;
  // Google doesn't publish tariffs, so this is only set for demo data.
  pricePerKwh: number | null;
};

export type ChargerWithDistance = Charger & {distanceKm: number};

export const FILTERS: readonly Filter[] = [
  'All',
  'Fast',
  'Available',
  'Near me',
];

export const FAST_KW = 50;
export const NEAR_KM = 3;

export function withDistance(
  chargers: readonly Charger[],
  from: Coords,
): ChargerWithDistance[] {
  return chargers
    .map(ch => ({...ch, distanceKm: distanceKm(from, ch)}))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function matchesFilter(
  charger: ChargerWithDistance,
  filter: Filter,
): boolean {
  switch (filter) {
    case 'Fast':
      return charger.powerKw !== null && charger.powerKw >= FAST_KW;
    case 'Available':
      return charger.available !== null && charger.available > 0;
    case 'Near me':
      return charger.distanceKm <= NEAR_KM;
    default:
      return true;
  }
}

const {latitude: lat0, longitude: lng0} = DEFAULT_CENTER;

// Demo data around DEFAULT_CENTER, used only when no Google API key is set.
export const DEMO_CHARGERS: readonly Charger[] = [
  {
    id: 'demo-1',
    name: 'PlugOrbit Charge Hub',
    address: 'Connaught Place, New Delhi',
    latitude: lat0 + 0.012,
    longitude: lng0 - 0.018,
    powerKw: 250,
    available: 4,
    total: 6,
    hours: 'Open 24/7',
    pricePerKwh: 18,
  },
  {
    id: 'demo-2',
    name: 'Orbit Metro Station',
    address: 'Rajiv Chowk, New Delhi',
    latitude: lat0 - 0.002,
    longitude: lng0 + 0.004,
    powerKw: 60,
    available: 2,
    total: 4,
    hours: 'Open now',
    pricePerKwh: 16,
  },
  {
    id: 'demo-3',
    name: 'Green Park Chargers',
    address: 'Green Park, New Delhi',
    latitude: lat0 - 0.045,
    longitude: lng0 - 0.012,
    powerKw: 22,
    available: 0,
    total: 4,
    hours: 'Open 24/7',
    pricePerKwh: 14,
  },
  {
    id: 'demo-4',
    name: 'Lakeside Fast Point',
    address: 'Lodhi Road, New Delhi',
    latitude: lat0 - 0.03,
    longitude: lng0 + 0.05,
    powerKw: 120,
    available: 3,
    total: 8,
    hours: 'Open 24/7',
    pricePerKwh: 20,
  },
  {
    id: 'demo-5',
    name: 'City Mall Charging',
    address: 'Karol Bagh, New Delhi',
    latitude: lat0 + 0.02,
    longitude: lng0 - 0.05,
    powerKw: 30,
    available: 1,
    total: 2,
    hours: 'Closed',
    pricePerKwh: 17,
  },
];
