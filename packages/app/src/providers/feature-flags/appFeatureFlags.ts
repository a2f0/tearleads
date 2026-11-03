import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../utils/storedPreference";

export const APP_FEATURE_FLAG_IDS = [
  "built-in-system-containers",
  "document-edit-ranges",
  "explorer-header-sync-indicator",
  "hide-org-manager-system-grants",
  "linked-document-activation-controls",
  "stripe-hosted-checkout",
  "workspace-switcher",
] as const;

export type AppFeatureFlagId = (typeof APP_FEATURE_FLAG_IDS)[number];
export type AppFeatureFlagMode = "disabled" | "enabled";

// A flag reads its default until the user sets it on this device. Most flags
// reveal unfinished UI and stay off; hiding the Org Manager system grants is
// the everyday view, so that flag starts on.
const APP_FEATURE_FLAG_DEFAULTS: Record<AppFeatureFlagId, AppFeatureFlagMode> =
  {
    "built-in-system-containers": "disabled",
    "document-edit-ranges": "disabled",
    "explorer-header-sync-indicator": "disabled",
    "hide-org-manager-system-grants": "enabled",
    "linked-document-activation-controls": "disabled",
    "stripe-hosted-checkout": "disabled",
    "workspace-switcher": "disabled",
  };

export function defaultAppFeatureFlagMode(
  flag: AppFeatureFlagId,
): AppFeatureFlagMode {
  return APP_FEATURE_FLAG_DEFAULTS[flag];
}

const STORAGE_PREFIX = "tearleads.feature-flags";

export function appFeatureFlagStorageKey(flag: AppFeatureFlagId): string {
  return `${STORAGE_PREFIX}:${flag}`;
}

function isAppFeatureFlagMode(
  value: string | null,
): value is AppFeatureFlagMode {
  return value === "disabled" || value === "enabled";
}

export function loadAppFeatureFlag(flag: AppFeatureFlagId): AppFeatureFlagMode {
  return loadStoredPreference(appFeatureFlagStorageKey(flag), (stored) =>
    isAppFeatureFlagMode(stored) ? stored : defaultAppFeatureFlagMode(flag),
  );
}

export function saveAppFeatureFlag(
  storageKey: string,
  mode: AppFeatureFlagMode,
): void {
  saveStoredPreference(storageKey, mode);
}
