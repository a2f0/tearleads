import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  type RefObject,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { explorerDocumentQueryContainerId } from "../../../stores/explorer/orphanedDocuments";
import { usePrimeDiscoveredDocuments } from "../../../stores/explorer/primeDiscoveredDocuments";
import {
  IDLE_EXPLORER_REFRESH,
  transitionExplorerRefresh,
} from "../model/explorerRefreshMachine";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useExplorerViewProjectionSync } from "./useExplorerViewProjectionSync";

/**
 * Device-first interaction state for the explorer.
 *
 * Document summaries come from the local projection view (Layer A) and are kept
 * fresh by the background reconciler (Layer B). This hook no longer drives any
 * network from a render effect — it only tells the view which container is
 * active and merges the cached/reconciled summaries into the view model.
 */
export function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  explorer: ExplorerModelExplorer;
  logError: (message: string | Error, cause?: unknown) => void;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
}) {
  const {
    activeContainerId,
    explorer,
    logError,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
  } = params;
  const { reconciler, view } = explorer;
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments();

  useExplorerViewProjectionSync({
    activeContainerId: explorerDocumentQueryContainerId(activeContainerId),
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    view,
  });

  return useExplorerRefreshActions(reconciler, logError);
}

type ExplorerReconciler = ExplorerModelExplorer["reconciler"];

interface ExplorerRefreshRun {
  readonly controller: AbortController;
  readonly promise: Promise<boolean>;
  readonly reconciler: ExplorerReconciler;
  readonly request: object;
}

const REFRESH_FAILED_MESSAGE = "Failed to refresh explorer.";

/**
 * Withdraws Explorer's run once it stops being Explorer's. A scope change
 * replaces the reconciler; keyed on it, so StrictMode's remount of the same
 * one keeps the run. Closing Explorer withdraws too, or its abandoned caller
 * would keep a shared refresh running past a later Explorer's Cancel. That
 * withdrawal waits one macrotask: StrictMode unmounts and remounts in the
 * same tick, and the remount cancels it.
 */
function useWithdrawAbandonedRun(
  runRef: RefObject<ExplorerRefreshRun | null>,
  reconciler: ExplorerReconciler,
  withdraw: (run: ExplorerRefreshRun) => void,
): void {
  useEffect(() => {
    const run = runRef.current;
    if (run && run.reconciler !== reconciler) {
      withdraw(run);
    }
  }, [reconciler, runRef, withdraw]);

  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (unmountTimerRef.current !== null) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    return () => {
      unmountTimerRef.current = setTimeout(() => {
        unmountTimerRef.current = null;
        const run = runRef.current;
        if (run) {
          withdraw(run);
        }
      }, 0);
    };
  }, [runRef, withdraw]);
}

/**
 * Manual refresh and open catch-up both drive the reconciler's full-sweep
 * entry points, which share one in-flight sweep at the service layer. Route
 * them through one run here too so the Refresh menu item is disabled (via
 * isRefreshing) for the whole sweep — a manual refresh cannot start while an
 * auto catch-up is still running, and vice versa.
 *
 * Cancelling withdraws Explorer from the sweep at once. The reconciler stops
 * the sweep at its next safe boundary only if no other caller, such as the
 * reconnect catch-up, still waits on it. A run belongs to its reconciler: a
 * scope change withdraws from the old scope's run, so it neither blocks this
 * scope's refresh nor reports into it.
 */
export function useExplorerRefreshActions(
  reconciler: ExplorerReconciler,
  logError: (message: string | Error, cause?: unknown) => void,
) {
  const [state, dispatch] = useReducer(
    transitionExplorerRefresh,
    IDLE_EXPLORER_REFRESH,
  );
  // Mirrors the running run, so a second request before the next render joins
  // it instead of starting another, and so cancel reaches its controller.
  const runRef = useRef<ExplorerRefreshRun | null>(null);

  const withdraw = useCallback((run: ExplorerRefreshRun) => {
    if (runRef.current === run) {
      runRef.current = null;
    }
    dispatch({ type: "cancelled", request: run.request });
    run.controller.abort(
      new DOMException("Explorer refresh cancelled", "AbortError"),
    );
  }, []);

  useWithdrawAbandonedRun(runRef, reconciler, withdraw);

  const runSweep = useCallback(
    (sweep: (signal: AbortSignal) => Promise<void>): Promise<boolean> => {
      const current = runRef.current;
      if (current?.reconciler === reconciler) {
        return current.promise;
      }
      if (current) {
        withdraw(current);
      }

      const request = {};
      const controller = new AbortController();
      dispatch({ type: "started", request });
      const promise = sweep(controller.signal)
        .then(() => {
          dispatch({ type: "succeeded", request });
          return true;
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return false;
          }
          if (isIgnorableDatabaseWorkerError(error)) {
            dispatch({ type: "interrupted", request });
          } else {
            logError("Failed to refresh explorer", error);
            dispatch({
              type: "failed",
              message: REFRESH_FAILED_MESSAGE,
              request,
            });
          }
          return false;
        })
        .finally(() => {
          if (runRef.current?.request === request) {
            runRef.current = null;
          }
        });

      runRef.current = { controller, promise, reconciler, request };
      return promise;
    },
    [logError, reconciler, withdraw],
  );

  const handleRefresh = useCallback(
    (): Promise<boolean> =>
      runSweep((signal) => reconciler.reconcileNow({ signal })),
    [reconciler, runSweep],
  );

  const handleOpenCatchup = useCallback(
    (): Promise<boolean> =>
      runSweep((signal) => reconciler.reconcileRootContainersNow({ signal })),
    [reconciler, runSweep],
  );

  const handleCancelRefresh = useCallback(() => {
    const run = runRef.current;
    if (run) {
      withdraw(run);
    }
  }, [withdraw]);

  return {
    handleCancelRefresh,
    handleOpenCatchup,
    handleRefresh,
    isRefreshing: state.status === "refreshing",
    refreshError: state.status === "failed" ? state.message : null,
  };
}
