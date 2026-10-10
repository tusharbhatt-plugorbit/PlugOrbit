/**
 * Pure keyboard-layout maths, kept apart from React so it can be unit tested
 * without a device. Every number is in the same coordinate space: the screen
 * (what `measure()` reports as pageY, and what `Keyboard` reports as screenY).
 */

export type KeyboardFrame = {
  /** Screen Y of the keyboard's top edge. */
  top: number;
  height: number;
};

export type Box = {top: number; bottom: number};

/**
 * How far the keyboard covers the bottom of `view`. 0 when the window has
 * already been resized above the keyboard (adjustResize), so a view that is
 * already clear is never padded a second time. That double compensation is what
 * `KeyboardAvoidingView behavior="height"` can cause on Android.
 */
export function keyboardOverlap(
  view: {top: number; height: number},
  keyboard: KeyboardFrame | null,
): number {
  if (!keyboard || keyboard.height <= 0) {
    return 0;
  }
  const covered = view.top + view.height - keyboard.top;
  // A keyboard cannot cover more of a view than its own height.
  return Math.round(Math.min(Math.max(covered, 0), keyboard.height));
}

/**
 * How far to scroll so `input` is fully inside `visible`, with `margin` of air.
 * Positive scrolls down (content moves up). When the input is taller than the
 * visible area its top wins, so the start of what is being typed stays in view.
 */
export function scrollDeltaToReveal(
  input: Box,
  visible: Box,
  margin = 16,
): number {
  const room = visible.bottom - visible.top - margin * 2;
  if (input.bottom - input.top > room) {
    return Math.round(input.top - margin - visible.top);
  }
  if (input.bottom + margin > visible.bottom) {
    return Math.round(input.bottom + margin - visible.bottom);
  }
  if (input.top - margin < visible.top) {
    return Math.round(input.top - margin - visible.top);
  }
  return 0;
}
