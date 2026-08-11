import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../utils/storedPreference";

export const APP_FEATURE_FLAG_IDS = [
  "built-in-system-containers",
  "document-edit-ranges",
  "explorer-header-sync-indicator",
  "linked-document-activation-controls",
  "workspace-switcher",
] as const;

export type AppFeatureFlagId = (typeof APP_FEATURE_FLAG_IDS)[number];
export type AppFeatureFlagMode = "disabled" | "enabled";

export const DEFAULT_APP_FEATURE_FLAG_MODE: AppFeatureFlagMode = "disabled";

const STORAGE_PREFIX = "tearleads.feature-flags";

export function appFeatureFlagStorageKey(flag: AppFeatureFlagId): string {
  return `${STORAGE_PREFIX}:${flag}`;
}

function isAppFeatureFlagMode(
  value: string | null,
): value is AppFeatureFlagMode {
  return value === "disabled" || value === "enabled";
}

export function loadAppFeatureFlag(storageKey: string): AppFeatureFlagMode {
  return loadStoredPreference(storageKey, (stored) =>
    isAppFeatureFlagMode(stored) ? stored : DEFAULT_APP_FEATURE_FLAG_MODE,
  );
}

export function saveAppFeatureFlag(
  storageKey: string,
  mode: AppFeatureFlagMode,
): void {
  saveStoredPreference(storageKey, mode);
}
