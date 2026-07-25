import { afterEach, expect, test } from "bun:test";
import {
  appFeatureFlagStorageKey,
  DEFAULT_APP_FEATURE_FLAG_MODE,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

const BUILT_IN_SYSTEM_CONTAINERS_KEY = appFeatureFlagStorageKey(
  "built-in-system-containers",
);
const DOCUMENT_EDIT_RANGES_KEY = appFeatureFlagStorageKey(
  "document-edit-ranges",
);
const LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY = appFeatureFlagStorageKey(
  "linked-document-activation-controls",
);
const WORKSPACE_SWITCHER_KEY = appFeatureFlagStorageKey("workspace-switcher");

afterEach(() => {
  globalThis.localStorage.clear();
});

test("feature flags default to disabled when nothing is stored", () => {
  expect(DEFAULT_APP_FEATURE_FLAG_MODE).toBe("disabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
  expect(loadAppFeatureFlag(DOCUMENT_EDIT_RANGES_KEY)).toBe("disabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "disabled",
  );
  expect(loadAppFeatureFlag(WORKSPACE_SWITCHER_KEY)).toBe("disabled");
});

test("round-trips a saved feature flag", () => {
  saveAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY, "enabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("enabled");
  saveAppFeatureFlag(DOCUMENT_EDIT_RANGES_KEY, "enabled");
  expect(loadAppFeatureFlag(DOCUMENT_EDIT_RANGES_KEY)).toBe("enabled");
  saveAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY, "enabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "enabled",
  );
  saveAppFeatureFlag(WORKSPACE_SWITCHER_KEY, "enabled");
  expect(loadAppFeatureFlag(WORKSPACE_SWITCHER_KEY)).toBe("enabled");

  saveAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY, "disabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
  saveAppFeatureFlag(DOCUMENT_EDIT_RANGES_KEY, "disabled");
  expect(loadAppFeatureFlag(DOCUMENT_EDIT_RANGES_KEY)).toBe("disabled");
  saveAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY, "disabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "disabled",
  );
  saveAppFeatureFlag(WORKSPACE_SWITCHER_KEY, "disabled");
  expect(loadAppFeatureFlag(WORKSPACE_SWITCHER_KEY)).toBe("disabled");
});

test("feature flags fall back to disabled for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(BUILT_IN_SYSTEM_CONTAINERS_KEY, "bogus");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
});
