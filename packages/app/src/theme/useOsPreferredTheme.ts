import { useCallback } from "react";
import { useTearleadsExternalValue } from "../providers/sdk/useTearleadsSubscription";
import { DEFAULT_THEME_ID, type ThemeId } from "./themes";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function darkSchemeQuery(): MediaQueryList | null {
  // Guarded rather than assumed: matchMedia is absent in non-browser shells,
  // and can throw on a malformed query in some engines.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return null;
  }
  try {
    return window.matchMedia(DARK_SCHEME_QUERY);
  } catch {
    return null;
  }
}

/**
 * The theme the OS color-scheme preference maps to, tracked live.
 *
 * This is the theme the app shows until the user makes an explicit choice, so a
 * system on an automatic light/dark schedule is followed while the app is
 * unset rather than frozen at whatever the preference was on first load. Where
 * the preference cannot be read (no `matchMedia`), it falls back to the light
 * default, matching the base `:root` token block.
 */
export function useOsPreferredTheme(): ThemeId {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const query = darkSchemeQuery();
    if (!query) {
      return () => {};
    }
    query.addEventListener("change", onStoreChange);
    return () => {
      query.removeEventListener("change", onStoreChange);
    };
  }, []);

  const getSnapshot = useCallback((): ThemeId => {
    const query = darkSchemeQuery();
    if (!query) {
      return DEFAULT_THEME_ID;
    }
    return query.matches ? "dark" : "light";
  }, []);

  return useTearleadsExternalValue(subscribe, getSnapshot);
}
