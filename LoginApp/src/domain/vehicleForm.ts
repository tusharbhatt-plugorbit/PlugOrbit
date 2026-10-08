import type {ConnectorType, Vehicle} from './types';

/** A vehicle before the service assigns it an id. */
export type VehicleSpec = Omit<Vehicle, 'id'>;

/** Connectors a driver can pick for a car that isn't in the catalogue. */
export const CUSTOM_CONNECTORS: ReadonlyArray<{
  value: ConnectorType;
  label: string;
}> = [
  {value: 'CCS2', label: 'CCS2'},
  {value: 'Type2', label: 'Type 2'},
  {value: 'CHAdeMO', label: 'CHAdeMO'},
  {value: 'GBT', label: 'GB/T'},
];

const DC_TYPES: readonly ConnectorType[] = ['CCS2', 'CHAdeMO', 'GBT', 'LECCS'];

/** What we assume when the driver leaves a charge limit blank. */
export const DEFAULT_DC_KW = 50;
export const DEFAULT_AC_KW = 7.2;
/** Real-world km per kWh used to estimate range when the driver doesn't know it. */
export const DEFAULT_KM_PER_KWH = 7;

export const BATTERY_LIMITS = {min: 10, max: 200} as const;

export type VehicleFormInput = {
  make: string;
  model: string;
  variant: string;
  batteryKwh: string;
  connectors: readonly ConnectorType[];
  maxDcKw: string;
  maxAcKw: string;
  rangeKm: string;
};

export type VehicleFormField = keyof VehicleFormInput;
export type VehicleFormErrors = Partial<Record<VehicleFormField, string>>;

export const EMPTY_VEHICLE_FORM: VehicleFormInput = {
  make: '',
  model: '',
  variant: '',
  batteryKwh: '',
  connectors: [],
  maxDcKw: '',
  maxAcKw: '',
  rangeKm: '',
};

/** "40.5" and "40,5" both parse; anything else is null. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) {
    return null;
  }
  return Number(t);
}

export function hasDcConnector(connectors: readonly ConnectorType[]): boolean {
  return connectors.some(c => DC_TYPES.includes(c));
}

/** Rough real-world range at 100% for a pack size, to the nearest 5 km. */
export function estimateRangeKm100(batteryKwh: number): number {
  return Math.round((batteryKwh * DEFAULT_KM_PER_KWH) / 5) * 5;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function validateVehicleForm(
  input: VehicleFormInput,
): {ok: true; vehicle: VehicleSpec} | {ok: false; errors: VehicleFormErrors} {
  const errors: VehicleFormErrors = {};
  const make = input.make.trim();
  const model = input.model.trim();
  const variant = input.variant.trim();

  if (make.length < 2) {
    errors.make = 'Enter the make, for example Tata.';
  } else if (make.length > 30) {
    errors.make = 'Keep the make under 30 characters.';
  }
  if (model.length < 1) {
    errors.model = 'Enter the model, for example Nexon EV.';
  } else if (model.length > 40) {
    errors.model = 'Keep the model under 40 characters.';
  }
  if (variant.length > 30) {
    errors.variant = 'Keep the variant under 30 characters.';
  }

  const battery = parseDecimal(input.batteryKwh);
  if (
    battery === null ||
    battery < BATTERY_LIMITS.min ||
    battery > BATTERY_LIMITS.max
  ) {
    errors.batteryKwh = `Enter the battery size in kWh, between ${BATTERY_LIMITS.min} and ${BATTERY_LIMITS.max}.`;
  }

  if (input.connectors.length === 0) {
    errors.connectors = 'Pick at least one connector your car can use.';
  }

  const dcCapable = hasDcConnector(input.connectors);
  const acCapable = input.connectors.includes('Type2');

  let maxDcKw = 0;
  if (dcCapable) {
    if (input.maxDcKw.trim() === '') {
      maxDcKw = DEFAULT_DC_KW;
    } else {
      const dc = parseDecimal(input.maxDcKw);
      if (dc === null || dc < 5 || dc > 350) {
        errors.maxDcKw = 'Enter a fast-charge limit between 5 and 350 kW.';
      } else {
        maxDcKw = dc;
      }
    }
  }

  let maxAcKw = 0;
  if (acCapable) {
    if (input.maxAcKw.trim() === '') {
      maxAcKw = DEFAULT_AC_KW;
    } else {
      const ac = parseDecimal(input.maxAcKw);
      if (ac === null || ac < 1 || ac > 43) {
        errors.maxAcKw = 'Enter an AC limit between 1 and 43 kW.';
      } else {
        maxAcKw = ac;
      }
    }
  }

  let rangeKm100 = battery === null ? 0 : estimateRangeKm100(battery);
  if (input.rangeKm.trim() !== '') {
    const range = parseDecimal(input.rangeKm);
    if (range === null || range < 50 || range > 1000) {
      errors.rangeKm = 'Enter a real-world range between 50 and 1000 km.';
    } else {
      rangeKm100 = Math.round(range);
    }
  }

  if (Object.keys(errors).length > 0 || battery === null) {
    return {ok: false, errors};
  }
  return {
    ok: true,
    vehicle: {
      make,
      model,
      variant: variant || 'Custom',
      batteryKwh: round1(battery),
      connectors: [...input.connectors],
      maxDcKw,
      maxAcKw,
      rangeKm100,
    },
  };
}

/** Pre-fill the custom form from a saved vehicle (editing). */
export function vehicleToForm(v: Vehicle): VehicleFormInput {
  return {
    make: v.make,
    model: v.model,
    variant: v.variant === 'Custom' ? '' : v.variant,
    batteryKwh: String(v.batteryKwh),
    connectors: [...v.connectors],
    maxDcKw: v.maxDcKw > 0 ? String(v.maxDcKw) : '',
    maxAcKw: v.maxAcKw > 0 ? String(v.maxAcKw) : '',
    rangeKm: String(v.rangeKm100),
  };
}

/** True when a catalogue entry and a saved vehicle are the same car. */
export function sameCar(
  a: Pick<Vehicle, 'make' | 'model' | 'variant'>,
  b: Pick<Vehicle, 'make' | 'model' | 'variant'>,
): boolean {
  return (
    a.make === b.make && a.model === b.model && a.variant === b.variant
  );
}
