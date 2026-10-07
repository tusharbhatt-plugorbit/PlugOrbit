// PlugOrbit Plus plan facts in one place, so the screen and tests agree.
// TODO(integration): price and billing come from the billing backend.

export const PLUS_PRICE_INR = 49;
export const PLUS_PERIOD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next weekly renewal after `now` for a plan started at `since`. Renewals
 * land every PLUS_PERIOD_DAYS from the start date.
 */
export function nextRenewalAt(since: number, now: number): number {
  const period = PLUS_PERIOD_DAYS * DAY_MS;
  if (now < since) {
    return since + period;
  }
  const elapsedPeriods = Math.floor((now - since) / period);
  return since + (elapsedPeriods + 1) * period;
}
