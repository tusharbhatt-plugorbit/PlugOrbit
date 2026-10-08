import type {CoDriverEvent} from '../domain/coDriver';

/**
 * A tiny bus for "say this to the driver right now". Services decide WHAT is
 * worth a toast (see `deliveryFor`); the UI host decides HOW it looks. Keeping
 * the two apart lets services run with no UI mounted (and in tests).
 */
type Listener = (event: CoDriverEvent) => void;

const listeners = new Set<Listener>();

export function onTripToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitTripToast(event: CoDriverEvent): void {
  listeners.forEach(l => l(event));
}
