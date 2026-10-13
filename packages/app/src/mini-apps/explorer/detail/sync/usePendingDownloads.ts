import type {
  ContainerDocumentQueries,
  DomainScope,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

// Poll only while the panel is open, with one read in flight. Discovery and
// document pulls can finish without a currently selected document subscription.
export function usePendingDownloads(
  queries: ContainerDocumentQueries,
  domainScope: DomainScope,
) {
  const [state, setState] = useState<{
    items: ReadonlyArray<PendingDownloadQueueItem>;
    error: string | null;
    loading: boolean;
  }>({ items: [], error: null, loading: true });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ items: [], error: null, loading: true });
    async function read() {
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
      if (!disposed)
        timer = setTimeout(() => {
          void read();
        }, 1000);
    }
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [queries, domainScope]);
  return state;
}
