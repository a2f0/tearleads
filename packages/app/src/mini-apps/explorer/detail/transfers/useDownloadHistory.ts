import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
  DomainSyncSnapshot,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef } from "react";
import { useTearleadsExternalStoreSnapshot } from "../../../../providers/sdk/useTearleadsSubscription";
import type { DownloadHistoryState } from "./downloadHistoryMachine";
import { getOrCreateDownloadHistoryStore } from "./downloadHistoryStore";

/**
 * The Downloads rows for a scope, read from the SDK's durable queue. Opening
 * the panel reads at once, so a pull that finished while it was closed is
 * confirmed then; later discovery, persistence, and sync notifications are
 * coalesced. An idle panel does not poll SQLite.
 */
export function useDownloadHistory(params: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  documentListRevision: number;
  nodes: ReadonlyArray<ContainerNode>;
  syncSnapshot: DomainSyncSnapshot;
}): { readNow: () => void; state: DownloadHistoryState } {
  const { documentQueries, domainScope } = params;
  const store = getOrCreateDownloadHistoryStore(domainScope);
  const state = useTearleadsExternalStoreSnapshot(store);
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
  // depend on their values.
  useEffect(() => {
    const immediate =
      lastRead.current?.store !== store ||
      lastRead.current.queries !== documentQueries;
    lastRead.current = { queries: documentQueries, store };
    store.requestRead(documentQueries, { immediate });
  }, [
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
  return { readNow, state };
}
