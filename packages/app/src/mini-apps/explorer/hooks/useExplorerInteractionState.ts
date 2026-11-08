import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useReducer, useRef } from "react";
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

type ExplorerRunOutcome =
  | { readonly type: "succeeded" | "interrupted" | "cancelled" }
  | { readonly type: "failed"; readonly message: string };

interface ExplorerRefreshRun {
  readonly controller: AbortController;
  /** How the run ended; never rejects. */
  readonly outcome: Promise<ExplorerRunOutcome>;
  readonly request: object;
}

const REFRESH_FAILED_MESSAGE = "Failed to refresh explorer.";

/**
 * Explorer's running refresh, kept per reconciler rather than per mounted
 * Explorer. Closing Explorer leaves it running, so an open catch-up still
 * completes for its scope; a remounted or reopened Explorer shows it as
 * running, and its Cancel reaches it.
 */
const explorerRuns = new WeakMap<ExplorerReconciler, ExplorerRefreshRun>();

function startExplorerRun(
  reconciler: ExplorerReconciler,
  sweep: (signal: AbortSignal) => Promise<void>,
  logError: (message: string | Error, cause?: unknown) => void,
): ExplorerRefreshRun {
  const controller = new AbortController();
  const outcome = sweep(controller.signal).then(
    (): ExplorerRunOutcome => ({ type: "succeeded" }),
    (error: unknown): ExplorerRunOutcome => {
      if (controller.signal.aborted) {
        return { type: "cancelled" };
      }
      if (isIgnorableDatabaseWorkerError(error)) {
        return { type: "interrupted" };
      }
      logError("Failed to refresh explorer", error);
      return { type: "failed", message: REFRESH_FAILED_MESSAGE };
    },
  );
  const run = { controller, outcome, request: {} };
  explorerRuns.set(reconciler, run);
  void outcome.then(() => {
    if (explorerRuns.get(reconciler) === run) {
      explorerRuns.delete(reconciler);
    }
  });
  return run;
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
 * reconnect catch-up, still waits on it. A scope change replaces the
 * reconciler: the old scope's run then neither blocks this scope's refresh
 * nor reports into it.
 */
export function useExplorerRefreshActions(
  reconciler: ExplorerReconciler,
  logError: (message: string | Error, cause?: unknown) => void,
) {
  const [state, dispatch] = useReducer(
    transitionExplorerRefresh,
    IDLE_EXPLORER_REFRESH,
  );
  // The run this Explorer shows, and the reconciler it belongs to.
  const shownRef = useRef<{
    readonly reconciler: ExplorerReconciler;
    readonly run: ExplorerRefreshRun;
  } | null>(null);

  const show = useCallback(
    (run: ExplorerRefreshRun) => {
      if (shownRef.current?.run === run) {
        return;
      }
      shownRef.current = { reconciler, run };
      const { request } = run;
      dispatch({ type: "started", request });
      void run.outcome.then((outcome) => {
        dispatch(
          outcome.type === "failed"
            ? { message: outcome.message, request, type: "failed" }
            : { request, type: outcome.type },
        );
      });
    },
    [reconciler],
  );

  useEffect(() => {
    const shown = shownRef.current;
    if (shown && shown.reconciler !== reconciler) {
      shownRef.current = null;
      dispatch({ type: "cancelled", request: shown.run.request });
    }
    const run = explorerRuns.get(reconciler);
    if (run) {
      show(run);
    }
  }, [reconciler, show]);

  const runSweep = useCallback(
    (sweep: (signal: AbortSignal) => Promise<void>): Promise<boolean> => {
      const run =
        explorerRuns.get(reconciler) ??
        startExplorerRun(reconciler, sweep, logError);
      show(run);
      return run.outcome.then((outcome) => outcome.type === "succeeded");
    },
    [logError, reconciler, show],
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
    const run = explorerRuns.get(reconciler);
    if (!run) {
      return;
    }
    explorerRuns.delete(reconciler);
    dispatch({ type: "cancelled", request: run.request });
    run.controller.abort(
      new DOMException("Explorer refresh cancelled", "AbortError"),
    );
  }, [reconciler]);

  return {
    handleCancelRefresh,
    handleOpenCatchup,
    handleRefresh,
    isRefreshing: state.status === "refreshing",
    refreshError: state.status === "failed" ? state.message : null,
  };
}
