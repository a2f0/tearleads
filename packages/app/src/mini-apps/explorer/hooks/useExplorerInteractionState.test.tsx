import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useExplorerRefreshActions } from "./useExplorerInteractionState";

afterEach(cleanup);

type Reconciler = ExplorerModelExplorer["reconciler"];

/** A reconciler whose sweeps run until the caller's signal withdraws them. */
function pendingReconciler() {
  const signals: AbortSignal[] = [];
  const sweep = ({ signal }: { signal?: AbortSignal } = {}) =>
    new Promise<void>((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  const reconciler = {
    reconcileNow: sweep,
    reconcileRootContainersNow: sweep,
  } as unknown as Reconciler;
  return { reconciler, signals };
}

// A scope change replaces the reconciler. The old scope's run must neither
// keep Refresh busy nor make the new scope's refresh join it.
test("replacing the reconciler withdraws from the old scope's refresh", async () => {
  const first = pendingReconciler();
  const second = pendingReconciler();
  const logError = () => undefined;
  const { result, rerender } = renderHook(
    ({ reconciler }) => useExplorerRefreshActions(reconciler, logError),
    { initialProps: { reconciler: first.reconciler } },
  );

  let firstRun: Promise<boolean> = Promise.resolve(true);
  act(() => {
    firstRun = result.current.handleRefresh();
  });
  expect(result.current.isRefreshing).toBe(true);

  rerender({ reconciler: second.reconciler });
  expect(result.current.isRefreshing).toBe(false);
  expect(first.signals[0]?.aborted).toBe(true);
  await act(async () => {
    expect(await firstRun).toBe(false);
  });
  expect(result.current.refreshError).toBeNull();

  act(() => {
    void result.current.handleRefresh();
  });
  expect(second.signals).toHaveLength(1);
  expect(result.current.isRefreshing).toBe(true);
});

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Closing Explorer must withdraw it from the shared refresh, or its abandoned
// caller keeps the refresh running past a reopened Explorer's Cancel.
// StrictMode's simulated unmount and remount must not withdraw the open
// catch-up that the mount started.
test("unmounting withdraws the run; a StrictMode remount keeps it", async () => {
  const { reconciler, signals } = pendingReconciler();
  const logError = () => undefined;
  const { result, unmount } = renderHook(
    () => {
      const actions = useExplorerRefreshActions(reconciler, logError);
      const { handleOpenCatchup } = actions;
      useEffect(() => {
        void handleOpenCatchup();
      }, [handleOpenCatchup]);
      return actions;
    },
    { wrapper: StrictMode },
  );

  await act(nextMacrotask);
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(false);
  expect(result.current.isRefreshing).toBe(true);

  unmount();
  await nextMacrotask();
  expect(signals[0]?.aborted).toBe(true);
});
