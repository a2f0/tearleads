import { afterEach, expect, test } from "bun:test";
import {
  APP_FEATURE_FLAG_IDS,
  appFeatureFlagStorageKey,
  defaultAppFeatureFlagMode,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

const BUILT_IN_SYSTEM_CONTAINERS_KEY = appFeatureFlagStorageKey(
  "built-in-system-containers",
);

afterEach(() => {
  globalThis.localStorage.clear();
});

test("feature flags read their default when nothing is stored", () => {
  for (const flag of APP_FEATURE_FLAG_IDS) {
    expect(loadAppFeatureFlag(flag)).toBe(
      flag === "hide-org-manager-system-grants" ? "enabled" : "disabled",
    );
    expect(loadAppFeatureFlag(flag)).toBe(defaultAppFeatureFlagMode(flag));
  }
});

test("round-trips a saved feature flag", () => {
  for (const flag of APP_FEATURE_FLAG_IDS) {
    const storageKey = appFeatureFlagStorageKey(flag);
    saveAppFeatureFlag(storageKey, "enabled");
    expect(loadAppFeatureFlag(flag)).toBe("enabled");
    saveAppFeatureFlag(storageKey, "disabled");
    expect(loadAppFeatureFlag(flag)).toBe("disabled");
  }
});

test("feature flags fall back to their default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(BUILT_IN_SYSTEM_CONTAINERS_KEY, "bogus");
  expect(loadAppFeatureFlag("built-in-system-containers")).toBe("disabled");
  globalThis.localStorage.setItem(
    appFeatureFlagStorageKey("hide-org-manager-system-grants"),
    "bogus",
  );
  expect(loadAppFeatureFlag("hide-org-manager-system-grants")).toBe("enabled");
});
