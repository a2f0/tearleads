import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useSyncExternalStore } from "react";
import { explorerDocumentQueryContainerId } from "../../../stores/explorer/orphanedDocuments";
import { usePrimeDiscoveredDocuments } from "../../../stores/explorer/primeDiscoveredDocuments";
import {
  cancelExplorerRefresh,
  explorerRefreshState,
  runExplorerRefresh,
  subscribeExplorerRefresh,
} from "../model/explorerRefreshRuns";
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

/**
 * Manual refresh and open catch-up both drive the reconciler's full-sweep
 * entry points, which share one in-flight sweep at the service layer. Route
 * them through one run here too, shared by every Explorer window of this
 * scope (`explorerRefreshRuns.ts`), so Refresh is disabled (via
 * isRefreshing) for the whole sweep in every window.
 *
 * Cancelling withdraws Explorer from the sweep at once. The reconciler stops
 * the sweep at its next safe boundary only if no other caller, such as the
 * reconnect catch-up, still waits on it.
 */
export function useExplorerRefreshActions(
  reconciler: ExplorerModelExplorer["reconciler"],
  logError: (message: string | Error, cause?: unknown) => void,
) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeExplorerRefresh(reconciler, listener),
    [reconciler],
  );
  const state = useSyncExternalStore(subscribe, () =>
    explorerRefreshState(reconciler),
  );

  const handleRefresh = useCallback(
    (): Promise<boolean> =>
      runExplorerRefresh({
        key: reconciler,
        logError,
        scope: "full",
        sweep: (signal) => reconciler.reconcileNow({ signal }),
      }),
    [logError, reconciler],
  );

  const handleOpenCatchup = useCallback(
    (): Promise<boolean> =>
      runExplorerRefresh({
        key: reconciler,
        logError,
        scope: "root",
        sweep: (signal) => reconciler.reconcileRootContainersNow({ signal }),
      }),
    [logError, reconciler],
  );

  const handleCancelRefresh = useCallback(() => {
    cancelExplorerRefresh(reconciler);
  }, [reconciler]);

  return {
    handleCancelRefresh,
    handleOpenCatchup,
    handleRefresh,
    isRefreshing: state.status === "refreshing",
    refreshError: state.status === "failed" ? state.message : null,
  };
}
