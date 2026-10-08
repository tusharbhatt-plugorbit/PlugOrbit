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
