import { useDocumentRootAttribute } from "../utils/useDocumentRootAttribute";
import { getTheme, type ThemeId } from "./themes";

/**
 * Mirrors the active theme onto `<html data-theme>` so CSS can select the
 * matching token block in @tearleads/ui's styles.css. A document with no
 * attribute falls back to the Light values in the base `:root`.
 *
 * The theme's scheme is stamped alongside it as `<html data-theme-scheme>`
 * ("light" | "dark"), so the few rules that care only whether surfaces are
 * dark (shadow depth, status-glyph hues, the native status bar) apply to every
 * dark theme without listing theme ids.
 *
 * This mirrors `useNavigationModeDocumentAttribute` — same reasoning for keying
 * off a root attribute rather than a bare CSS media query: the provider resolves
 * the active theme in one place (an explicit choice when the user has made one,
 * otherwise the OS preference) and stamps the result, so the CSS selects on the
 * single resolved attribute rather than re-deriving the preference itself.
 */
export function useThemeDocumentAttribute(theme: ThemeId): void {
  useDocumentRootAttribute("data-theme", theme);
  useDocumentRootAttribute("data-theme-scheme", getTheme(theme).scheme);
}
