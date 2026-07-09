import type {
  DocumentSummary,
  LocalProjectionView,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { computeContainerMembershipSignature } from "../../../stores/explorer/documentSummaryUtils";
import { usePrimeDiscoveredDocuments } from "../../../stores/explorer/primeDiscoveredDocuments";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

// Priming a discovered document opens its store in the SDK's module-level cache,
// which lives above the routed-pane remount boundary. Tracking which summary-list
// instances have already been primed in a per-mount ref re-primed every document
// each time the compact/mobile breakpoint remounted Explorer. Key the tracking by
// the persistent projection view instead, so it survives those remounts and
// rotates automatically when the domain scope (and its view) changes.
const primedSummaryListsByView = new WeakMap<
  LocalProjectionView,
  WeakSet<ReadonlyArray<unknown>>
>();

function primedSummaryListsForView(
  view: LocalProjectionView,
): WeakSet<ReadonlyArray<unknown>> {
  let primed = primedSummaryListsByView.get(view);
  if (!primed) {
    primed = new WeakSet();
    primedSummaryListsByView.set(view, primed);
  }
  return primed;
}

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

  useExplorerViewProjectionSync({
    activeContainerId,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    view,
  });

  return useExplorerRefreshActions(reconciler);
}

/**
 * Sync the local projection view into the explorer view model.
 *
 * Split out of {@link useExplorerInteractionState} so the flicker-prone gating
 * can be exercised without the SDK provider that priming needs: `view` is a
 * fake, and `primeDiscoveredDocuments` / the merge + link-change callbacks are
 * plain functions here rather than the provider-backed hooks the parent wires.
 * Behaviour is identical to the inlined effects it replaced.
 */
export function useExplorerViewProjectionSync(params: {
  activeContainerId: string | null;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: () => void;
  primeDiscoveredDocuments: (
    discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>,
  ) => void;
  view: LocalProjectionView;
}) {
  const {
    activeContainerId,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    view,
  } = params;

  // Tell the device-first view which container is active so the reconciler
  // syncs it first; summaries for it load synchronously from the local cache.
  useEffect(() => {
    view.setActiveContainer(activeContainerId);
  }, [activeContainerId, view]);

  // Subscribe to the view: whenever the local cache or a reconciled delta
  // changes, surface the active container's summaries into the explorer view
  // model and bump the document link projection so the sidebar/table re-read
  // their windows from SQLite. This replaces the old render-driven discovery.
  const lastActiveSummariesRef = useRef<ReadonlyArray<DocumentSummary> | null>(
    null,
  );
  // Signature of container -> document-id membership at the last view apply. The
  // link projection is the DESTRUCTIVE sidebar/table refresh (it clears rows to a
  // loading state and resets totalCount), so it must be bumped only when
  // membership actually changes — discovery, move, delete. The view fires on every
  // reconciled delta during bootstrap (sync badges, title/content updates) with
  // membership unchanged; bumping the link projection on those blanked and reloaded
  // the "You" contact and system-folder rows ~once per tick (the reported flicker).
  const lastLinkSignatureRef = useRef<string | null>(null);
  // Primed document stores are tracked per view (module scope) and need no reset.
  const lastViewRef = useRef(view);
  useEffect(() => {
    // When the view (domain scope) rotates, reset the per-mount active-summaries +
    // membership tracking so the new scope re-merges and re-signatures. Done here in
    // the effect (commit phase) rather than during render — render-phase ref writes
    // can double-run under StrictMode / concurrent rendering.
    if (lastViewRef.current !== view) {
      lastViewRef.current = view;
      lastActiveSummariesRef.current = null;
      lastLinkSignatureRef.current = null;
    }
    const primedSummaryLists = primedSummaryListsForView(view);
    const applyFromView = () => {
      const summariesMap = view.getSnapshot().documentSummariesByContainerId;

      // Prime document stores for every container whose summaries are new, so
      // discovered documents sync their content (and titles) even when they
      // land outside the active container. Each summary-list instance is primed
      // once per view; the local projection only swaps the list when it changes.
      for (const summaries of summariesMap.values()) {
        if (summaries.length > 0 && !primedSummaryLists.has(summaries)) {
          primedSummaryLists.add(summaries);
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
      // Nudge the link projection so windowed queries refresh for newly discovered
      // documents — but only when the container -> document membership actually
      // changed. This is the DESTRUCTIVE refresh (it clears rows), so firing it on
      // a view delta that merely updated summary content is what re-blanked the
      // sidebar rows every sync tick during bootstrap. Content-only updates still
      // refresh non-destructively via documentListRevision.
      const linkSignature = computeContainerMembershipSignature(summariesMap);
      if (lastLinkSignatureRef.current !== linkSignature) {
        lastLinkSignatureRef.current = linkSignature;
        onDocumentLinksChanged();
      }
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
