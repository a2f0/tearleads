import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isDestroyedDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { usePrimeDiscoveredDocuments } from "../../../stores/explorer/primeDiscoveredDocuments";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

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
  onDocumentLinksChanged: () => void;
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

  // Tell the device-first view which container is active so the reconciler
  // syncs it first; summaries for it load synchronously from the local cache.
  useEffect(() => {
    view.setActiveContainer(activeContainerId);
  }, [activeContainerId, view]);

  // Subscribe to the view: whenever the local cache or a reconciled delta
  // changes, surface the active container's summaries into the explorer view
  // model and bump the document link projection so the sidebar/table re-read
  // their windows from SQLite. This replaces the old render-driven discovery.
  const primedSummaryListsRef = useRef(new WeakSet<ReadonlyArray<unknown>>());
  const lastActiveSummariesRef = useRef<ReadonlyArray<DocumentSummary> | null>(
    null,
  );
  useEffect(() => {
    const applyFromView = () => {
      const summariesMap = view.getSnapshot().documentSummariesByContainerId;

      // Prime document stores for every container whose summaries are new, so
      // discovered documents sync their content (and titles) even when they
      // land outside the active container. Each summary-list instance is primed
      // once; the local projection only swaps the list when it changes.
      for (const summaries of summariesMap.values()) {
        if (
          summaries.length > 0 &&
          !primedSummaryListsRef.current.has(summaries)
        ) {
          primedSummaryListsRef.current.add(summaries);
          primeDiscoveredDocuments(summaries);
        }
      }

      const activeSummaries = activeContainerId
        ? (summariesMap.get(activeContainerId) ?? [])
        : [];
      if (lastActiveSummariesRef.current !== activeSummaries) {
        lastActiveSummariesRef.current = activeSummaries;
        mergeDocumentSummaries(activeSummaries);
      }
      // Always nudge the link projection so windowed queries refresh for the
      // container currently rendered, including newly discovered documents.
      onDocumentLinksChanged();
    };

    applyFromView();
    return view.subscribe(applyFromView);
  }, [
    activeContainerId,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    view,
  ]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const handleRefresh = useCallback((): Promise<boolean> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    setRefreshError(null);
    setIsRefreshing(true);
    const refreshPromise = reconciler
      .reconcileNow()
      .then(() => true)
      .catch((error: unknown) => {
        if (!isDestroyedDatabaseWorkerError(error)) {
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
  }, [reconciler]);

  return { handleRefresh, isRefreshing, refreshError };
}
