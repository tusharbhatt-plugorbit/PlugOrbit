import {energyToCharge, invoiceFor} from './charging';
import type {Station, StationConnector, Vehicle} from './types';

/**
 * TOTAL COST of a stop, so nobody has to do the arithmetic.
 *
 * Only figures a feed actually carries are priced:
 *  - energy and GST come from the connector's published ₹/kWh;
 *  - parking is NOT in any feed we have, so it is "unknown", never ₹0 and never
 *    invented;
 *  - idle fees are ₹0 only because the plan assumes the driver unplugs when the
 *    target is reached (the per-minute idle rate is carried for the warning);
 *  - PlugOrbit adds no platform fee.
 * A connector with no published price gives no total at all.
 */

/** PlugOrbit charges no platform fee. Product decision: change here if that does. */
export const PLATFORM_FEE_INR = 0;

export type StopCostBreakdown = {
  energyKwh: number;
  pricePerKwh: number | null;
  energyInr: number | null;
  taxesInr: number | null;
  /** Null = not published (unknown), not free. */
  parkingInr: number | null;
  /** The station lists parking, so its tariff is a fair thing to mention. */
  hasParking: boolean;
  idleInr: number;
  idleFeePerMin: number | null;
  platformFeeInr: number;
  /** Whole rupees, or null when the energy can't be priced. */
  totalInr: number | null;
};

export function stopCostBreakdown(input: {
  station: Pick<Station, 'amenities'>;
  connector: Pick<StationConnector, 'pricePerKwh' | 'idleFeePerMin'>;
  vehicle: Pick<Vehicle, 'batteryKwh'>;
  fromSoc: number;
  toSoc: number;
}): StopCostBreakdown {
  const {station, connector, vehicle, fromSoc, toSoc} = input;
  const energyKwh = energyToCharge(fromSoc, toSoc, vehicle.batteryKwh);
  const price = connector.pricePerKwh;
  const invoice = price === null ? null : invoiceFor(energyKwh, price);
  return {
    energyKwh,
    pricePerKwh: price,
    energyInr: invoice ? invoice.baseInr : null,
    taxesInr: invoice ? invoice.gstInr : null,
    parkingInr: null,
    hasParking: station.amenities.includes('parking'),
    idleInr: 0,
    idleFeePerMin: connector.idleFeePerMin,
    platformFeeInr: PLATFORM_FEE_INR,
    totalInr: invoice ? Math.round(invoice.totalInr + PLATFORM_FEE_INR) : null,
  };
}

export type CostLine = {label: string; value: string; muted?: boolean};

/**
 * The lines a driver reads, in order. Unknowns say so in words.
 * `format` turns rupees into text (the UI passes its Indian-grouping formatter).
 */
export function costLines(
  c: StopCostBreakdown,
  format: (inr: number) => string,
): CostLine[] {
  if (c.totalInr === null || c.energyInr === null || c.taxesInr === null) {
    return [{label: 'Price', value: 'Not published', muted: true}];
  }
  const lines: CostLine[] = [
    {label: 'Energy', value: format(c.energyInr)},
    {label: 'Taxes (GST)', value: format(c.taxesInr)},
  ];
  if (c.hasParking) {
    lines.push({label: 'Parking', value: 'Not published', muted: true});
  }
  lines.push(
    {label: 'Expected idle fee', value: format(c.idleInr)},
    {label: 'PlugOrbit fee', value: format(c.platformFeeInr)},
  );
  return lines;
}
