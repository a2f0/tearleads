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
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let rerunRequested = false;
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
    refresh.current = schedule;
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [params.documentQueries, params.domainScope]);
  useEffect(() => {
    refresh.current();
  }, [params.documentListRevision, params.nodes, params.syncSnapshot]);
  return state;
}
