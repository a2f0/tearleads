import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useExplorerRefreshActions } from "./useExplorerInteractionState";

afterEach(cleanup);

type Reconciler = ExplorerModelExplorer["reconciler"];

interface PendingSweep {
  readonly fail: (error: Error) => void;
  readonly scope: "full" | "root";
  readonly signal: AbortSignal;
}

/**
 * A reconciler whose sweeps run until the caller's signal withdraws them or
 * the test fails them.
 */
function pendingReconciler() {
  const sweeps: PendingSweep[] = [];
  const sweep =
    (scope: PendingSweep["scope"]) =>
    ({ signal }: { signal?: AbortSignal } = {}) =>
      new Promise<void>((_resolve, reject) => {
        if (!signal) throw new Error("Explorer always passes a signal");
        sweeps.push({ fail: reject, scope, signal });
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
  const reconciler = {
    reconcileNow: sweep("full"),
    reconcileRootContainersNow: sweep("root"),
  } as unknown as Reconciler;
  return { reconciler, sweeps };
}

const logError = () => undefined;

function renderExplorer(reconciler: Reconciler) {
  return renderHook(() => useExplorerRefreshActions(reconciler, logError));
}

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
  expect(second.sweeps).toHaveLength(1);
  expect(result.current.isRefreshing).toBe(true);

  await act(async () => {
    first.sweeps[0]?.fail(new Error("old scope failed"));
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
  const { reconciler, sweeps } = pendingReconciler();
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
  expect(sweeps).toHaveLength(1);
  expect(opened.result.current.isRefreshing).toBe(true);

  opened.unmount();
  await nextMacrotask();
  expect(sweeps[0]?.signal.aborted).toBe(false);

  const reopened = renderExplorer(reconciler);
  expect(reopened.result.current.isRefreshing).toBe(true);
  await act(async () => {
    reopened.result.current.handleCancelRefresh();
  });
  expect(sweeps[0]?.signal.aborted).toBe(true);
  expect(reopened.result.current.isRefreshing).toBe(false);
});

// Two Explorer windows share one scope. A catch-up one starts shows in both;
// a full refresh asked for in the other replaces the root-only catch-up
// rather than joining it; and either window's Cancel stops it for both.
test("Explorer windows of one scope share the refresh", async () => {
  const { reconciler, sweeps } = pendingReconciler();
  const left = renderExplorer(reconciler);
  const right = renderExplorer(reconciler);

  act(() => {
    void left.result.current.handleOpenCatchup();
  });
  expect(right.result.current.isRefreshing).toBe(true);

  act(() => {
    void right.result.current.handleRefresh();
  });
  expect(sweeps.map(({ scope }) => scope)).toEqual(["root", "full"]);
  expect(sweeps[0]?.signal.aborted).toBe(true);
  expect(left.result.current.isRefreshing).toBe(true);

  await act(async () => {
    left.result.current.handleCancelRefresh();
  });
  expect(sweeps[1]?.signal.aborted).toBe(true);
  expect(left.result.current.isRefreshing).toBe(false);
  expect(right.result.current.isRefreshing).toBe(false);
});
