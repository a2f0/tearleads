import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
  DomainSyncSnapshot,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

// Coalesce discovery, document persistence, and sync notifications. Keep only
// one read in flight and one follow-up; an idle panel does not poll SQLite.
export function usePendingDownloads(params: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  documentListRevision: number;
  nodes: ReadonlyArray<ContainerNode>;
  syncSnapshot: DomainSyncSnapshot;
}) {
  const [state, setState] = useState<{
    items: ReadonlyArray<PendingDownloadQueueItem>;
    error: string | null;
    loading: boolean;
  }>({ items: [], error: null, loading: true });
  const refresh = useRef<() => void>(() => undefined);
  const syncSettlementRevision = params.syncSnapshot.lanes
    .map(
      (lane) =>
        `${lane.key}:${lane.runCount}:${lane.running}:${lane.lastCompletedAt ?? ""}:${lane.lastFailedAt ?? ""}`,
    )
    .join("\0");
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let rerunRequested = false;
    let initialRead = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queries = params.documentQueries;
    setState({ items: [], error: null, loading: true });
    async function read() {
      inFlight = true;
      rerunRequested = false;
      try {
        const items = await queries.listPendingDownloads();
        if (!disposed) setState({ items, error: null, loading: false });
      } catch (error) {
        if (!disposed)
          setState({
            items: [],
            error: unknownErrorMessage(error),
            loading: false,
          });
      }
      inFlight = false;
      if (!disposed && rerunRequested) schedule();
    }
    function schedule() {
      if (disposed || timer !== undefined) return;
      if (inFlight) {
        rerunRequested = true;
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        void read();
      }, 300);
    }
    refresh.current = () => {
      if (initialRead) {
        initialRead = false;
        void read();
      } else schedule();
    };
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [params.documentQueries, params.domainScope]);
  useEffect(() => {
    refresh.current();
  }, [
    params.documentQueries,
    params.domainScope,
    params.documentListRevision,
    params.nodes,
    params.syncSnapshot.hasPendingWork,
    syncSettlementRevision,
  ]);
  return state;
}
