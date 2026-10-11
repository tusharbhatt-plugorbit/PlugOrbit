import {useEffect, useState} from 'react';
import {AccessibilityInfo} from 'react-native';

/** True when the system asks apps to keep animation to a minimum. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => alive && setReduced(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}
