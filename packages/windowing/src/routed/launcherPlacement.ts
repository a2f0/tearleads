import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";

/**
 * Where the tablet tier's launcher sits: a rail on the left, or a sheet of
 * tiles from the bottom, as on a phone.
 */
export type LauncherPlacement = "side" | "bottom";

export function loadLauncherPlacement(storageKey: string): LauncherPlacement {
  return loadStoredPreference(storageKey, (stored) =>
    stored === "bottom" ? "bottom" : "side",
  );
}

export function saveLauncherPlacement(
  storageKey: string,
  placement: LauncherPlacement,
): void {
  saveStoredPreference(storageKey, placement);
}
