import type {
  DocumentSummary,
  LocalProjectionView,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import {
  computeContainerMembershipSignatures,
  diffChangedContainerIds,
} from "../../../stores/explorer/documentSummaryUtils";

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
 * exercised with a fake `view` and plain merge and link-change callbacks.
 * Opening discovered documents is not Explorer's job: the SDK's device-first
 * scope does it in the background whether or not Explorer is open.
 */
export function useExplorerViewProjectionSync(params: {
  activeContainerId: string | null;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
  view: LocalProjectionView;
}) {
  const {
    activeContainerId,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
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
    const applyFromView = () => {
      const summariesMap = view.getSnapshot().documentSummariesByContainerId;
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
  }, [activeContainerId, mergeDocumentSummaries, onDocumentLinksChanged, view]);
}
