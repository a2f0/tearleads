import type { ThemeDefinition, ThemeScheme } from "@tearleads/windowing/theme";

/**
 * The website's two color themes. tokens.css styles them by
 * `<html data-theme-scheme>`. The ids differ from the app's "dark" so the
 * `:root[data-theme="dark"]` block in @tearleads/ui, which the header and
 * footer bring in, never overrides the site tokens.
 */
export type SiteThemeId = "site-light" | "site-dark";

export const SITE_THEMES: readonly ThemeDefinition<SiteThemeId>[] = [
  { id: "site-light", label: "Light", scheme: "light" },
  { id: "site-dark", label: "Dark", scheme: "dark" },
];

/** Until a visitor picks a theme, the site follows the OS preference. */
export const SITE_DEFAULT_THEME: Readonly<Record<ThemeScheme, SiteThemeId>> = {
  dark: "site-dark",
  light: "site-light",
};

/** Written only when a visitor picks a theme. */
export const SITE_THEME_STORAGE_KEY = "tearleads.website.theme";

/**
 * Dispatched on `<html>` once SiteThemeSwitch's ThemeProvider has mounted and
 * owns the theme, so the head script stops following the OS itself.
 */
export const SITE_THEME_PROVIDER_MOUNTED_EVENT = "tearleads:theme-provider";

/**
 * Stamps the theme SiteThemeSwitch's ThemeProvider will show, the stored theme
 * the site offers, else the one for the OS scheme, and stamps it again when
 * the OS scheme changes. The provider mounts only once the footer nears the
 * viewport, and until then this keeps an automatic light/dark schedule
 * working; when it mounts it dispatches `providerMountedEvent` on `root`, and
 * this stops, leaving the theme to the provider, whose pick may never reach
 * storage. Layout.astro inlines this function's source into `<head>` so it
 * runs before first paint, so it must stay self-contained: no imports or
 * outer references.
 */
export function stampSiteTheme(
  root: HTMLElement,
  storageKey: string,
  themes: readonly ThemeDefinition[],
  defaultTheme: Readonly<Record<ThemeScheme, string>>,
  providerMountedEvent: string,
): void {
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  function stamp(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(storageKey);
    } catch {
      // Storage can be disabled; the OS scheme decides.
    }
    const osScheme = darkScheme.matches ? "dark" : "light";
    const theme =
      themes.find((candidate) => candidate.id === stored) ??
      themes.find((candidate) => candidate.id === defaultTheme[osScheme]) ??
      themes[0];
    if (theme) {
      root.setAttribute("data-theme", theme.id);
      root.setAttribute("data-theme-scheme", theme.scheme);
    }
  }
  stamp();
  darkScheme.addEventListener("change", stamp);
  root.addEventListener(
    providerMountedEvent,
    () => darkScheme.removeEventListener("change", stamp),
    { once: true },
  );
}
