import { useSyncExternalStore } from "react";
import type { ThemeScheme } from "./themes";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function darkSchemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_SCHEME_QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const query = darkSchemeQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function getSnapshot(): ThemeScheme {
  return darkSchemeQuery()?.matches ? "dark" : "light";
}

function getServerSnapshot(): ThemeScheme {
  return "light";
}

/**
 * The OS color-scheme preference, tracked live, so a default theme chosen per
 * scheme follows a system on an automatic light/dark schedule.
 */
export function useOsColorScheme(): ThemeScheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
