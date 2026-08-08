import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  AppFeatureFlagsProvider,
  useAppFeatureFlags,
} from "./AppFeatureFlagsProvider";
import {
  APP_FEATURE_FLAG_IDS,
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

type AppFeatureFlagsValue = ReturnType<typeof useAppFeatureFlags>;

function FeatureFlagProbe({
  capture,
}: {
  capture: (value: AppFeatureFlagsValue) => void;
}) {
  capture(useAppFeatureFlags());
  return null;
}

function captured(value: AppFeatureFlagsValue | null): AppFeatureFlagsValue {
  if (!value) {
    throw new Error("Feature flag context was not captured.");
  }
  return value;
}

test("the no-provider value keeps every feature disabled", () => {
  let value: AppFeatureFlagsValue | null = null;
  render(<FeatureFlagProbe capture={(next) => (value = next)} />);

  for (const flag of APP_FEATURE_FLAG_IDS) {
    expect(captured(value).isEnabled(flag)).toBe(false);
  }

  act(() => {
    captured(value).setEnabled("workspace-switcher", true);
  });
  expect(
    globalThis.localStorage.getItem(
      appFeatureFlagStorageKey("workspace-switcher"),
    ),
  ).toBeNull();
});

test("nested providers share one persistent feature-flag value", () => {
  for (const flag of APP_FEATURE_FLAG_IDS) {
    saveAppFeatureFlag(appFeatureFlagStorageKey(flag), "enabled");
  }
  let outer: AppFeatureFlagsValue | null = null;
  let inner: AppFeatureFlagsValue | null = null;
  render(
    <AppFeatureFlagsProvider>
      <FeatureFlagProbe capture={(value) => (outer = value)} />
      <AppFeatureFlagsProvider>
        <FeatureFlagProbe capture={(value) => (inner = value)} />
      </AppFeatureFlagsProvider>
    </AppFeatureFlagsProvider>,
  );

  expect(outer).toBe(inner);
  for (const flag of APP_FEATURE_FLAG_IDS) {
    expect(captured(inner).isEnabled(flag)).toBe(true);
  }

  act(() => {
    captured(inner).setEnabled("workspace-switcher", false);
  });
  expect(outer).toBe(inner);
  expect(captured(outer).isEnabled("workspace-switcher")).toBe(false);
  expect(
    globalThis.localStorage.getItem(
      appFeatureFlagStorageKey("workspace-switcher"),
    ),
  ).toBe("disabled");
});
