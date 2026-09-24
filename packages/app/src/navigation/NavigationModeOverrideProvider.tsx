import { type PropsWithChildren, useCallback, useMemo, useState } from "react";
import { createRequiredContext } from "../utils/createRequiredContext";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../utils/storedPreference";
import type { AppNavigationMode } from "./AppNavigationMode";

type NavigationModeOverride = AppNavigationMode | null;
const STORAGE_KEY = "tearleads.navigation.mode";

function loadOverride(): NavigationModeOverride {
  return loadStoredPreference(STORAGE_KEY, (stored) =>
    stored === "routed" || stored === "windowed" ? stored : null,
  );
}

interface NavigationModeOverrideContextValue {
  // The manual windowed/routed choice, or `null` to use the host/default mode.
  override: NavigationModeOverride;
  setOverride: (next: AppNavigationMode) => void;
}

const navigationModeOverrideContext =
  createRequiredContext<NavigationModeOverrideContextValue>(
    "useNavigationModeOverride must be used within a NavigationModeOverrideProvider",
  );

/**
 * Owns the shared windowed/routed override. A single instance mounts above the
 * whole app (in Layout) so the windowed footer switch and routed taskbar switch
 * drive the one choice — and so the layout reads from the same source.
 *
 * A manual choice persists across reloads. With no saved choice, the host
 * default still decides the layout.
 */
export function NavigationModeOverrideProvider({
  children,
}: PropsWithChildren) {
  const [override, setCurrentOverride] =
    useState<NavigationModeOverride>(loadOverride);
  const setOverride = useCallback((next: AppNavigationMode) => {
    setCurrentOverride(next);
    saveStoredPreference(STORAGE_KEY, next);
  }, []);

  const value = useMemo<NavigationModeOverrideContextValue>(
    () => ({ override, setOverride }),
    [override, setOverride],
  );

  return (
    <navigationModeOverrideContext.context.Provider value={value}>
      {children}
    </navigationModeOverrideContext.context.Provider>
  );
}

export const useNavigationModeOverride =
  navigationModeOverrideContext.useRequired;

// Non-throwing accessor: surfaces that may render outside the provider (e.g. a
// pane mounted standalone in tests) get null instead of a crash, mirroring
// useOptionalTheme. A switch rendered there simply hides itself.
export const useOptionalNavigationModeOverride =
  navigationModeOverrideContext.useOptional;
