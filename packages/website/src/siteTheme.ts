import type { DefaultTheme, ThemeDefinition } from "@tearleads/windowing/theme";

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
export const SITE_DEFAULT_THEME: DefaultTheme<SiteThemeId> = {
  dark: "site-dark",
  light: "site-light",
};

/** Written only when a visitor picks a theme. */
export const SITE_THEME_STORAGE_KEY = "tearleads.website.theme";
