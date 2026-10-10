import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Keyboard,
  KeyboardEvent,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import {
  KeyboardFrame,
  keyboardOverlap,
  scrollDeltaToReveal,
} from './keyboardMath';

/**
 * Keyboard handling for forms, in two parts that share one idea: measure where
 * the keyboard really is instead of assuming what the window did.
 *
 *  - `KeyboardAvoider` pads its own bottom by exactly the part of it the keyboard
 *    covers. If the OS already resized the window (adjustResize) the overlap is 0,
 *    so nothing is compensated twice; if it did not (edge-to-edge, or iOS) the
 *    padding lifts the content, including a pinned footer, above the keyboard.
 *  - `KeyboardAwareScrollView` scrolls the focused field into view, on the first
 *    focus and when moving from one field to the next with the keyboard open.
 *
 * `KeyboardAvoidingView` was used here before. Its `height` mode on Android
 * assumes the window does not resize, and adds `frame.y` (relative to its parent)
 * to `keyboardVerticalOffset` (relative to the screen), which double counts any
 * header above it.
 */

// Read at call time so tests can switch platform.
const showEvent = () =>
  Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
const hideEvent = () =>
  Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

type ViewInstance = React.ComponentRef<typeof View>;
type ScrollInstance = React.ComponentRef<typeof ScrollView>;

function frameOf(
  c: {height: number; screenY: number} | undefined | null,
): KeyboardFrame | null {
  return c && c.height > 0 ? {top: c.screenY, height: c.height} : null;
}

/** Where the keyboard is right now, for a component that mounts while it is open. */
function currentFrame(): KeyboardFrame | null {
  return frameOf(Keyboard.metrics?.());
}

/* ------------------------------------------------------------ focus routing -- */

// Which scroll view the focused field belongs to, and how much of what follows it
// (a button under a code field) should come into view with it. A field reports
// this when it gains focus; focus always arrives just before the keyboard events,
// so the scroll view that reacts to the keyboard already knows whose field it is.
// `null` means "unknown": every scroll view then judges by position alone.
let focusOwner: string | null = null;
let focusExtraBelow = 0;
const focusListeners = new Set<() => void>();

const OwnerContext = createContext<string | null>(null);

/** The id of the enclosing KeyboardAwareScrollView, to pass to notifyInputFocused. */
export function useScrollOwner(): string | null {
  return useContext(OwnerContext);
}

/**
 * Call from an input's onFocus. With the keyboard already open, moving to another
 * field fires no keyboard event, so this is what brings the new field into view.
 */
export function notifyInputFocused(
  owner: string | null = null,
  extraBelow = 0,
): void {
  focusOwner = owner;
  focusExtraBelow = extraBelow;
  focusListeners.forEach(l => l());
}

/* --------------------------------------------------------------- measuring -- */

type Measured = {top: number; height: number};

function measureOnScreen(
  node: {measure?: (cb: (...n: number[]) => void) => void} | null | undefined,
): Promise<Measured | null> {
  return new Promise(resolve => {
    if (!node || typeof node.measure !== 'function') {
      resolve(null);
      return;
    }
    try {
      node.measure((_x, _y, _w, h, _px, py) => {
        resolve(
          Number.isFinite(py) && Number.isFinite(h)
            ? {top: py, height: h}
            : null,
        );
      });
    } catch {
      resolve(null);
    }
  });
}

/* ---------------------------------------------------------------- avoider -- */

type AvoiderProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Wrap a whole screen (content + pinned footer). Fills its parent. */
export function KeyboardAvoider({children, style, testID}: AvoiderProps) {
  const ref = useRef<ViewInstance>(null);
  const frame = useRef<KeyboardFrame | null>(currentFrame());
  const alive = useRef(true);
  const [overlap, setOverlap] = useState(0);

  const recompute = useCallback(async () => {
    const kb = frame.current;
    if (!kb) {
      setOverlap(0);
      return;
    }
    const m = await measureOnScreen(ref.current as never);
    if (alive.current && frame.current === kb && m) {
      setOverlap(keyboardOverlap(m, kb));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const animate = (e: KeyboardEvent) => {
      if (Platform.OS !== 'ios') {
        return;
      }
      const duration = e.duration && e.duration > 10 ? e.duration : 250;
      LayoutAnimation.configureNext({
        duration,
        update: {duration, type: 'keyboard'},
      });
    };
    const show = Keyboard.addListener(showEvent(), (e: KeyboardEvent) => {
      frame.current = frameOf(e.endCoordinates);
      animate(e);
      recompute();
    });
    const hide = Keyboard.addListener(hideEvent(), (e: KeyboardEvent) => {
      frame.current = null;
      animate(e);
      setOverlap(0);
    });
    if (frame.current) {
      recompute();
    }
    return () => {
      alive.current = false;
      show.remove();
      hide.remove();
    };
  }, [recompute]);

  return (
    <View
      ref={ref}
      collapsable={false}
      testID={testID}
      // The outer frame does not change when the padding does, so this cannot
      // loop; it re-measures when the OS resizes the window after the event.
      onLayout={() => frame.current && recompute()}
      style={[styles.fill, style, {paddingBottom: overlap}]}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------ scroll view -- */

/** A ScrollView that keeps the focused field visible above the keyboard. */
export const KeyboardAwareScrollView = forwardRef<
  ScrollInstance,
  ScrollViewProps
>(function KeyboardAwareScrollViewInner({onScroll, ...rest}, forwarded) {
  const id = useId();
  const scroll = useRef<ScrollInstance>(null);
  const offset = useRef(0);
  const keyboard = useRef<KeyboardFrame | null>(currentFrame());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useImperativeHandle(forwarded, () => scroll.current as ScrollInstance);

  const reveal = useCallback(async () => {
    const kb = keyboard.current;
    const state = TextInput.State as unknown as {
      currentlyFocusedInput?: () => {measure?: never} | null;
    };
    const input = kb ? state.currentlyFocusedInput?.() : null;
    // Another scroll view's field (a sheet over this screen) is not ours.
    if (!kb || !input || (focusOwner !== null && focusOwner !== id)) {
      return;
    }
    const [field, view] = await Promise.all([
      measureOnScreen(input as never),
      measureOnScreen(scroll.current as never),
    ]);
    if (!field || !view || keyboard.current !== kb) {
      return;
    }
    // With no owner to go on, only react to a field that is at least where
    // this scroll view is (or just below it, under the keyboard).
    const placed =
      field.top >= view.top - 1 &&
      field.top <= view.top + view.height + kb.height;
    if (!placed) {
      return;
    }
    const delta = scrollDeltaToReveal(
      {
        top: field.top,
        bottom: field.top + field.height + focusExtraBelow,
      },
      {top: view.top, bottom: Math.min(view.top + view.height, kb.top)},
    );
    if (delta !== 0) {
      scroll.current?.scrollTo({
        y: Math.max(0, offset.current + delta),
        animated: true,
      });
    }
  }, [id]);

  // Layout settles over a moment after the keyboard moves (padding applied,
  // window resized), so look twice; the second look is a no-op when the first worked.
  const schedule = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [setTimeout(reveal, 60), setTimeout(reveal, 320)];
  }, [reveal]);

  useEffect(() => {
    const show = Keyboard.addListener(showEvent(), (e: KeyboardEvent) => {
      keyboard.current = frameOf(e.endCoordinates);
      schedule();
    });
    const hide = Keyboard.addListener(hideEvent(), () => {
      keyboard.current = null;
      focusOwner = null;
      focusExtraBelow = 0;
    });
    focusListeners.add(schedule);
    const pending = timers.current;
    return () => {
      show.remove();
      hide.remove();
      focusListeners.delete(schedule);
      pending.forEach(clearTimeout);
    };
  }, [schedule]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  return (
    <OwnerContext.Provider value={id}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        {...rest}
        ref={scroll}
        onScroll={handleScroll}
      />
    </OwnerContext.Provider>
  );
});

const styles = StyleSheet.create({fill: {flex: 1}});
