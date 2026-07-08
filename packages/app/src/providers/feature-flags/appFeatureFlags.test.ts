import { afterEach, expect, test } from "bun:test";
import {
  appFeatureFlagStorageKey,
  DEFAULT_APP_FEATURE_FLAG_MODE,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

const PASSKEYS_KEY = appFeatureFlagStorageKey("passkeys");
const BUILT_IN_SYSTEM_CONTAINERS_KEY = appFeatureFlagStorageKey(
  "built-in-system-containers",
);
const LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY = appFeatureFlagStorageKey(
  "linked-document-activation-controls",
);

afterEach(() => {
  globalThis.localStorage.clear();
});

test("feature flags default to disabled when nothing is stored", () => {
  expect(DEFAULT_APP_FEATURE_FLAG_MODE).toBe("disabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("disabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "disabled",
  );
});

test("round-trips a saved feature flag", () => {
  saveAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY, "enabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("enabled");
  saveAppFeatureFlag(PASSKEYS_KEY, "enabled");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("enabled");
  saveAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY, "enabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "enabled",
  );

  saveAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY, "disabled");
  expect(loadAppFeatureFlag(BUILT_IN_SYSTEM_CONTAINERS_KEY)).toBe("disabled");
  saveAppFeatureFlag(PASSKEYS_KEY, "disabled");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("disabled");
  saveAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY, "disabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "disabled",
  );
});

test("feature flags fall back to disabled for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(PASSKEYS_KEY, "bogus");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("disabled");
});
