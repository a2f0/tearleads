import {
  ThemeInvertIcon,
  ThemeProvider,
  useTheme,
} from "@tearleads/windowing/theme";
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
      <span className="site-theme-switch-text">
        {theme.nextTheme.label} theme
      </span>
    </button>
  );
}

/**
 * The site's light/dark switch, the last item of the primary nav: an icon
 * button in the header row, a labelled row in the phone menu (frame.css).
 * Like the app's ThemeSwitch it moves to the next theme and names it.
 *
 * It owns the site's ThemeProvider, which persists a pick and otherwise
 * follows the OS live. SiteNav mounts it only after hydration: the theme
 * script in Layout.astro has already stamped `<html data-theme-scheme>`, and a
 * provider hydrated from server HTML would first read the OS scheme as light
 * and stamp that over a dark page.
 */
export function SiteThemeSwitch() {
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
