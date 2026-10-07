import {formatInr} from '../utils/format';

export const PRICE_NOT_PUBLISHED = 'Price not published';

/** "₹444", or "Price not published" when the stop's connector has no price. */
export function stopCostLabel(costInr: number | null): string {
  return costInr === null ? PRICE_NOT_PUBLISHED : formatInr(costInr);
}

export type TripCost = {
  /** Sum of the stops that have a published price. */
  knownInr: number;
  unpricedStops: number;
  /** Honest one-liner: never presents a partial sum as the whole bill. */
  label: string;
};

export function tripCost(
  stops: ReadonlyArray<{costInr: number | null}>,
): TripCost {
  let knownInr = 0;
  let pricedStops = 0;
  let unpricedStops = 0;
  stops.forEach(s => {
    if (s.costInr === null) {
      unpricedStops += 1;
    } else {
      knownInr += s.costInr;
      pricedStops += 1;
    }
  });
  let label = formatInr(knownInr);
  if (unpricedStops > 0) {
    label =
      pricedStops === 0
        ? PRICE_NOT_PUBLISHED
        : `${label} plus ${unpricedStops} unpriced ${
            unpricedStops === 1 ? 'stop' : 'stops'
          }`;
  }
  return {knownInr, unpricedStops, label};
}
