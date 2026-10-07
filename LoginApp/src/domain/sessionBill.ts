import {computeSessionMetrics, invoiceFor, Invoice} from './charging';
import type {ChargingSession, SessionMetrics} from './types';

export type SessionBill = {
  metrics: SessionMetrics;
  invoice: Invoice;
};

/**
 * What a stopped (or running) session costs, from the same maths the live
 * screen uses, so the figure on Payment always matches what was on screen.
 */
export function billFor(session: ChargingSession, now: number): SessionBill {
  const at = session.stoppedAt ?? now;
  const metrics = computeSessionMetrics(session, at);
  return {metrics, invoice: invoiceFor(metrics.energyKwh, session.pricePerKwh)};
}
