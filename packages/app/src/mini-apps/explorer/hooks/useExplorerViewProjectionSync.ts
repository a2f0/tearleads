import type {
  DocumentSummary,
  LocalProjectionView,
} from "@symcrypt/client-sdk";
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
  // model and bump the document link projection so the sidebar/table re-read
  // their windows from SQLite. This replaces the old render-driven discovery.
  const lastActiveSummariesRef = useRef<ReadonlyArray<DocumentSummary> | null>(
    null,
  );
  // Per-container membership signatures at the last view apply. The link
  // projection is the DESTRUCTIVE sidebar refresh (it clears rows to a loading
  // state and resets totalCount), so it must be bumped only when membership
  // actually changes — discovery, move, delete — and reports WHICH containers
  // changed so the sidebar blanks only those. The view fires on every reconciled
  // delta during bootstrap (sync badges, title/content updates) with membership
  // unchanged; bumping on those blanked the "You"/system-folder rows once per tick
  // (the bootstrap flicker), and bumping every container blanked one org's rows
  // while another org synced (the cross-org flicker).
  //
  // Null until the first apply (and reset to null on view rotation) so diffChanged
  // ContainerIds fires the initial population exactly once. After that a non-null
  // previous lets it tell a real change apart from a container key merely appearing
  // for the first time — the active-container switch that collapsed the sidebar on
  // selecting the "You" contact (see diffChangedContainerIds).
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
      // documents — but only for the containers whose membership actually changed.
      // This is the DESTRUCTIVE refresh (it clears rows), so firing it for a
      // container that merely had summary content updated re-blanked its rows every
      // sync tick during bootstrap, firing it for EVERY container blanked one org's
      // rows whenever another org synced, and firing it for a container key that
      // merely materialized (active-container switch) collapsed the sidebar on
      // selecting the "You" contact. diffChangedContainerIds gates out all three;
      // content-only / additive-key updates still refresh non-destructively via
      // documentListRevision / the sidebar's own window loader.
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
