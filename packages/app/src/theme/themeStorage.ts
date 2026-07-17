import { isThemeId, type ThemeId } from "./themes";

// The selected theme is a display preference, not per-identity data, so it is
// persisted once for the app (not scoped per workspace/pane), mirroring the
// system-monitor display preferences.

// Written only when the user explicitly picks a theme, so its presence is an
// unambiguous record of intent.
const CHOICE_STORAGE_KEY = "tearleads.theme.choice";

// The key older versions wrote. That provider persisted the active theme on
// every mount, so for a user who never chose, this holds an auto-persisted
// default rather than a selection. Read once, to migrate, then cleared.
const LEGACY_STORAGE_KEY = "tearleads.theme";

// The theme the old provider auto-persisted on mount for a user who never chose.
// A legacy value equal to this is indistinguishable from "never chose" and so is
// not treated as a selection; any other legacy value could only have been
// written by an explicit toggle (the old default-on-mount was always this), so
// it is preserved. Pinned to the historical default rather than DEFAULT_THEME_ID
// so a future change to the default does not retroactively reinterpret the
// migration.
const LEGACY_AUTOPERSIST_DEFAULT: ThemeId = "light";

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

// One-time migration of a value written by the old auto-persisting provider.
// Runs during load (so the first render already has the right theme and legacy
// dark-mode users do not flash the default first), and is idempotent: it clears
// the legacy key, so a second run finds nothing to migrate.
function migrateLegacyChoice(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): ThemeId | null {
  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  if (legacy === null) {
    return null;
  }
  storage.removeItem(LEGACY_STORAGE_KEY);
  if (isThemeId(legacy) && legacy !== LEGACY_AUTOPERSIST_DEFAULT) {
    storage.setItem(CHOICE_STORAGE_KEY, legacy);
    return legacy;
  }
  return null;
}

/**
 * The theme the user has explicitly chosen, or `null` when they have not.
 *
 * `null` is distinct from any theme id: it means "no stored choice", which is
 * what lets the provider fall back to (and keep following) the OS preference
 * instead of a frozen default. An unrecognized stored value is treated as no
 * choice rather than coerced to a default. A value left by the old
 * auto-persisting provider is migrated (see {@link migrateLegacyChoice}) so its
 * auto-persisted default is not mistaken for a real selection.
 */
export function loadStoredTheme(): ThemeId | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const choice = storage.getItem(CHOICE_STORAGE_KEY);
    if (isThemeId(choice)) {
      return choice;
    }
    return migrateLegacyChoice(storage);
  } catch {
    return null;
  }
}

export function saveTheme(theme: ThemeId): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CHOICE_STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
