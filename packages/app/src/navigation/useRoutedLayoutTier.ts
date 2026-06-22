import { useEffect, useState } from "react";
import {
  ROUTED_TABLET_BREAKPOINT_PX,
  ROUTED_TABLET_QUERY,
} from "./breakpoints";

/**
 * The two responsive shells the routed layout can present.
 *
 * - `mobile` — phone-style chrome: a top app bar with a hamburger that opens a
 *   slide-in navigation drawer over the content.
 * - `tablet` — iPad-style chrome: a persistent left sidebar rail beside the
 *   main content.
 */
export type RoutedLayoutTier = "mobile" | "tablet";

function readTier(): RoutedLayoutTier {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    // Server / non-DOM render: default to the wider layout so the markup is
    // stable and the narrow drawer never flashes before hydration.
    return "tablet";
  }

  return window.matchMedia(ROUTED_TABLET_QUERY).matches ? "tablet" : "mobile";
}

/**
 * Tracks which routed shell to render, keyed off the same `760px` line the
 * `RoutedPane.css` media query uses (see {@link ROUTED_TABLET_BREAKPOINT_PX}).
 *
 * Re-renders when the viewport crosses the breakpoint so the shell swaps
 * between the mobile drawer and the persistent tablet rail live.
 */
export function useRoutedLayoutTier(): RoutedLayoutTier {
  const [tier, setTier] = useState(readTier);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia(ROUTED_TABLET_QUERY);
    const updateTier = () => setTier(query.matches ? "tablet" : "mobile");

    updateTier();
    query.addEventListener("change", updateTier);
    return () => query.removeEventListener("change", updateTier);
  }, []);

  return tier;
}
