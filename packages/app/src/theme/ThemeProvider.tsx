import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { loadStoredTheme, saveTheme } from "./themeStorage";
import {
  getTheme,
  nextThemeId,
  type ThemeDefinition,
  type ThemeId,
} from "./themes";
import { useOsPreferredTheme } from "./useOsPreferredTheme";
import { useThemeDocumentAttribute } from "./useThemeDocumentAttribute";

interface ThemeContextValue {
  activeTheme: ThemeId;
  // The theme `toggleTheme` would switch to next — lets the toggle label itself
  // ("Switch to Dark theme") without re-deriving from the registry.
  nextTheme: ThemeDefinition;
  // Advances through the registry in order.
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// A single instance mounts above every pane (in Layout) so the one
// `<html data-theme>` attribute has a single owner. Two panes (split / demo
// peer) render their own footer toggles, but all of them drive this shared
// state.
export function ThemeProvider({ children }: PropsWithChildren) {
  // A stored value is the user's explicit choice; `null` means "follow the OS",
  // which is the default until they pick one.
  const [selectedTheme, setSelectedTheme] = useState<ThemeId | null>(() =>
    loadStoredTheme(),
  );
  const osTheme = useOsPreferredTheme();
  const activeTheme = selectedTheme ?? osTheme;

  useThemeDocumentAttribute(activeTheme);

  // Persist only an explicit choice — never the OS-derived default. A user who
  // has not chosen keeps following their system preference (including a live
  // auto light/dark switch) instead of being frozen at whatever it was on first
  // load. saveTheme runs here in the event handler, not a render path, so the
  // render stays free of side effects.
  const setTheme = useCallback((theme: ThemeId) => {
    setSelectedTheme(theme);
    saveTheme(theme);
  }, []);

  const toggleTheme = useCallback(() => {
    // Advance from what is currently shown — the OS theme until the user has
    // chosen — so the first toggle flips away from the system default.
    setTheme(nextThemeId(activeTheme));
  }, [activeTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      activeTheme,
      nextTheme: getTheme(nextThemeId(activeTheme)),
      toggleTheme,
    }),
    [activeTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// Non-throwing accessor: surfaces that may render outside the provider (e.g. a
// pane mounted standalone in tests) get null instead of a crash, mirroring
// useOptionalWorkspace.
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
