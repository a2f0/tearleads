import {
  type ThemeDefinition,
  ThemeProvider as WindowingThemeProvider,
} from "@tearleads/windowing";
import type { PropsWithChildren } from "react";
import type { ThemeId } from "./themes";

// Written only when the user explicitly picks a theme, so its presence is an
// unambiguous record of intent. The theme is a display preference, not
// per-identity data, so it persists once for the app rather than per pane.
const THEME_CHOICE_STORAGE_KEY = "tearleads.theme.choice";

// Until the user picks a theme, the app follows the OS preference, live.
const OS_THEME = { dark: "dark", light: "light" } as const;

interface ThemeProviderProps extends PropsWithChildren {
  /** The host profile's themes (see AppHostProfile.themes). */
  themes: readonly ThemeDefinition<ThemeId>[];
}

// A single instance mounts above every pane (in Layout) so the one
// `<html data-theme>` attribute has a single owner. Two panes (split / demo
// peer) render their own footer toggles, but all of them drive this shared
// state.
export function ThemeProvider({ children, themes }: ThemeProviderProps) {
  return (
    <WindowingThemeProvider
      defaultTheme={OS_THEME}
      storageKey={THEME_CHOICE_STORAGE_KEY}
      themes={themes}
    >
      {children}
    </WindowingThemeProvider>
  );
}
