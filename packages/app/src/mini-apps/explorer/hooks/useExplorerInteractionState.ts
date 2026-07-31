import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { explorerDocumentQueryContainerId } from "../../../stores/explorer/orphanedDocuments";
import { usePrimeDiscoveredDocuments } from "../../../stores/explorer/primeDiscoveredDocuments";
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
  appData: RuntimeSnapshot;
  explorer: ExplorerModelExplorer;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
  } = params;
  const { reconciler, view } = explorer;
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({ appData });

  useExplorerViewProjectionSync({
    activeContainerId: explorerDocumentQueryContainerId(activeContainerId),
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    view,
  });

  return useExplorerRefreshActions(reconciler);
}

/**
 * Manual refresh and open catch-up both drive the reconciler's full-sweep
 * entry points, which share one in-flight sweep at the service layer. Route
 * them through one in-flight ref here too so the Refresh menu item is disabled
 * (via isRefreshing) for the whole sweep — a manual refresh cannot start while
 * an auto catch-up is still running, and vice versa.
 */
function useExplorerRefreshActions(
  reconciler: ExplorerModelExplorer["reconciler"],
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const runSweep = useCallback(
    (sweep: () => Promise<void>): Promise<boolean> => {
      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      setRefreshError(null);
      setIsRefreshing(true);
      const refreshPromise = sweep()
        .then(() => true)
        .catch((error: unknown) => {
          if (!isIgnorableDatabaseWorkerError(error)) {
            console.error("Failed to refresh explorer:", error);
            setRefreshError("Failed to refresh explorer.");
          }
          return false;
        })
        .finally(() => {
          if (refreshPromiseRef.current === refreshPromise) {
            refreshPromiseRef.current = null;
            setIsRefreshing(false);
          }
        });

      refreshPromiseRef.current = refreshPromise;
      return refreshPromise;
    },
    [],
  );

  const handleRefresh = useCallback(
    (): Promise<boolean> => runSweep(() => reconciler.reconcileNow()),
    [reconciler, runSweep],
  );

  const handleOpenCatchup = useCallback(
    (): Promise<boolean> =>
      runSweep(() => reconciler.reconcileRootContainersNow()),
    [reconciler, runSweep],
  );

  return { handleOpenCatchup, handleRefresh, isRefreshing, refreshError };
}
