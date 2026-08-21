import { useCallback } from "react";
import { useSymCryptExternalValue } from "../providers/sdk/useSymCryptSubscription";
import type { ThemeId } from "./themes";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * The theme the OS color-scheme preference maps to, tracked live.
 *
 * This is the theme the app shows until the user makes an explicit choice, so a
 * system on an automatic light/dark schedule is followed while the app is
 * unset rather than frozen at whatever the preference was on first load.
 */
export function useOsPreferredTheme(): ThemeId {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    query.addEventListener("change", onStoreChange);
    return () => {
      query.removeEventListener("change", onStoreChange);
    };
  }, []);

  const getSnapshot = useCallback((): ThemeId => {
    return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
  }, []);

  return useSymCryptExternalValue(subscribe, getSnapshot);
}
