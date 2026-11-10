import {
  ThemeInvertIcon,
  ThemeProvider,
  useTheme,
} from "@tearleads/windowing/theme";
import { useEffect, useState } from "react";
import {
  SITE_DEFAULT_THEME,
  SITE_THEME_STORAGE_KEY,
  SITE_THEMES,
} from "../siteTheme";

function SiteThemeButton() {
  const theme = useTheme();
  const label = `Switch to ${theme.nextTheme.label} theme`;
  return (
    <button
      aria-label={label}
      className="site-theme-switch"
      title={label}
      type="button"
      onClick={theme.toggleTheme}
    >
      <ThemeInvertIcon size={20} />
    </button>
  );
}

/**
 * The site's light/dark switch in the footer's lower-right corner, hydrated as
 * its own island (slot="themeSwitch" in Layout.astro) once the footer nears
 * the viewport. Like the app's ThemeSwitch it moves to the next theme and
 * names it.
 *
 * It owns the site's ThemeProvider, which persists a pick and otherwise
 * follows the OS live. Until it mounts, the theme script in Layout.astro's
 * stamp stands. The provider mounts only after hydration: hydrated from server
 * HTML, it would first read the OS scheme as light and stamp that over a dark
 * page. The static HTML and the first client render therefore show the same
 * glyph in an inert box, and the effect swaps in the labelled button.
 */
export function SiteThemeSwitch() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return (
      <span aria-hidden="true" className="site-theme-switch">
        <ThemeInvertIcon size={20} />
      </span>
    );
  }
  return (
    <ThemeProvider
      defaultTheme={SITE_DEFAULT_THEME}
      storageKey={SITE_THEME_STORAGE_KEY}
      themes={SITE_THEMES}
    >
      <SiteThemeButton />
    </ThemeProvider>
  );
}
