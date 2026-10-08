import { useSyncExternalStore } from "react";

// A single shared MutationObserver fans out to every subscriber. This hook backs
// every virtualized row/frame and every touch-only affordance (e.g. row kebabs),
// so a per-subscription observer would spin up dozens of identical observers
// watching the same attribute on the same element.
const navigationModeListeners = new Set<() => void>();
let navigationModeObserver: MutationObserver | null = null;

/**
 * Subscribes to changes of the `data-navigation-mode` attribute that
 * {@link useNavigationModeDocumentAttribute} stamps on `<html>`, sharing
 * one observer across all subscribers.
 */
function subscribeToNavigationMode(onChange: () => void): () => void {
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
  return (
    document.documentElement.getAttribute("data-navigation-mode") === "routed"
  );
}

function isWindowedLayoutSnapshot(): boolean {
  return (
    document.documentElement.getAttribute("data-navigation-mode") === "windowed"
  );
}

/**
 * `true` while the routed (touch) layout is active — mobile **or** tablet/iPad —
 * tracked reactively via the `data-navigation-mode` attribute so it stays in
 * lockstep with the CSS that keys off the same hook. Reading the attribute —
 * rather than re-deriving the mode from the viewport — guarantees JS logic and
 * CSS agree even when the host forces a mode or a dev toggle overrides it.
 *
 * Use it as the single "touch layout" gate: for row-pitch math, and for
 * touch-only affordances such as a row overflow ("kebab") button, which has no
 * right-click equivalent on touch.
 */
export function useRoutedLayoutActive(): boolean {
  return useSyncExternalStore(
    subscribeToNavigationMode,
    isRoutedLayoutSnapshot,
    isRoutedLayoutSnapshot,
  );
}

/**
 * `true` while the windowed (desktop window-manager) layout is active — the
 * counterpart to {@link useRoutedLayoutActive}, tracked off the same
 * `data-navigation-mode` attribute so JS and CSS stay in lockstep.
 *
 * The routed layout's negation is deliberately *not* used here: a render with no
 * attribute at all (an isolated component tree, e.g. a unit test) is neither
 * routed nor windowed, so `!routed` would wrongly report windowed. This checks
 * for the explicit `"windowed"` value instead. Use it for portaled overlays
 * that should read as floating windows on the desktop while the routed (touch)
 * shell keeps its compact styling.
 */
export function useWindowedLayoutActive(): boolean {
  return useSyncExternalStore(
    subscribeToNavigationMode,
    isWindowedLayoutSnapshot,
    isWindowedLayoutSnapshot,
  );
}
