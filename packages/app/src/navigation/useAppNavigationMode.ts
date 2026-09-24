import { useEffect, useState } from "react";
import {
  type AppNavigationEnvironment,
  type AppNavigationMode,
  resolveAppNavigationMode,
} from "./AppNavigationMode";
import { DEMO_SPLIT_MOBILE_QUERY } from "./breakpoints";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function readEnvironment(): AppNavigationEnvironment {
  return {
    innerWidth: window.innerWidth,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia(COARSE_POINTER_QUERY).matches,
    userAgent: navigator.userAgent,
  };
}

/**
 * A manual choice wins over the host mode. Regular apps default to routed;
 * desktop peer demos keep their split windowed layout.
 */
export function useAppNavigationMode(
  forcedMode?: AppNavigationMode | undefined,
  override?: AppNavigationMode | null | undefined,
  preferWindowedPeerSplit = false,
): AppNavigationMode {
  const [environment, setEnvironment] = useState(readEnvironment);

  useEffect(() => {
    if (!preferWindowedPeerSplit || override || forcedMode) {
      return;
    }

    const mobileQuery = window.matchMedia(DEMO_SPLIT_MOBILE_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const updateEnvironment = () => setEnvironment(readEnvironment());
    mobileQuery.addEventListener("change", updateEnvironment);
    pointerQuery.addEventListener("change", updateEnvironment);
    return () => {
      mobileQuery.removeEventListener("change", updateEnvironment);
      pointerQuery.removeEventListener("change", updateEnvironment);
    };
  }, [forcedMode, override, preferWindowedPeerSplit]);

  return resolveAppNavigationMode({
    environment,
    forcedMode: override ?? forcedMode,
    preferWindowedPeerSplit,
  });
}
