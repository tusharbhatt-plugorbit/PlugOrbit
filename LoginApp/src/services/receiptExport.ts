import {NativeModules, Platform} from 'react-native';
import type {SessionSummary} from '../domain/types';
import {invoiceFor} from '../domain/charging';
import {formatDateTime} from '../utils/format';
export async function exportReceipt(session: SessionSummary): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules.PlugOrbitDeviceTools?.saveReceipt) throw new Error('Receipt export is available in the updated Android app.');
  const invoice = invoiceFor(session.energyKwh, session.pricePerKwh);
  const lines = [`Receipt reference: ${session.receiptNo}`, `Session: ${session.id}`, `Station: ${session.stationName}`,
    `Date: ${formatDateTime(session.startedAt)}`, `Status in app: ${session.status}`, `Connector: ${session.connectorLabel} - ${session.powerKw} kW`,
    `Duration: ${session.durationMin} minutes`, `Battery: ${session.startSoc}% to ${session.endSoc}%`,
    `Energy: ${session.energyKwh.toFixed(2)} kWh`, `Rate: INR ${session.pricePerKwh.toFixed(2)}/kWh`,
    `Charging: INR ${invoice.baseInr.toFixed(2)}`, `GST calculation (18%): INR ${invoice.gstInr.toFixed(2)}`,
    `Recorded total: INR ${session.costInr.toFixed(2)}`, 'App-generated session summary; payment and meter records require operator verification.',
    'This is not an operator GST tax invoice. Obtain the official tax invoice from the charging operator.'];
  const uri = await NativeModules.PlugOrbitDeviceTools.saveReceipt(JSON.stringify({name: `PlugOrbit-${session.receiptNo}`, lines}));
  return typeof uri === 'string' && uri.length > 0;
}
