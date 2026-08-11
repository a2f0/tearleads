// Best-effort localStorage persistence for display preferences (theme, sync
// mode, column visibility, ...). These are app-level settings, not
// per-identity data, so plain localStorage is the right home; unavailable or
// throwing storage degrades to the caller's fallback.

/** Best-effort browser localStorage; null when unavailable or throwing. */
export function getLocalStorage(): Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
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
 * Loads a stored preference, funneling every failure mode (no storage,
 * storage throws, `parse` throws) into `parse(null)` so the parser's
 * null-branch is the single source of the fallback value.
 */
export function loadStoredPreference<T>(
  storageKey: string,
  parse: (stored: string | null) => T,
): T {
  const storage = getLocalStorage();
  if (!storage) {
    return parse(null);
  }
  try {
    return parse(storage.getItem(storageKey));
  } catch {
    return parse(null);
  }
}

export function saveStoredPreference(storageKey: string, value: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey, value);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
