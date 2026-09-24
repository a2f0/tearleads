import { useEffect, useState } from "react";
import {
  type AppNavigationEnvironment,
  type AppNavigationMode,
  isWindowedLayoutEligible,
  readAppNavigationEnvironment,
  resolveAppNavigationMode,
} from "./AppNavigationMode";
import { DEMO_SPLIT_MOBILE_QUERY } from "./breakpoints";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * A manual choice wins over the host mode while windowed remains eligible.
 * Narrow and touch screens route even when a desktop windowed choice is saved.
 */
export function useAppNavigationMode(
  forcedMode?: AppNavigationMode | undefined,
  override?: AppNavigationMode | null | undefined,
  preferWindowedPeerSplit = false,
): AppNavigationMode {
  const [environment, setEnvironment] = useState<AppNavigationEnvironment>(
    readAppNavigationEnvironment,
  );

  useEffect(() => {
    const mobileQuery = window.matchMedia(DEMO_SPLIT_MOBILE_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const updateEnvironment = () =>
      setEnvironment(readAppNavigationEnvironment());
    updateEnvironment();
    mobileQuery.addEventListener("change", updateEnvironment);
    pointerQuery.addEventListener("change", updateEnvironment);
    return () => {
      mobileQuery.removeEventListener("change", updateEnvironment);
      pointerQuery.removeEventListener("change", updateEnvironment);
    };
  }, []);

  const availableOverride =
    override === "windowed" && !isWindowedLayoutEligible(environment)
      ? null
      : override;

  return resolveAppNavigationMode({
    environment,
    forcedMode: availableOverride ?? forcedMode,
    preferWindowedPeerSplit,
  });
}
