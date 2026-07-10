import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themes";

// The selected theme is a display preference, not per-identity data, so it is
// persisted once for the app (not scoped per workspace/pane), mirroring the
// system-monitor display preferences.
const STORAGE_KEY = "tearleads.theme";

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadTheme(): ThemeId {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_THEME_ID;
  }
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveTheme(theme: ThemeId): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
