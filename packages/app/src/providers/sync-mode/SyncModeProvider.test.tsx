import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { SyncModeProvider, useSyncMode } from "./SyncModeProvider";
import { loadSyncMode, saveSyncMode } from "./syncModePreference";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

type SyncModeValue = ReturnType<typeof useSyncMode>;

function renderSyncMode() {
  let latest: SyncModeValue | null = null;
  function Probe() {
    latest = useSyncMode();
    return null;
  }
  render(
    <SyncModeProvider>
      <Probe />
    </SyncModeProvider>,
  );
  if (!latest) {
    throw new Error("SyncMode context was not captured.");
  }
  return () => {
    if (!latest) {
      throw new Error("SyncMode context was not captured.");
    }
    return latest;
  };
}

test("defaults to sync mode when nothing is persisted", () => {
  const get = renderSyncMode();
  expect(get().mode).toBe("sync");
  expect(get().syncEnabled).toBe(true);
});

test("initializes from the persisted preference", () => {
  saveSyncMode("local-only");
  const get = renderSyncMode();
  expect(get().mode).toBe("local-only");
  expect(get().syncEnabled).toBe(false);
});

test("setMode updates the context and persists the choice", () => {
  const get = renderSyncMode();

  act(() => {
    get().setMode("local-only");
  });
  expect(get().mode).toBe("local-only");
  expect(get().syncEnabled).toBe(false);
  expect(loadSyncMode()).toBe("local-only");

  act(() => {
    get().setMode("sync");
  });
  expect(get().mode).toBe("sync");
  expect(get().syncEnabled).toBe(true);
  expect(loadSyncMode()).toBe("sync");
});
