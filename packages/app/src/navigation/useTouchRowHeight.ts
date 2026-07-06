import { useTearleadsExternalValue } from "../providers/sdk/useTearleadsSubscription";

/**
 * The touch-target floor (Apple HIG) applied to virtualized row pitch when the
 * routed (mobile / tablet / iPad) layout is active.
 */
export const TOUCH_ROW_HEIGHT = 44;

/**
 * Subscribes to changes of the `data-navigation-mode` attribute that Layout
 * stamps on `<html>` (see {@link useNavigationModeDocumentAttribute}).
 */
function subscribeToNavigationMode(onChange: () => void): () => void {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return () => {};
  }

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-navigation-mode"],
  });
  return () => {
    observer.disconnect();
  };
}

function isRoutedLayoutSnapshot(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return (
    document.documentElement.getAttribute("data-navigation-mode") === "routed"
  );
}

/**
 * `true` while the routed (touch) layout is active, tracked reactively via the
 * `data-navigation-mode` attribute so it stays in lockstep with the CSS that
 * keys off the same hook. Reading the attribute — rather than re-deriving the
 * mode from the viewport — guarantees JS row-pitch math and CSS row height
 * agree even when the host forces a mode or a dev toggle overrides it.
 */
export function useRoutedLayoutActive(): boolean {
  // isRoutedLayoutSnapshot already returns false when there is no document, so
  // it doubles as the server snapshot the shared helper passes through.
  return useTearleadsExternalValue(
    subscribeToNavigationMode,
    isRoutedLayoutSnapshot,
  );
}

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
