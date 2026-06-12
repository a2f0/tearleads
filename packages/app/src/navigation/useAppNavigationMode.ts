import { useEffect, useState } from "react";
import {
  type AppNavigationEnvironment,
  type AppNavigationMode,
  resolveAppNavigationMode,
} from "./AppNavigationMode";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1023px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function readEnvironment(): AppNavigationEnvironment {
  const viewport =
    typeof window === "undefined"
      ? { innerWidth: 1024, matchMedia: undefined }
      : window;
  const navigatorLike =
    typeof navigator === "undefined"
      ? { maxTouchPoints: 0, userAgent: "" }
      : navigator;
  const pointerCoarse =
    typeof viewport.matchMedia === "function"
      ? viewport.matchMedia(COARSE_POINTER_QUERY).matches
      : false;

  return {
    innerWidth: viewport.innerWidth,
    maxTouchPoints: navigatorLike.maxTouchPoints ?? 0,
    pointerCoarse,
    userAgent: navigatorLike.userAgent,
  };
}

export function useAppNavigationMode(
  forcedMode?: AppNavigationMode | undefined,
): AppNavigationMode {
  const [mode, setMode] = useState(() =>
    resolveAppNavigationMode({
      environment: readEnvironment(),
      forcedMode,
    }),
  );

  useEffect(() => {
    if (forcedMode) {
      setMode(forcedMode);
      return;
    }

    if (typeof window === "undefined" || !window.matchMedia) {
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
  }, [forcedMode]);

  return mode;
}
