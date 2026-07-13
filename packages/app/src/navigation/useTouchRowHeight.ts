import { useRoutedLayoutActive } from "./useRoutedLayoutActive";

/**
 * The touch-target floor (Apple HIG) applied to virtualized row pitch when the
 * routed (mobile / tablet / iPad) layout is active.
 */
export const TOUCH_ROW_HEIGHT = 44;

/**
 * Raises a virtualized list/table's row height to the 44px touch target while
 * the routed layout is active, and returns the dense desktop height otherwise.
 *
 * The returned value drives BOTH the virtualization window math and the rendered
 * row height (the standard virtual frames set their CSS row height from this
 * number), so the two can never desync and produce overlapping or gapped rows.
 */
export function useTouchRowHeight(baseHeight: number): number {
  const routed = useRoutedLayoutActive();
  return routed ? Math.max(baseHeight, TOUCH_ROW_HEIGHT) : baseHeight;
}
