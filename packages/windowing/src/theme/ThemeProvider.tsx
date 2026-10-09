import {
  type PropsWithChildren,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";
import {
  type DefaultTheme,
  findTheme,
  nextTheme,
  resolveDefaultThemeId,
  type ThemeDefinition,
} from "./themes";
import { useOsColorScheme } from "./useOsColorScheme";

interface ThemeContextValue {
  /** The theme showing: the user's choice, or the host's default. */
  activeTheme: ThemeDefinition;
  /** The theme `toggleTheme` switches to: the next in order, wrapping. */
  nextTheme: ThemeDefinition;
  /** Records a theme the host offers as the user's choice. */
  setTheme: (id: string) => void;
  /** Every theme the host offers, in order. */
  themes: readonly ThemeDefinition[];
  /** Records the next theme as the user's choice. */
  toggleTheme: () => void;
}

const themeContext = createRequiredContext<ThemeContextValue>(
  "useTheme must be used within a ThemeProvider",
);

interface ThemeProviderProps<Id extends string> extends PropsWithChildren {
  /** The theme until the user picks one; see {@link DefaultTheme}. */
  defaultTheme: DefaultTheme<NoInfer<Id>>;
  /** Where the user's choice persists in localStorage. */
  storageKey: string;
  /**
   * The themes the host offers, in the order the switch cycles them. Define
   * the list once, outside render.
   */
  themes: readonly ThemeDefinition<Id>[];
}

/**
 * Stamps the theme onto `<html>` before the browser paints, so a page never
 * shows the default tokens first, and clears it on unmount. Stamping the root
 * lets portaled menus and modals inherit the theme too.
 */
function useThemeDocumentAttributes({ id, scheme }: ThemeDefinition): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", id);
    root.setAttribute("data-theme-scheme", scheme);
    return () => {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-theme-scheme");
    };
  }, [id, scheme]);
}

/**
 * Owns the color theme: the host's `themes`, the user's choice among them, and
 * the `<html data-theme>` and `data-theme-scheme` attributes the host's theme
 * stylesheets select on. Mount a single instance above everything themed, so
 * the attributes have one owner and every {@link ThemeSwitch} drives the one
 * choice.
 *
 * Only an explicit choice persists. Until the user makes one, the provider
 * shows `defaultTheme`, following the OS preference live when that names a
 * theme per scheme. A stored id the host no longer offers counts as no choice.
 */
export function ThemeProvider<Id extends string>({
  children,
  defaultTheme,
  storageKey,
  themes,
}: ThemeProviderProps<Id>) {
  const [choice, setChoice] = useState(() =>
    loadStoredPreference(storageKey, (stored) => stored),
  );
  const osScheme = useOsColorScheme();
  const activeTheme =
    findTheme(themes, choice) ??
    findTheme(themes, resolveDefaultThemeId(defaultTheme, osScheme)) ??
    themes[0];
  if (!activeTheme) {
    throw new Error("ThemeProvider needs at least one theme");
  }

  useThemeDocumentAttributes(activeTheme);

  const setTheme = useCallback(
    (id: string) => {
      if (!findTheme(themes, id)) {
        return;
      }
      setChoice(id);
      saveStoredPreference(storageKey, id);
    },
    [storageKey, themes],
  );

  const upcomingTheme = nextTheme(themes, activeTheme);
  const toggleTheme = useCallback(
    () => setTheme(upcomingTheme.id),
    [setTheme, upcomingTheme],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      activeTheme,
      nextTheme: upcomingTheme,
      setTheme,
      themes,
      toggleTheme,
    }),
    [activeTheme, setTheme, themes, toggleTheme, upcomingTheme],
  );

  return (
    <themeContext.context.Provider value={value}>
      {children}
    </themeContext.context.Provider>
  );
}

export const useTheme = themeContext.useRequired;

// Non-throwing accessor: a surface that may render outside the provider (a
// pane mounted standalone in tests) gets null, and a switch there hides.
export const useOptionalTheme = themeContext.useOptional;
