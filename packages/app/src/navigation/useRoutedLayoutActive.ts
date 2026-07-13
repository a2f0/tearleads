import { useTearleadsExternalValue } from "../providers/sdk/useTearleadsSubscription";

// A single shared MutationObserver fans out to every subscriber. This hook backs
// every virtualized row/frame and every touch-only affordance (e.g. row kebabs),
// so a per-subscription observer would spin up dozens of identical observers
// watching the same attribute on the same element.
const navigationModeListeners = new Set<() => void>();
let navigationModeObserver: MutationObserver | null = null;

/**
 * Subscribes to changes of the `data-navigation-mode` attribute that Layout
 * stamps on `<html>` (see {@link useNavigationModeDocumentAttribute}), sharing
 * one observer across all subscribers.
 */
function subscribeToNavigationMode(onChange: () => void): () => void {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return () => {};
  }

  navigationModeListeners.add(onChange);
  if (!navigationModeObserver) {
    navigationModeObserver = new MutationObserver(() => {
      for (const listener of navigationModeListeners) {
        listener();
      }
    });
    navigationModeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-navigation-mode"],
    });
  }

  return () => {
    navigationModeListeners.delete(onChange);
    if (navigationModeListeners.size === 0 && navigationModeObserver) {
      navigationModeObserver.disconnect();
      navigationModeObserver = null;
    }
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
 * `true` while the routed (touch) layout is active — mobile **or** tablet/iPad —
 * tracked reactively via the `data-navigation-mode` attribute so it stays in
 * lockstep with the CSS that keys off the same hook. Reading the attribute —
 * rather than re-deriving the mode from the viewport — guarantees JS logic and
 * CSS agree even when the host forces a mode or a dev toggle overrides it.
 *
 * This is the single "touch layout" gate used both for row-pitch math
 * ({@link useTouchRowHeight}) and for touch-only affordances such as the row
 * overflow ("kebab") action button, which has no right-click equivalent on
 * touch.
 */
export function useRoutedLayoutActive(): boolean {
  // isRoutedLayoutSnapshot already returns false when there is no document, so
  // it doubles as the server snapshot the shared helper passes through.
  return useTearleadsExternalValue(
    subscribeToNavigationMode,
    isRoutedLayoutSnapshot,
  );
}
