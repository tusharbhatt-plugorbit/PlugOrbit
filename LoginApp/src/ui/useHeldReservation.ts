import {heldReservation} from '../domain/reservation';
import type {Reservation} from '../domain/types';
import {useApp} from '../store/appStore';
import {useNow} from './useNow';

/** The reservation the user still holds (expired holds read as none). */
export function useHeldReservation(): Reservation | null {
  const reservation = useApp(s => s.reservation);
  const now = useNow(30_000);
  return heldReservation(reservation, now);
}
