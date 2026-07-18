import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { NavigationModeOverride } from "./NavigationModeToggle";
import {
  loadStoredNavigationMode,
  saveNavigationMode,
} from "./navigationModeStorage";

interface NavigationModeOverrideContextValue {
  // The manual windowed/routed choice, or `null` to defer to automatic
  // viewport/pointer detection.
  override: NavigationModeOverride;
  setOverride: (next: NavigationModeOverride) => void;
}

const NavigationModeOverrideContext =
  createContext<NavigationModeOverrideContextValue | null>(null);

/**
 * Owns the shared, persisted windowed/routed override. A single instance mounts
 * above the whole app (in Layout) so the footer mode switch, the routed
 * taskbar switch, and the developer-mode header toggle all drive the one choice
 * — and so the layout that reads it renders from the same source.
 *
 * The choice persists (mirroring the theme toggle): it is a deliberate manual
 * preference, so it should survive a reload rather than snapping back to auto.
 */
export function NavigationModeOverrideProvider({
  children,
}: PropsWithChildren) {
  const [override, setOverrideState] = useState<NavigationModeOverride>(() =>
    loadStoredNavigationMode(),
  );

  // Persist in the event handler, not a render path, so render stays free of
  // side effects (as ThemeProvider does with saveTheme).
  const setOverride = useCallback((next: NavigationModeOverride) => {
    setOverrideState(next);
    saveNavigationMode(next);
  }, []);

  const value = useMemo<NavigationModeOverrideContextValue>(
    () => ({ override, setOverride }),
    [override, setOverride],
  );

  return (
    <NavigationModeOverrideContext.Provider value={value}>
      {children}
    </NavigationModeOverrideContext.Provider>
  );
}

export function useNavigationModeOverride(): NavigationModeOverrideContextValue {
  const context = useContext(NavigationModeOverrideContext);
  if (!context) {
    throw new Error(
      "useNavigationModeOverride must be used within a NavigationModeOverrideProvider",
    );
  }
  return context;
}

// Non-throwing accessor: surfaces that may render outside the provider (e.g. a
// pane mounted standalone in tests) get null instead of a crash, mirroring
// useOptionalTheme. A switch rendered there simply hides itself.
export function useOptionalNavigationModeOverride(): NavigationModeOverrideContextValue | null {
  return useContext(NavigationModeOverrideContext);
}
