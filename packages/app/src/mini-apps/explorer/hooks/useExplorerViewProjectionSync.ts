import type {
  DocumentSummary,
  LocalProjectionView,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import {
  computeContainerMembershipSignatures,
  diffChangedContainerIds,
} from "../../../stores/explorer/documentSummaryUtils";

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

function primeNewSummaryLists(
  summaryLists: Iterable<ReadonlyArray<DocumentSummary>>,
  primedSummaryLists: WeakSet<ReadonlyArray<unknown>>,
  primeDiscoveredDocuments: (
    discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>,
  ) => void,
): void {
  for (const summaries of summaryLists) {
    if (summaries.length > 0 && !primedSummaryLists.has(summaries)) {
      primedSummaryLists.add(summaries);
      primeDiscoveredDocuments(summaries);
    }
  }
}

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

function trackContainerSignatures(
  previous: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> | null {
  return previous === null && next.size === 0 ? null : next;
}

/**
 * Sync the local projection view into the explorer view model.
 *
 * Split out of `useExplorerInteractionState` so the flicker-prone gating can be
 * exercised without the SDK provider that priming needs: `view` is a fake, and
 * `primeDiscoveredDocuments` / the merge + link-change callbacks are plain
 * functions here rather than the provider-backed hooks the parent wires.
 * Behaviour is identical to the inlined effects it replaced.
 */
export function useExplorerViewProjectionSync(params: {
  activeContainerId: string | null;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
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
  // model and invalidate document link projections when membership changes.
  const lastActiveSummariesRef = useRef<ReadonlyArray<DocumentSummary> | null>(
    null,
  );
  // A null previous snapshot marks the first population for this view. Later
  // container keys can appear simply because the user opened another folder.
  const lastContainerSignaturesRef = useRef<ReadonlyMap<string, string> | null>(
    null,
  );
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
      lastContainerSignaturesRef.current = null;
    }
    const primedSummaryLists = primedSummaryListsForView(view);
    const applyFromView = () => {
      const summariesMap = view.getSnapshot().documentSummariesByContainerId;

      // Prime document stores for every container whose summaries are new, so
      // discovered documents sync their content (and titles) even when they
      // land outside the active container. Each summary-list instance is primed
      // once per view; the local projection only swaps the list when it changes.
      primeNewSummaryLists(
        summariesMap.values(),
        primedSummaryLists,
        primeDiscoveredDocuments,
      );

      const activeSummaries = activeContainerId
        ? (summariesMap.get(activeContainerId) ?? [])
        : [];
      if (lastActiveSummariesRef.current !== activeSummaries) {
        lastActiveSummariesRef.current = activeSummaries;
        mergeDocumentSummaries(activeSummaries);
      }
      const nextSignatures = computeContainerMembershipSignatures(summariesMap);
      const changedContainerIds = diffChangedContainerIds(
        lastContainerSignaturesRef.current,
        nextSignatures,
      );
      // An empty cache is not the initial population. Cold bootstrap commonly
      // applies once before the first container key arrives; consuming the
      // `null` sentinel there makes the real population look like an additive
      // lazy-load and suppresses its one required refresh.
      lastContainerSignaturesRef.current = trackContainerSignatures(
        lastContainerSignaturesRef.current,
        nextSignatures,
      );
      if (changedContainerIds.length > 0) {
        onDocumentLinksChanged(changedContainerIds);
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
