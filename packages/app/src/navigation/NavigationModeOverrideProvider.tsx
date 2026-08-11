import { type PropsWithChildren, useMemo, useState } from "react";
import { createRequiredContext } from "../utils/createRequiredContext";
import type { AppNavigationMode } from "./AppNavigationMode";

type NavigationModeOverride = AppNavigationMode | null;

interface NavigationModeOverrideContextValue {
  // The manual windowed/routed choice, or `null` to defer to automatic
  // viewport/pointer detection.
  override: NavigationModeOverride;
  setOverride: (next: NavigationModeOverride) => void;
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
 * The override is intentionally in-memory only: it resets to `null` (auto) on a
 * full reload, so viewport/pointer detection resumes and a mode forced for a
 * quick preview never sticks silently.
 */
export function NavigationModeOverrideProvider({
  children,
}: PropsWithChildren) {
  const [override, setOverride] = useState<NavigationModeOverride>(null);

  const value = useMemo<NavigationModeOverrideContextValue>(
    () => ({ override, setOverride }),
    [override],
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
