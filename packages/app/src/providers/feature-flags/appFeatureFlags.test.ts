import { afterEach, expect, test } from "bun:test";
import {
  APP_FEATURE_FLAG_IDS,
  appFeatureFlagStorageKey,
  DEFAULT_APP_FEATURE_FLAG_MODE,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

const BUILT_IN_SYSTEM_CONTAINERS_KEY = appFeatureFlagStorageKey(
  "built-in-system-containers",
);

afterEach(() => {
  globalThis.localStorage.clear();
});

test("feature flags default to disabled when nothing is stored", () => {
  expect(DEFAULT_APP_FEATURE_FLAG_MODE).toBe("disabled");
  for (const flag of APP_FEATURE_FLAG_IDS) {
    expect(loadAppFeatureFlag(appFeatureFlagStorageKey(flag))).toBe("disabled");
  }
});

test("round-trips a saved feature flag", () => {
  for (const flag of APP_FEATURE_FLAG_IDS) {
    const storageKey = appFeatureFlagStorageKey(flag);
    saveAppFeatureFlag(storageKey, "enabled");
    expect(loadAppFeatureFlag(storageKey)).toBe("enabled");
    saveAppFeatureFlag(storageKey, "disabled");
    expect(loadAppFeatureFlag(storageKey)).toBe("disabled");
  }
});

test("feature flags fall back to disabled for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(BUILT_IN_SYSTEM_CONTAINERS_KEY, "bogus");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
});
