import type {ChargingSession, SessionMetrics} from './types';

/**
 * Demo clock: one real minute is this many simulated minutes of charging, so a
 * showcase can walk through 42% -> 80% in about a minute. Set to 1 for real time.
 */
export const DEMO_TIME_SCALE = 20;

export const GST_RATE = 0.18;

/** Charge power as a share of the connector/vehicle limit at a given SoC. */
export function taper(socPercent: number): number {
  if (socPercent < 80) {
    return 1;
  }
  // Linear taper from 100% at 80% SoC down to 20% at 100%.
  return Math.max(0.2, 1 - ((socPercent - 80) / 20) * 0.8);
}

type Sim = {socPercent: number; energyKwh: number; minutes: number};

/** Advance the simulation `minutes` (simulated) in 0.25 min steps. */
function simulate(
  startSoc: number,
  powerKw: number,
  batteryKwh: number,
  stopSoc: number,
  maxMinutes: number,
): Sim {
  const step = 0.25;
  let soc = startSoc;
  let energy = 0;
  let t = 0;
  while (t < maxMinutes && soc < stopSoc) {
    const kw = powerKw * taper(soc);
    const dE = (kw * step) / 60;
    soc = Math.min(stopSoc, soc + (dE / batteryKwh) * 100);
    energy += dE;
    t += step;
  }
  return {socPercent: soc, energyKwh: energy, minutes: t};
}

/** Simulated minutes of charging that have elapsed at `now`. */
export function elapsedSimMinutes(
  session: ChargingSession,
  now: number,
): number {
  const end = session.stoppedAt ?? now;
  return Math.max(0, ((end - session.startedAt) / 60000) * DEMO_TIME_SCALE);
}

/**
 * Metrics are a pure function of (session, now), so they survive an app
 * restart: reopening the app just recomputes from `startedAt`.
 */
export function computeSessionMetrics(
  session: ChargingSession,
  now: number,
): SessionMetrics {
  const elapsed = elapsedSimMinutes(session, now);
  const run = simulate(
    session.startSoc,
    session.powerKw,
    session.batteryKwh,
    session.targetSoc,
    elapsed,
  );
  const reachedTarget = run.socPercent >= session.targetSoc - 1e-6;
  const remaining = reachedTarget
    ? 0
    : simulate(
        run.socPercent,
        session.powerKw,
        session.batteryKwh,
        session.targetSoc,
        600,
      ).minutes;
  return {
    socPercent: run.socPercent,
    energyKwh: run.energyKwh,
    elapsedMin: Math.min(elapsed, run.minutes + (reachedTarget ? 0 : 0.0001)),
    costInr: run.energyKwh * session.pricePerKwh,
    minToTarget: Math.ceil(remaining),
    reachedTarget,
  };
}

export type Invoice = {
  energyKwh: number;
  pricePerKwh: number;
  baseInr: number;
  gstInr: number;
  totalInr: number;
};

export function invoiceFor(energyKwh: number, pricePerKwh: number): Invoice {
  // Bill on the energy as printed (2 dp), so "kWh × rate" always equals the
  // line total and re-deriving an invoice from a stored session is idempotent.
  const billedKwh = round2(energyKwh);
  const baseInr = round2(billedKwh * pricePerKwh);
  const gstInr = round2(baseInr * GST_RATE);
  return {
    energyKwh: billedKwh,
    pricePerKwh,
    baseInr,
    gstInr,
    totalInr: round2(baseInr + gstInr),
  };
}

/** Upper bound pre-authorised before a remote start (to the target SoC + GST). */
export function estimatePreauthInr(
  startSoc: number,
  targetSoc: number,
  batteryKwh: number,
  pricePerKwh: number,
): number {
  const kwh = (Math.max(targetSoc - startSoc, 0) / 100) * batteryKwh;
  const total = kwh * pricePerKwh * (1 + GST_RATE);
  // Round up to the next ₹50 and add a small buffer, as card networks expect.
  return Math.ceil((total * 1.1) / 50) * 50;
}

/** Minutes to charge from one SoC to another at a given power (simulated). */
export function minutesToCharge(
  fromSoc: number,
  toSoc: number,
  powerKw: number,
  batteryKwh: number,
): number {
  if (toSoc <= fromSoc) {
    return 0;
  }
  return Math.ceil(simulate(fromSoc, powerKw, batteryKwh, toSoc, 600).minutes);
}

export function energyToCharge(
  fromSoc: number,
  toSoc: number,
  batteryKwh: number,
): number {
  return (Math.max(toSoc - fromSoc, 0) / 100) * batteryKwh;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
