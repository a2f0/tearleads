import { ThemeInvertIcon, useOptionalTheme } from "@tearleads/windowing/theme";

/**
 * The site's light/dark switch, the last item of the primary nav: an icon
 * button in the header's row, a labelled row in the phone menu (frame.css).
 * Like the app's ThemeSwitch it moves to the next theme and names it; it
 * renders nothing outside the ThemeProvider in SiteHeaderNav.
 */
export function SiteThemeButton() {
  const theme = useOptionalTheme();
  if (!theme) {
    return null;
  }

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
