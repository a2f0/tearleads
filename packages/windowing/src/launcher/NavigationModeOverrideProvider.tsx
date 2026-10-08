import { type PropsWithChildren, useCallback, useMemo, useState } from "react";
import { createRequiredContext } from "../createRequiredContext";
import type { NavigationMode } from "./navigationMode";
import { loadStoredPreference, saveStoredPreference } from "./storedPreference";

type NavigationModeOverride = NavigationMode | null;

interface NavigationModeOverrideContextValue {
  // The manual windowed/routed choice, or `null` to use the host/default mode.
  override: NavigationModeOverride;
  setOverride: (next: NavigationMode) => void;
}

const navigationModeOverrideContext =
  createRequiredContext<NavigationModeOverrideContextValue>(
    "useNavigationModeOverride must be used within a NavigationModeOverrideProvider",
  );

interface NavigationModeOverrideProviderProps extends PropsWithChildren {
  /** Where the choice persists in localStorage. */
  storageKey: string;
}

function loadOverride(storageKey: string): NavigationModeOverride {
  return loadStoredPreference(storageKey, (stored) =>
    stored === "routed" || stored === "windowed" ? stored : null,
  );
}

/**
 * Owns the user's windowed/routed choice. Mount a single instance above the
 * whole launcher so every mode switch drives the one choice, and so the layout
 * reads from the same source (pass `override` to {@link useNavigationMode}).
 *
 * A manual choice persists across reloads. With no saved choice, the host
 * default still decides the layout.
 */
export function NavigationModeOverrideProvider({
  children,
  storageKey,
}: NavigationModeOverrideProviderProps) {
  const [override, setCurrentOverride] = useState<NavigationModeOverride>(() =>
    loadOverride(storageKey),
  );
  const setOverride = useCallback(
    (next: NavigationMode) => {
      setCurrentOverride(next);
      saveStoredPreference(storageKey, next);
    },
    [storageKey],
  );

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
// pane mounted standalone in tests) get null instead of a crash. A switch
// rendered there simply hides itself.
export const useOptionalNavigationModeOverride =
  navigationModeOverrideContext.useOptional;
