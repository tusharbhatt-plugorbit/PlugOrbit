import type {
  Amenity,
  ConnectorStatus,
  ConnectorType,
  FeedInfo,
  Station,
  StationConnector,
} from '../../domain/types';
import type {VehicleModel} from '../types';
import type {Coords} from '../../utils/geo';

// ---------------------------------------------------------------- vehicles --

export const VEHICLE_CATALOG: VehicleModel[] = [
  {
    modelId: 'tata-nexon-lr',
    make: 'Tata',
    model: 'Nexon EV',
    variant: 'Long Range',
    batteryKwh: 40.5,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 60,
    maxAcKw: 7.2,
    rangeKm100: 300,
  },
  {
    modelId: 'tata-punch',
    make: 'Tata',
    model: 'Punch EV',
    variant: 'Long Range',
    batteryKwh: 35,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 50,
    maxAcKw: 7.2,
    rangeKm100: 280,
  },
  {
    modelId: 'tata-tiago',
    make: 'Tata',
    model: 'Tiago EV',
    variant: 'Long Range',
    batteryKwh: 24,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 25,
    maxAcKw: 7.2,
    rangeKm100: 220,
  },
  {
    modelId: 'mg-zs',
    make: 'MG',
    model: 'ZS EV',
    variant: 'Exclusive Plus',
    batteryKwh: 50.3,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 76,
    maxAcKw: 7.4,
    rangeKm100: 360,
  },
  {
    modelId: 'mg-comet',
    make: 'MG',
    model: 'Comet EV',
    variant: 'Plush',
    batteryKwh: 17.3,
    connectors: ['Type2'],
    maxDcKw: 0,
    maxAcKw: 3.3,
    rangeKm100: 160,
  },
  {
    modelId: 'mahindra-xuv400',
    make: 'Mahindra',
    model: 'XUV400',
    variant: 'EL Pro',
    batteryKwh: 39.4,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 50,
    maxAcKw: 7.2,
    rangeKm100: 300,
  },
  {
    modelId: 'mahindra-be6',
    make: 'Mahindra',
    model: 'BE 6',
    variant: 'Pack Three',
    batteryKwh: 79,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 175,
    maxAcKw: 11.2,
    rangeKm100: 480,
  },
  {
    modelId: 'byd-atto3',
    make: 'BYD',
    model: 'Atto 3',
    variant: 'Superior',
    batteryKwh: 60.5,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 88,
    maxAcKw: 7,
    rangeKm100: 380,
  },
  {
    modelId: 'hyundai-kona',
    make: 'Hyundai',
    model: 'Kona Electric',
    variant: 'Premium',
    batteryKwh: 39.2,
    connectors: ['CCS2', 'Type2'],
    maxDcKw: 50,
    maxAcKw: 7.2,
    rangeKm100: 290,
  },
  {
    modelId: 'nissan-leaf',
    make: 'Nissan',
    model: 'Leaf (import)',
    variant: '40 kWh',
    batteryKwh: 40,
    connectors: ['CHAdeMO', 'Type2'],
    maxDcKw: 50,
    maxAcKw: 6.6,
    rangeKm100: 250,
  },
];

// ------------------------------------------------------------------ places --

export type Place = {name: string; coords: Coords};

export const PLACES: Place[] = [
  {name: 'Delhi', coords: {latitude: 28.6139, longitude: 77.209}},
  {name: 'Gurgaon', coords: {latitude: 28.4595, longitude: 77.0266}},
  {name: 'Noida', coords: {latitude: 28.5355, longitude: 77.391}},
  {name: 'Manesar', coords: {latitude: 28.354, longitude: 76.936}},
  {name: 'Neemrana', coords: {latitude: 27.987, longitude: 76.383}},
  {name: 'Jaipur', coords: {latitude: 26.9124, longitude: 75.7873}},
  {name: 'Agra', coords: {latitude: 27.1767, longitude: 78.0081}},
  {name: 'Chandigarh', coords: {latitude: 30.7333, longitude: 76.7794}},
];

export function findPlace(name: string): Place | null {
  const n = name.trim().toLowerCase();
  return PLACES.find(p => p.name.toLowerCase() === n) ?? null;
}

/** The real NH48 corridor between Delhi and Jaipur, used for both directions. */
export const DELHI_JAIPUR_CORRIDOR: Coords[] = [
  {latitude: 28.6139, longitude: 77.209},
  {latitude: 28.542, longitude: 77.133},
  {latitude: 28.4595, longitude: 77.0266},
  {latitude: 28.354, longitude: 76.936},
  {latitude: 28.206, longitude: 76.794},
  {latitude: 28.083, longitude: 76.583},
  {latitude: 27.987, longitude: 76.383},
  {latitude: 27.889, longitude: 76.278},
  {latitude: 27.702, longitude: 76.199},
  {latitude: 27.387, longitude: 75.956},
  {latitude: 27.179, longitude: 75.87},
  {latitude: 26.9124, longitude: 75.7873},
];

// ---------------------------------------------------------------- stations --

type ConnSpec = [
  label: string,
  type: ConnectorType,
  kw: number,
  status: ConnectorStatus,
  price: number | null,
];

type StationSpec = {
  id: string;
  name: string;
  operator: string;
  address: string;
  at: [number, number];
  rating: number;
  success: number;
  reliability: number;
  sponsored?: boolean;
  hours: string;
  amenities: Amenity[];
  connectors: ConnSpec[];
  integration: 'integrated' | 'external';
  instructions?: string;
  /** [source, seconds ago] */
  status: [FeedInfo['source'], number | null];
  price: [FeedInfo['source'], number | null];
};

const SPECS: StationSpec[] = [
  {
    id: 'st-chargezone-sec16',
    name: 'ChargeZone • Sector 16',
    operator: 'ChargeZone',
    address: 'Sector 16, Noida',
    at: [28.589, 77.318],
    rating: 4.6,
    success: 94,
    reliability: 91,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom', 'parking'],
    integration: 'integrated',
    status: ['operator_feed', 25],
    price: ['operator_feed', 25],
    connectors: [
      ['C1', 'CCS2', 60, 'available', 18],
      ['C2', 'CCS2', 60, 'occupied', 18],
      ['C3', 'Type2', 22, 'available', 14],
    ],
  },
  {
    id: 'st-tata-cp',
    name: 'Tata Power • Connaught Place',
    operator: 'Tata Power',
    address: 'Inner Circle, Connaught Place',
    at: [28.633, 77.219],
    rating: 4.4,
    success: 90,
    reliability: 86,
    hours: 'Open 24/7',
    amenities: ['cafe', 'shopping', 'restroom'],
    integration: 'integrated',
    status: ['operator_feed', 40],
    price: ['operator_feed', 3600],
    connectors: [
      ['C1', 'CCS2', 30, 'occupied', 16],
      ['C2', 'CCS2', 30, 'available', 16],
      ['C3', 'Type2', 7, 'available', 12],
    ],
  },
  {
    id: 'st-statiq-rajiv',
    name: 'Statiq • Rajiv Chowk',
    operator: 'Statiq',
    address: 'Rajiv Chowk Metro, Delhi',
    at: [28.631, 77.2175],
    rating: 4.2,
    success: 88,
    reliability: 82,
    hours: 'Open 6 AM - 11 PM',
    amenities: ['restroom', 'wifi'],
    integration: 'integrated',
    status: ['operator_feed', 20 * 60],
    price: ['operator_feed', 20 * 60],
    connectors: [
      ['C1', 'CCS2', 50, 'occupied', 17],
      ['C2', 'CHAdeMO', 50, 'available', 17],
    ],
  },
  {
    id: 'st-eesl-greenpark',
    name: 'EESL • Green Park',
    operator: 'EESL',
    address: 'Green Park Market, New Delhi',
    at: [28.559, 77.206],
    rating: 3.9,
    success: 79,
    reliability: 74,
    hours: 'Open 24/7',
    amenities: ['parking'],
    integration: 'external',
    instructions:
      'Scan the EESL QR on the charger with the EESL Charge app, start the session there and pay on that app. PlugOrbit cannot start or bill this charger.',
    status: ['user_report', 18 * 60],
    price: ['user_report', 46 * 60],
    connectors: [
      ['C1', 'Type2', 22, 'available', 14],
      ['C2', 'CCS2', 30, 'unknown', 15],
    ],
  },
  {
    id: 'st-jiobp-lodhi',
    name: 'Jio-bp pulse • Lodhi Road',
    operator: 'Jio-bp pulse',
    address: 'Lodhi Road, New Delhi',
    at: [28.59, 77.227],
    rating: 4.7,
    success: 96,
    reliability: 93,
    sponsored: true,
    hours: 'Open 24/7',
    amenities: ['cafe', 'food', 'restroom', 'lounge', 'shade'],
    integration: 'external',
    instructions:
      'Open the Jio-bp pulse app, scan the QR on the dispenser and pay in that app. Keep your PlugOrbit receipt link for support.',
    status: ['google_places', 4 * 60],
    price: ['none', null],
    connectors: [
      ['C1', 'CCS2', 120, 'available', null],
      ['C2', 'CCS2', 120, 'occupied', null],
      ['C3', 'CCS2', 60, 'available', null],
    ],
  },
  {
    id: 'st-zeon-karolbagh',
    name: 'Zeon • Karol Bagh',
    operator: 'Zeon',
    address: 'Pusa Road, Karol Bagh',
    at: [28.651, 77.19],
    rating: 3.8,
    success: 76,
    reliability: 70,
    hours: 'Open 8 AM - 10 PM',
    amenities: ['shopping'],
    integration: 'external',
    instructions:
      'Use the Zeon app to scan the QR and pay. Walk-in UPI is accepted at the kiosk.',
    status: ['none', null],
    price: ['none', null],
    connectors: [
      ['C1', 'CCS2', 30, 'unknown', null],
      ['C2', 'CHAdeMO', 30, 'unknown', null],
    ],
  },
  {
    id: 'st-tata-gurgaon',
    name: 'Tata Power • Gurgaon',
    operator: 'Tata Power',
    address: 'Sector 29, Gurgaon',
    at: [28.469, 77.039],
    rating: 4.3,
    success: 91,
    reliability: 88,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom', 'shopping'],
    integration: 'integrated',
    status: ['operator_feed', 55],
    price: ['operator_feed', 55],
    connectors: [
      ['C1', 'CCS2', 50, 'available', 17.1],
      ['C2', 'CCS2', 50, 'available', 17.1],
      ['C3', 'Type2', 7, 'occupied', 12],
    ],
  },
  {
    id: 'st-tata-citymall',
    name: 'Tata Power • City Mall',
    operator: 'Tata Power',
    address: 'MG Road, Gurgaon',
    at: [28.4796, 77.0803],
    rating: 4.5,
    success: 90,
    reliability: 85,
    hours: 'Open 10 AM - 10 PM',
    amenities: ['cafe', 'shopping', 'restroom', 'parking'],
    integration: 'integrated',
    status: ['operator_feed', 12 * 60],
    price: ['operator_feed', 12 * 60],
    connectors: [
      ['C1', 'CCS2', 30, 'occupied', 16],
      ['C2', 'CCS2', 30, 'occupied', 16],
    ],
  },
  {
    id: 'st-chargezone-manesar',
    name: 'ChargeZone • Manesar',
    operator: 'ChargeZone',
    address: 'NH48, Manesar',
    at: [28.356, 76.939],
    rating: 4.4,
    success: 92,
    reliability: 89,
    hours: 'Open 24/7',
    amenities: ['restroom', 'food', 'parking'],
    integration: 'integrated',
    status: ['operator_feed', 33],
    price: ['operator_feed', 33],
    connectors: [
      ['C1', 'CCS2', 60, 'available', 18],
      ['C2', 'CCS2', 60, 'available', 18],
    ],
  },
  {
    id: 'st-statiq-bawal',
    name: 'Statiq • Highway Hub',
    operator: 'Statiq',
    address: 'NH48, Bawal',
    at: [28.095, 76.592],
    rating: 4.5,
    success: 93,
    reliability: 90,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom', 'food', 'shade'],
    integration: 'integrated',
    status: ['operator_feed', 38],
    price: ['operator_feed', 38],
    connectors: [
      ['C1', 'CCS2', 120, 'available', 21],
      ['C2', 'CCS2', 120, 'available', 21],
      ['C3', 'CCS2', 60, 'occupied', 18],
    ],
  },
  {
    id: 'st-chargezone-neemrana',
    name: 'ChargeZone • Neemrana',
    operator: 'ChargeZone',
    address: 'NH48, Neemrana',
    at: [27.989, 76.387],
    rating: 4.6,
    success: 92,
    reliability: 92,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom', 'food', 'parking', 'shade'],
    integration: 'integrated',
    status: ['operator_feed', 38],
    price: ['operator_feed', 38],
    connectors: [
      ['C1', 'CCS2', 60, 'occupied', 18],
      ['C2', 'CCS2', 60, 'available', 18],
      ['C3', 'CCS2', 60, 'available', 18],
      ['C4', 'CHAdeMO', 50, 'available', 18],
    ],
  },
  {
    id: 'st-glida-neemrana',
    name: 'Glida • Neemrana Hub',
    operator: 'Glida',
    address: 'Neemrana Industrial Area',
    at: [27.985, 76.38],
    rating: 4.0,
    success: 82,
    reliability: 76,
    hours: 'Open 24/7',
    amenities: ['restroom'],
    integration: 'external',
    instructions:
      'Scan the Glida QR on the pillar with any UPI app or the Glida app. Charging starts after payment on their page.',
    status: ['user_report', 9 * 60],
    price: ['user_report', 9 * 60],
    connectors: [
      ['C1', 'CCS2', 30, 'available', 15],
      ['C2', 'Type2', 7, 'available', 11],
    ],
  },
  {
    id: 'st-tata-behror',
    name: 'Tata Power • Behror',
    operator: 'Tata Power',
    address: 'NH48, Behror',
    at: [27.887, 76.279],
    rating: 4.1,
    success: 86,
    reliability: 80,
    hours: 'Open 24/7',
    amenities: ['restroom', 'food'],
    integration: 'integrated',
    status: ['operator_feed', 26 * 60],
    price: ['operator_feed', 26 * 60],
    connectors: [
      ['C1', 'CCS2', 50, 'available', 17.4],
      ['C2', 'CCS2', 50, 'offline', 17.4],
    ],
  },
  {
    id: 'st-statiq-kotputli',
    name: 'Statiq • Kotputli',
    operator: 'Statiq',
    address: 'NH48, Kotputli',
    at: [27.704, 76.201],
    rating: 4.3,
    success: 89,
    reliability: 85,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom'],
    integration: 'integrated',
    status: ['operator_feed', 47],
    price: ['operator_feed', 47],
    connectors: [
      ['C1', 'CCS2', 60, 'available', 17.8],
      ['C2', 'CCS2', 60, 'available', 17.8],
    ],
  },
  {
    id: 'st-chargezone-shahpura',
    name: 'ChargeZone • Shahpura',
    operator: 'ChargeZone',
    address: 'NH48, Shahpura',
    at: [27.389, 75.957],
    rating: 4.4,
    success: 91,
    reliability: 88,
    hours: 'Open 24/7',
    amenities: ['restroom', 'food', 'parking'],
    integration: 'integrated',
    status: ['operator_feed', 29],
    price: ['operator_feed', 29],
    connectors: [
      ['C1', 'CCS2', 60, 'occupied', 18],
      ['C2', 'CCS2', 60, 'available', 18],
    ],
  },
  {
    id: 'st-statiq-jaipur',
    name: 'Statiq • Jaipur Bypass',
    operator: 'Statiq',
    address: 'Delhi Bypass, Jaipur',
    at: [26.971, 75.819],
    rating: 4.5,
    success: 94,
    reliability: 91,
    hours: 'Open 24/7',
    amenities: ['cafe', 'restroom', 'food', 'wifi'],
    integration: 'integrated',
    status: ['operator_feed', 31],
    price: ['operator_feed', 31],
    connectors: [
      ['C1', 'CCS2', 60, 'available', 17.3],
      ['C2', 'CCS2', 60, 'available', 17.3],
      ['C3', 'Type2', 22, 'available', 13],
    ],
  },
  {
    id: 'st-jiobp-jaipur',
    name: 'Jio-bp pulse • Malviya Nagar',
    operator: 'Jio-bp pulse',
    address: 'Malviya Nagar, Jaipur',
    at: [26.855, 75.81],
    rating: 4.6,
    success: 95,
    reliability: 92,
    hours: 'Open 24/7',
    amenities: ['cafe', 'food', 'restroom', 'lounge'],
    integration: 'external',
    instructions: 'Scan the QR with the Jio-bp pulse app and pay there.',
    status: ['google_places', 6 * 60],
    price: ['none', null],
    connectors: [
      ['C1', 'CCS2', 120, 'available', null],
      ['C2', 'CCS2', 120, 'available', null],
    ],
  },
  {
    id: 'st-tata-jaipur-airport',
    name: 'Tata Power • Jaipur Airport',
    operator: 'Tata Power',
    address: 'Airport Road, Jaipur',
    at: [26.824, 75.803],
    rating: 4.2,
    success: 88,
    reliability: 84,
    hours: 'Open 24/7',
    amenities: ['parking', 'restroom', 'cafe'],
    integration: 'integrated',
    status: ['operator_feed', 48],
    price: ['operator_feed', 48],
    connectors: [
      ['C1', 'CCS2', 50, 'occupied', 17.2],
      ['C2', 'CCS2', 50, 'occupied', 17.2],
    ],
  },
];

function feed(
  spec: [FeedInfo['source'], number | null],
  now: number,
): FeedInfo {
  const [source, secondsAgo] = spec;
  return {
    source,
    updatedAt: secondsAgo === null ? null : now - secondsAgo * 1000,
  };
}

/** Build the station table. Feed timestamps are relative to `now`. */
export function buildStations(now: number): Station[] {
  return SPECS.map(s => {
    const connectors: StationConnector[] = s.connectors.map(
      ([label, type, powerKw, status, pricePerKwh], i) => ({
        id: `${s.id}-c${i + 1}`,
        label,
        type,
        powerKw,
        status,
        pricePerKwh,
        idleFeePerMin: pricePerKwh === null ? null : 2,
      }),
    );
    return {
      id: s.id,
      name: s.name,
      operator: s.operator,
      address: s.address,
      latitude: s.at[0],
      longitude: s.at[1],
      rating: s.rating,
      successfulSessionsPct: s.success,
      reliabilityPct: s.reliability,
      sponsored: s.sponsored ?? false,
      hours: s.hours,
      amenities: s.amenities,
      connectors,
      integration: s.integration,
      operatorInstructions: s.instructions ?? null,
      statusFeed: feed(s.status, now),
      priceFeed: feed(s.price, now),
    };
  });
}
