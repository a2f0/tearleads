import { afterEach, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  DeveloperModeProvider,
  developerModeStorageKey,
  loadDeveloperMode,
  saveDeveloperMode,
  useDeveloperMode,
} from "./DeveloperModeProvider";

afterEach(() => {
  globalThis.localStorage.clear();
});

function wrapper({ children }: PropsWithChildren) {
  return <DeveloperModeProvider>{children}</DeveloperModeProvider>;
}

test("keeps the storage key System Monitor persisted the setting under", () => {
  expect(developerModeStorageKey()).toBe(
    "tearleads.system-monitor:developer-mode",
  );
});

test("defaults to disabled and ignores an unrecognized stored value", () => {
  expect(loadDeveloperMode()).toBe("disabled");
  globalThis.localStorage.setItem(developerModeStorageKey(), "bogus");
  expect(loadDeveloperMode()).toBe("disabled");
});

test("round-trips a saved developer mode", () => {
  saveDeveloperMode("enabled");
  expect(loadDeveloperMode()).toBe("enabled");
  saveDeveloperMode("disabled");
  expect(loadDeveloperMode()).toBe("disabled");
});

test("the provider reads the stored setting and persists toggles", () => {
  saveDeveloperMode("enabled");
  const { result } = renderHook(() => useDeveloperMode(), { wrapper });
  expect(result.current.isDeveloperMode).toBe(true);
  act(() => result.current.toggleDeveloperMode());
  expect(result.current.isDeveloperMode).toBe(false);
  expect(loadDeveloperMode()).toBe("disabled");
});

test("useDeveloperMode requires its provider", () => {
  expect(() => renderHook(() => useDeveloperMode())).toThrow(
    "useDeveloperMode must be used within a DeveloperModeProvider.",
  );
});
