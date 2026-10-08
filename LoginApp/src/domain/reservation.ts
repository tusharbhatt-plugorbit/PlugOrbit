import type {Reservation} from './types';

/**
 * The reservation if its hold is still running, else null. A hold lasts until
 * the chosen slot plus the grace period; after that the operator releases the
 * bay, so the app must stop showing "Reserved" and stop blocking new bookings.
 */
export function heldReservation(
  reservation: Reservation | null,
  now: number,
): Reservation | null {
  if (!reservation || reservation.status !== 'held') {
    return null;
  }
  return now > reservation.arrivalAt + reservation.holdMinutes * 60_000
    ? null
    : reservation;
}
