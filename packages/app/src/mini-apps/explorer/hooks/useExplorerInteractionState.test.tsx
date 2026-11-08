import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useExplorerRefreshActions } from "./useExplorerInteractionState";

afterEach(cleanup);

type Reconciler = ExplorerModelExplorer["reconciler"];

/**
 * A reconciler whose sweeps run until the caller's signal withdraws them or
 * the test fails them.
 */
function pendingReconciler() {
  const signals: AbortSignal[] = [];
  const failures: Array<(error: Error) => void> = [];
  const sweep = ({ signal }: { signal?: AbortSignal } = {}) =>
    new Promise<void>((_resolve, reject) => {
      failures.push(reject);
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
  const failAll = (error: Error) => {
    for (const fail of failures) fail(error);
  };
  return { failAll, reconciler, signals };
}

const logError = () => undefined;

// A scope change replaces the reconciler. The old scope's run must neither
// keep Refresh busy, nor make the new scope's refresh join it, nor report its
// late failure into the new scope.
test("a replaced reconciler's run neither blocks nor reports", async () => {
  const first = pendingReconciler();
  const second = pendingReconciler();
  const { result, rerender } = renderHook(
    ({ reconciler }) => useExplorerRefreshActions(reconciler, logError),
    { initialProps: { reconciler: first.reconciler } },
  );

  act(() => {
    void result.current.handleRefresh();
  });
  expect(result.current.isRefreshing).toBe(true);

  rerender({ reconciler: second.reconciler });
  expect(result.current.isRefreshing).toBe(false);
  act(() => {
    void result.current.handleRefresh();
  });
  expect(second.signals).toHaveLength(1);
  expect(result.current.isRefreshing).toBe(true);

  await act(async () => {
    first.failAll(new Error("old scope failed"));
  });
  expect(result.current.refreshError).toBeNull();
  expect(result.current.isRefreshing).toBe(true);
});

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Closing Explorer must not abandon the open catch-up, which runs once per
// scope; and a reopened Explorer must show the run and be able to cancel it,
// or an orphaned caller would keep the shared refresh going past Cancel.
test("a reopened Explorer shows and cancels the run a closed one began", async () => {
  const { reconciler, signals } = pendingReconciler();
  const opened = renderHook(
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
  expect(opened.result.current.isRefreshing).toBe(true);

  opened.unmount();
  await nextMacrotask();
  expect(signals[0]?.aborted).toBe(false);

  const reopened = renderHook(() =>
    useExplorerRefreshActions(reconciler, logError),
  );
  expect(reopened.result.current.isRefreshing).toBe(true);
  await act(async () => {
    reopened.result.current.handleCancelRefresh();
  });
  expect(signals[0]?.aborted).toBe(true);
  expect(reopened.result.current.isRefreshing).toBe(false);
});
