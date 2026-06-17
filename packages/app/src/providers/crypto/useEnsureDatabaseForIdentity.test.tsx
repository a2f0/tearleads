import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { useDatabase } from "../db/DatabaseProvider";
import { useEnsureDatabaseForIdentity } from "./useEnsureDatabaseForIdentity";

type DbStatus = ReturnType<typeof useDatabase>["status"];

function renderEnsure(initialStatus: DbStatus) {
  const ensureIdentityReady = mock(async () => {});
  const logError = mock(() => {});
  const view = renderHook(
    ({ status }: { status: DbStatus }) =>
      useEnsureDatabaseForIdentity(
        "fingerprint-a",
        status,
        ensureIdentityReady,
        logError,
      ),
    { initialProps: { status: initialStatus } },
  );
  return { ensureIdentityReady, logError, view };
}

test("boots once on the initial idle status", () => {
  const { ensureIdentityReady } = renderEnsure("idle");
  expect(ensureIdentityReady).toHaveBeenCalledTimes(1);
});

// Regression for the double-call bug: a retry on `error` calls ensureIdentityReady,
// which synchronously resets the runtime to `idle`. That `idle` re-render must NOT
// kick off a second boot for the same fingerprint.
test("does not re-boot when status returns to idle after the first boot", () => {
  const { ensureIdentityReady, view } = renderEnsure("idle");
  expect(ensureIdentityReady).toHaveBeenCalledTimes(1);

  // Simulate the synchronous reset-to-idle that ensureIdentityReady performs on a
  // retry (destroyCurrentRuntime("idle")): re-render with idle again.
  act(() => {
    view.rerender({ status: "idle" });
  });

  // Still exactly one boot — the bootedRef guard suppresses the redundant call.
  expect(ensureIdentityReady).toHaveBeenCalledTimes(1);
});

test("schedules exactly one retry per error transition (no double-call)", async () => {
  const { ensureIdentityReady, view } = renderEnsure("ready");
  expect(ensureIdentityReady).toHaveBeenCalledTimes(0);

  // A single error transition must schedule exactly one boot attempt — not two.
  // Before the fix, the synchronous idle-reset inside the retry produced a
  // duplicate call per error.
  act(() => {
    view.rerender({ status: "error" });
  });
  // Wait past the retry delay (750ms) for the scheduled attempt to fire.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  expect(ensureIdentityReady).toHaveBeenCalledTimes(1);
});

test("stops auto-retrying once the cap is reached (offline contract)", async () => {
  const { ensureIdentityReady, view } = renderEnsure("ready");

  // Drive several error transitions, each spaced past the retry delay. The hook
  // must stop scheduling new boots once the per-fingerprint cap (3) is hit, so
  // the status can settle to `error` for the manual Retry surface.
  for (let i = 0; i < 5; i++) {
    act(() => {
      view.rerender({ status: "ready" });
    });
    act(() => {
      view.rerender({ status: "error" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
  }

  expect(ensureIdentityReady.mock.calls.length).toBeLessThanOrEqual(3);
}, 15_000);

test("resets the retry budget when the fingerprint changes", () => {
  const ensureIdentityReady = mock(async () => {});
  const logError = mock(() => {});
  const view = renderHook(
    ({ fp, status }: { fp: string; status: DbStatus }) =>
      useEnsureDatabaseForIdentity(fp, status, ensureIdentityReady, logError),
    { initialProps: { fp: "fingerprint-a", status: "idle" as DbStatus } },
  );
  expect(ensureIdentityReady).toHaveBeenCalledTimes(1);

  // A new identity is a fresh boot, even though the status is idle again.
  act(() => {
    view.rerender({ fp: "fingerprint-b", status: "idle" });
  });
  expect(ensureIdentityReady).toHaveBeenCalledTimes(2);
});
