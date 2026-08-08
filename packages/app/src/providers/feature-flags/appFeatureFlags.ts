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

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isAppFeatureFlagMode(
  value: string | null,
): value is AppFeatureFlagMode {
  return value === "disabled" || value === "enabled";
}

export function loadAppFeatureFlag(storageKey: string): AppFeatureFlagMode {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_APP_FEATURE_FLAG_MODE;
  }

  try {
    const stored = storage.getItem(storageKey);
    return isAppFeatureFlagMode(stored)
      ? stored
      : DEFAULT_APP_FEATURE_FLAG_MODE;
  } catch {
    return DEFAULT_APP_FEATURE_FLAG_MODE;
  }
}

export function saveAppFeatureFlag(
  storageKey: string,
  mode: AppFeatureFlagMode,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey, mode);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
