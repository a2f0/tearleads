import { useEffect } from "react";
import type { ThemeId } from "./themes";

/**
 * Mirrors the active theme onto `<html data-theme>` so CSS can select the
 * matching token block in @tearleads/ui's styles.css. Stamping the document
 * root (rather than a subtree) also lets portaled menus and modals inherit the
 * theme, and a document with no attribute falls back to the Light values in the
 * base `:root`.
 *
 * This mirrors `useNavigationModeDocumentAttribute` — same reasoning for keying
 * off a root attribute rather than a bare CSS media query: the provider resolves
 * the active theme in one place (an explicit choice when the user has made one,
 * otherwise the OS preference) and stamps the result, so the CSS selects on the
 * single resolved attribute rather than re-deriving the preference itself.
 */
export function useThemeDocumentAttribute(theme: ThemeId): void {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [theme]);
}
