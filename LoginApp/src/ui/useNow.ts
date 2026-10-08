import {useEffect, useState} from 'react';
import {useIsFocused} from '../navigation/NavigationContext';

/**
 * Current time that ticks while the screen is visible, so "38 sec ago" labels
 * age honestly. Hidden screens stop ticking.
 */
export function useNow(intervalMs = 15000): number {
  const focused = useIsFocused();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!focused) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [focused, intervalMs]);
  return now;
}

/**
 * "Now" as a trip sees it. A simulated drive runs ahead of the wall clock, and
 * everything on a trip (feed ages, arrival times, ETAs) is stamped in trip time,
 * so labels like "38 sec ago" and "arrive in 5 min" must be read against it.
 */
export function useTripNow(
  clockOffsetMs: number | undefined,
  intervalMs = 15000,
): number {
  return useNow(intervalMs) + (clockOffsetMs ?? 0);
}
