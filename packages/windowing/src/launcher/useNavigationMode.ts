import { useEffect, useState } from "react";
import { WINDOWED_LAYOUT_NARROW_QUERY } from "./breakpoints";
import {
  isWindowedLayoutEligible,
  type NavigationEnvironment,
  type NavigationMode,
  readNavigationEnvironment,
  resolveNavigationMode,
} from "./navigationMode";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

interface UseNavigationModeInput {
  /**
   * A host's fixed layout. It wins over `preferredMode`, and yields only to
   * the user's `override`.
   */
  forcedMode?: NavigationMode | undefined;
  /**
   * The user's manual choice (see {@link NavigationModeOverrideProvider}). It
   * wins over `forcedMode` while windowed remains eligible.
   */
  override?: NavigationMode | null | undefined;
  /** The mode when nothing forces one. Defaults to `routed`. */
  preferredMode?: NavigationMode | undefined;
}

/**
 * The launcher's current navigation mode, following the screen as it resizes
 * and the pointer as it changes. A manual choice wins over the host mode while
 * windowed remains eligible: narrow and touch screens route even when a
 * desktop windowed choice is saved.
 */
export function useNavigationMode({
  forcedMode,
  override,
  preferredMode,
}: UseNavigationModeInput = {}): NavigationMode {
  const [environment, setEnvironment] = useState<NavigationEnvironment>(
    readNavigationEnvironment,
  );

  useEffect(() => {
    const narrowQuery = window.matchMedia(WINDOWED_LAYOUT_NARROW_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const updateEnvironment = () => setEnvironment(readNavigationEnvironment());
    updateEnvironment();
    narrowQuery.addEventListener("change", updateEnvironment);
    pointerQuery.addEventListener("change", updateEnvironment);
    return () => {
      narrowQuery.removeEventListener("change", updateEnvironment);
      pointerQuery.removeEventListener("change", updateEnvironment);
    };
  }, []);

  const availableOverride =
    override === "windowed" && !isWindowedLayoutEligible(environment)
      ? null
      : override;

  return resolveNavigationMode({
    environment,
    forcedMode: availableOverride ?? forcedMode,
    preferredMode,
  });
}
