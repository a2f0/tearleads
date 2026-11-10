import { ThemeProvider } from "@tearleads/windowing/theme";
import {
  SITE_DEFAULT_THEME,
  SITE_THEME_STORAGE_KEY,
  SITE_THEMES,
} from "../siteTheme";
import { SiteNav } from "./SiteNav";

interface SiteHeaderNavProps {
  readonly pathname?: string | undefined;
}

/**
 * The header's island (slot="nav" in Layout.astro): the primary nav under the
 * site's ThemeProvider, so the nav's theme button and the `<html
 * data-theme-scheme>` stamp share one owner. The theme script in Layout.astro
 * stamps the stored or OS theme before first paint; the provider takes over
 * on hydration and follows the OS live until the visitor picks a theme.
 */
export function SiteHeaderNav({ pathname }: SiteHeaderNavProps) {
  return (
    <ThemeProvider
      defaultTheme={SITE_DEFAULT_THEME}
      storageKey={SITE_THEME_STORAGE_KEY}
      themes={SITE_THEMES}
    >
      <SiteNav pathname={pathname} />
    </ThemeProvider>
  );
}
