import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainDownloadHistorySnapshot,
  DomainScope,
  DomainSyncSnapshot,
} from "@tearleads/client-sdk";
import {
  getDomainDownloadHistorySnapshot,
  subscribeToDomainDownloadHistory,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useTearleadsExternalStoreSnapshot,
  useTearleadsExternalValue,
} from "../../../../providers/sdk/useTearleadsSubscription";
import {
  type DownloadHistoryEntry,
  mergeDownloadHistory,
} from "./downloadHistory";
import {
  type DownloadQueueState,
  getPendingDownloads,
} from "./downloadQueueMachine";
import { getOrCreateDownloadQueueStore } from "./downloadQueueStore";

/** The downloads the SDK recorded finishing in this scope, newest first. */
function useDomainDownloadHistory(
  domainScope: DomainScope,
): DomainDownloadHistorySnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToDomainDownloadHistory(domainScope, listener),
    [domainScope],
  );
  const getSnapshot = useCallback(
    () => getDomainDownloadHistorySnapshot(domainScope),
    [domainScope],
  );
  return useTearleadsExternalValue(subscribe, getSnapshot);
}

/**
 * The Downloads rows for a scope: the SDK's durable queue, read here, then
 * the downloads the SDK recorded finishing, which it records whether or not
 * this panel is open, as the sync coordinator records lane runs. Opening the
 * panel reads the queue at once; later discovery, persistence, sync, and
 * completion notifications are coalesced. An idle panel does not poll SQLite.
 */
export function useDownloadHistory(params: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  documentListRevision: number;
  nodes: ReadonlyArray<ContainerNode>;
  syncSnapshot: DomainSyncSnapshot;
}): {
  entries: ReadonlyArray<DownloadHistoryEntry>;
  readNow: () => void;
  state: DownloadQueueState;
} {
  const { documentQueries, domainScope } = params;
  const store = getOrCreateDownloadQueueStore(domainScope);
  const state = useTearleadsExternalStoreSnapshot(store);
  const { completed } = useDomainDownloadHistory(domainScope);
  // Fresh per mount, so reopening the panel reads at once.
  const lastRead = useRef<{
    queries: ContainerDocumentQueries;
    store: typeof store;
  } | null>(null);
  const syncSettlementRevision = params.syncSnapshot.lanes
    .map(
      (lane) =>
        `${lane.key}:${lane.runCount}:${lane.running}:${lane.lastCompletedAt ?? ""}:${lane.lastFailedAt ?? ""}`,
    )
    .join("\0");
  // The change signals below only trigger a read; the read itself does not
  // depend on their values. A recorded completion re-reads the queue so the
  // finished row leaves the pending list.
  useEffect(() => {
    const immediate =
      lastRead.current?.store !== store ||
      lastRead.current.queries !== documentQueries;
    lastRead.current = { queries: documentQueries, store };
    store.requestRead(documentQueries, { immediate });
  }, [
    completed,
    documentQueries,
    store,
    params.documentListRevision,
    params.nodes,
    params.syncSnapshot.hasPendingWork,
    syncSettlementRevision,
  ]);
  const readNow = useCallback(() => {
    store.requestRead(documentQueries, { immediate: true });
  }, [documentQueries, store]);
  const pending = getPendingDownloads(state);
  const entries = useMemo(
    () => mergeDownloadHistory(pending, completed),
    [completed, pending],
  );
  return { entries, readNow, state };
}
