import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../../utils/storedPreference";

export type LauncherPlacement = "side" | "bottom";

const STORAGE_KEY = "tearleads.launcher.placement";

export function loadLauncherPlacement(): LauncherPlacement {
  return loadStoredPreference(STORAGE_KEY, (stored) =>
    stored === "bottom" ? "bottom" : "side",
  );
}

export function saveLauncherPlacement(placement: LauncherPlacement): void {
  saveStoredPreference(STORAGE_KEY, placement);
}
