import type {
  DocumentSummary,
  LocalProjectionView,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import {
  computeContainerMembershipSignatures,
  hasTrackedContainerMembershipChange,
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
  // Per-container document-id membership at the last view apply. The link
  // projection is the DESTRUCTIVE sidebar/table refresh (it clears rows to a
  // loading state and resets totalCount), so it must be bumped only when a
  // container ALREADY on screen actually changes membership — discovery, move,
  // delete. Two false positives are gated out here:
  //   1. Content-only ticks: the view fires on every reconciled delta during
  //      bootstrap (sync badges, title updates) with the same ids; bumping on those
  //      re-blanked the "You"/system-folder rows ~once per tick (bootstrap flicker).
  //   2. Additive container keys: the projection cache materializes a container
  //      lazily when it first becomes active, so selecting the "You" contact made
  //      the Contacts key appear for the first time even though nothing moved;
  //      bumping on that collapsed the sidebar (Contacts blanked, Trash jumped).
  // Kept per container (not one global signature string) so an additive key can be
  // told apart from a real change — see hasTrackedContainerMembershipChange. Null
  // until the first apply so that initial population still fires exactly once.
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
      // documents — but only when a container ALREADY on screen actually changed
      // its membership. This is the DESTRUCTIVE refresh (it clears rows), so firing
      // it on a content-only view delta re-blanked the sidebar every sync tick, and
      // firing it when a container key merely materialized (active-container switch)
      // collapsed the sidebar on selecting the "You" contact. Both are gated out by
      // hasTrackedContainerMembershipChange; the ref advances every apply regardless
      // so a later real change is still measured against the current snapshot.
      // Content-only and additive-key updates still refresh non-destructively via
      // documentListRevision / the sidebar's own window loader.
      const nextContainerSignatures =
        computeContainerMembershipSignatures(summariesMap);
      if (
        hasTrackedContainerMembershipChange(
          lastContainerSignaturesRef.current,
          nextContainerSignatures,
        )
      ) {
        onDocumentLinksChanged();
      }
      lastContainerSignaturesRef.current = nextContainerSignatures;
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
