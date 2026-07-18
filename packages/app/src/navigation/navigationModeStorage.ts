import type { AppNavigationMode } from "./AppNavigationMode";

// The manual windowed/routed choice is a display preference, not per-identity
// data, so it is persisted once for the app (not scoped per workspace/pane),
// mirroring how the theme choice is stored (see themeStorage.ts).
//
// Written only when the user explicitly flips the mode toggle, so its presence
// is an unambiguous record of intent. Its absence means "no manual choice",
// which defers to automatic viewport/pointer detection.
const CHOICE_STORAGE_KEY = "tearleads.navigationMode.choice";

function isAppNavigationMode(value: unknown): value is AppNavigationMode {
  return value === "windowed" || value === "routed";
}

function getStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * The navigation mode the user has explicitly chosen, or `null` when they have
 * not. `null` is distinct from any mode: it means "no stored choice", which is
 * what lets the layout fall back to (and keep tracking) live viewport/pointer
 * detection instead of a frozen mode. An unrecognized stored value is treated
 * as no choice rather than coerced to a default.
 */
export function loadStoredNavigationMode(): AppNavigationMode | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const choice = storage.getItem(CHOICE_STORAGE_KEY);
    return isAppNavigationMode(choice) ? choice : null;
  } catch {
    return null;
  }
}

export function saveNavigationMode(mode: AppNavigationMode | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    // Clearing to `null` (back to auto) removes the key so a stored default is
    // never mistaken for a real selection on the next load.
    if (mode === null) {
      storage.removeItem(CHOICE_STORAGE_KEY);
    } else {
      storage.setItem(CHOICE_STORAGE_KEY, mode);
    }
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
