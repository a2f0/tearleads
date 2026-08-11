import {
  loadStoredPreference,
  saveStoredPreference,
} from "../utils/storedPreference";
import { isThemeId, type ThemeId } from "./themes";

// The selected theme is a display preference, not per-identity data, so it is
// persisted once for the app (not scoped per workspace/pane), mirroring the
// system-monitor display preferences.

// Written only when the user explicitly picks a theme, so its presence is an
// unambiguous record of intent.
const CHOICE_STORAGE_KEY = "tearleads.theme.choice";

/**
 * The theme the user has explicitly chosen, or `null` when they have not.
 *
 * `null` is distinct from any theme id: it means "no stored choice", which is
 * what lets the provider fall back to (and keep following) the OS preference
 * instead of a frozen default. An unrecognized stored value is treated as no
 * choice rather than coerced to a default.
 */
export function loadStoredTheme(): ThemeId | null {
  return loadStoredPreference(CHOICE_STORAGE_KEY, (choice) =>
    isThemeId(choice) ? choice : null,
  );
}

export function saveTheme(theme: ThemeId): void {
  saveStoredPreference(CHOICE_STORAGE_KEY, theme);
}
