import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
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
