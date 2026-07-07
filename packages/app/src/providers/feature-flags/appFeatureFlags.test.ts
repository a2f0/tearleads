import { afterEach, expect, test } from "bun:test";
import {
  appFeatureFlagStorageKey,
  DEFAULT_APP_FEATURE_FLAG_MODE,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

const PASSKEYS_KEY = appFeatureFlagStorageKey("passkeys");
const LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY = appFeatureFlagStorageKey(
  "linked-document-activation-controls",
);

afterEach(() => {
  globalThis.localStorage.clear();
});

test("feature flags default to disabled when nothing is stored", () => {
  expect(DEFAULT_APP_FEATURE_FLAG_MODE).toBe("disabled");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("disabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "disabled",
  );
});

test("round-trips a saved feature flag", () => {
  saveAppFeatureFlag(PASSKEYS_KEY, "enabled");
  expect(loadAppFeatureFlag(PASSKEYS_KEY)).toBe("enabled");
  saveAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY, "enabled");
  expect(loadAppFeatureFlag(LINKED_DOCUMENT_ACTIVATION_CONTROLS_KEY)).toBe(
    "enabled",
  );

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
