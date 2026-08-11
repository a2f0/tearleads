import { useEffect, useState } from "react";
import {
  type AppNavigationEnvironment,
  type AppNavigationMode,
  resolveAppNavigationMode,
} from "./AppNavigationMode";
import { COARSE_POINTER_QUERY, MOBILE_BREAKPOINT_QUERY } from "./breakpoints";

function readEnvironment(): AppNavigationEnvironment {
  return {
    innerWidth: window.innerWidth,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia(COARSE_POINTER_QUERY).matches,
    userAgent: navigator.userAgent,
  };
}

/**
 * Resolves the active navigation mode.
 *
 * Precedence: an explicit {@link override} (e.g. a manual test toggle) wins,
 * then a host-level {@link forcedMode}, then live viewport detection that
 * tracks the {@link MOBILE_BREAKPOINT_QUERY} and pointer media queries.
 */
export function useAppNavigationMode(
  forcedMode?: AppNavigationMode | undefined,
  override?: AppNavigationMode | null | undefined,
): AppNavigationMode {
  const resolvedForced = override ?? forcedMode;
  const [mode, setMode] = useState(() =>
    resolveAppNavigationMode({
      environment: readEnvironment(),
      forcedMode: resolvedForced ?? undefined,
    }),
  );

  useEffect(() => {
    if (resolvedForced) {
      setMode(resolvedForced);
      return;
    }

    const mobileQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const updateMode = () => {
      setMode(
        resolveAppNavigationMode({
          environment: readEnvironment(),
        }),
      );
    };

    updateMode();
    mobileQuery.addEventListener("change", updateMode);
    pointerQuery.addEventListener("change", updateMode);
    return () => {
      mobileQuery.removeEventListener("change", updateMode);
      pointerQuery.removeEventListener("change", updateMode);
    };
  }, [resolvedForced]);

  return mode;
}
