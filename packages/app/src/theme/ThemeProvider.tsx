import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { loadTheme, saveTheme } from "./themeStorage";
import {
  getTheme,
  nextThemeId,
  type ThemeDefinition,
  type ThemeId,
} from "./themes";
import { useThemeDocumentAttribute } from "./useThemeDocumentAttribute";

interface ThemeContextValue {
  activeTheme: ThemeId;
  // The theme `toggleTheme` would switch to next — lets the toggle label itself
  // ("Switch to Dark theme") without re-deriving from the registry.
  nextTheme: ThemeDefinition;
  // Jump straight to a specific theme; the extension point a future multi-theme
  // picker uses. `toggleTheme` advances through the registry in order.
  setTheme: (theme: ThemeId) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// A single instance mounts above every pane (in Layout) so the one
// `<html data-theme>` attribute has a single owner. Two panes (split / demo
// peer) render their own footer toggles, but all of them drive this shared
// state.
export function ThemeProvider({ children }: PropsWithChildren) {
  const [activeTheme, setActiveTheme] = useState<ThemeId>(() => loadTheme());

  useThemeDocumentAttribute(activeTheme);

  // Persist as a side effect keyed on the committed theme so the state updaters
  // below stay pure — React may run an updater more than once or discard its
  // result (StrictMode, concurrent rendering), and persistence must track only
  // what actually commits. This is the single persistence site; saveTheme is
  // idempotent, so the initial write of the loaded value is a harmless no-op.
  useEffect(() => {
    saveTheme(activeTheme);
  }, [activeTheme]);

  const setTheme = useCallback((theme: ThemeId) => {
    setActiveTheme(theme);
  }, []);

  const toggleTheme = useCallback(() => {
    setActiveTheme(nextThemeId);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      activeTheme,
      nextTheme: getTheme(nextThemeId(activeTheme)),
      setTheme,
      toggleTheme,
    }),
    [activeTheme, setTheme, toggleTheme],
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
