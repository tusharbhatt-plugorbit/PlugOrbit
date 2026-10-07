export type Filter = 'All' | 'Fast' | 'Available' | 'Near me';

export type Charger = {
  id: string;
  name: string;
  distanceKm: number;
  hours: string;
  powerKw: number;
  available: number;
  total: number;
  pricePerKwh: number;
  // Pin position on the map, as a percentage of the map area.
  x: number;
  y: number;
};

export const FILTERS: readonly Filter[] = [
  'All',
  'Fast',
  'Available',
  'Near me',
];

export const FAST_KW = 50;
export const NEAR_KM = 3;

// Placeholder data until the charger API is wired up.
export const CHARGERS: readonly Charger[] = [
  {
    id: '1',
    name: 'PlugOrbit Charge Hub',
    distanceKm: 2.4,
    hours: 'Open 24/7',
    powerKw: 250,
    available: 4,
    total: 6,
    pricePerKwh: 18,
    x: 22,
    y: 28,
  },
  {
    id: '2',
    name: 'Orbit Metro Station',
    distanceKm: 1.1,
    hours: 'Open 6am-11pm',
    powerKw: 60,
    available: 2,
    total: 4,
    pricePerKwh: 16,
    x: 47,
    y: 46,
  },
  {
    id: '3',
    name: 'Green Park Chargers',
    distanceKm: 4.8,
    hours: 'Open 24/7',
    powerKw: 22,
    available: 0,
    total: 4,
    pricePerKwh: 14,
    x: 12,
    y: 70,
  },
  {
    id: '4',
    name: 'Lakeside Fast Point',
    distanceKm: 5.6,
    hours: 'Open 24/7',
    powerKw: 120,
    available: 3,
    total: 8,
    pricePerKwh: 20,
    x: 80,
    y: 62,
  },
  {
    id: '5',
    name: 'City Mall Charging',
    distanceKm: 3.7,
    hours: 'Open 10am-10pm',
    powerKw: 30,
    available: 1,
    total: 2,
    pricePerKwh: 17,
    x: 78,
    y: 20,
  },
];

export function matchesFilter(charger: Charger, filter: Filter): boolean {
  switch (filter) {
    case 'Fast':
      return charger.powerKw >= FAST_KW;
    case 'Available':
      return charger.available > 0;
    case 'Near me':
      return charger.distanceKm <= NEAR_KM;
    default:
      return true;
  }
}
