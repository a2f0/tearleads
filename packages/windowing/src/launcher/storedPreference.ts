// Best-effort localStorage persistence for the launcher's display preferences
// (the navigation-mode choice, the launcher's placement). Unavailable or
// throwing storage degrades to the caller's fallback.

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
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
    // Persistence is best-effort; ignore disabled storage and quota errors.
  }
}
