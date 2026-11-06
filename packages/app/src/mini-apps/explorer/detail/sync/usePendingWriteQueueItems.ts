import type {
  ContainerDocumentQueries,
  ContainerNode,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

// Minimum spacing between chained pending-write reads. listPendingWrites() is
// an identity-wide SQLite scan sharing the database's single serialized queue,
// so during a bulk import a read per revision bump would stack hundreds of
// heavy scans behind the import's writes. Instead at most one read is in
// flight, at most one re-read is queued behind it, and chained re-reads wait
// this long — the final read still observes the settled state.
const PENDING_WRITE_READ_COALESCE_MS = 300;

interface PendingWriteQueueState {
  readonly documentQueries: ContainerDocumentQueries;
  readonly error: string | null;
  readonly items: ReadonlyArray<PendingWriteQueueItem>;
  readonly loading: boolean;
}

// Owns the coalesced pending-write reads: loading is true only until the first
// read settles; later re-reads keep the last result on screen instead of
// flipping the panel back to "Loading". The read loop belongs to one
// documentQueries object (one database scope): replacing it (org switch,
// logout) disposes the old loop, so a read, re-read or timer it armed can
// neither land rows from the previous scope nor query it again.
export function usePendingWriteQueueItems(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  syncHasPendingWork: boolean;
  syncSettlementRevision: string;
}) {
  const { documentQueries } = params;
  const [state, setState] = useState<PendingWriteQueueState>({
    documentQueries,
    error: null,
    items: [],
    loading: true,
  });
  const requestRead = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let rerunRequested = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const read = () => {
      timer = null;
      inFlight = true;
      rerunRequested = false;
      void documentQueries
        .listPendingWrites()
        .then(
          (items) => {
            if (!disposed) {
              setState({ documentQueries, error: null, items, loading: false });
            }
          },
          (error: unknown) => {
            if (!disposed) {
              setState({
                documentQueries,
                error: unknownErrorMessage(error),
                items: [],
                loading: false,
              });
            }
          },
        )
        .then(() => {
          inFlight = false;
          if (rerunRequested && !disposed) {
            timer = setTimeout(read, PENDING_WRITE_READ_COALESCE_MS);
          }
        });
    };

    const request = () => {
      if (disposed || timer !== null) {
        // An already-scheduled re-read will observe this change when it fires.
        return;
      }
      if (inFlight) {
        rerunRequested = true;
        return;
      }
      read();
    };
    requestRead.current = request;

    return () => {
      disposed = true;
      if (requestRead.current === request) {
        requestRead.current = () => undefined;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, [documentQueries]);

  // Declared after the loop effect so a replaced documentQueries has its new
  // loop installed before this change requests the first read from it.
  useEffect(() => {
    requestRead.current();
  }, [
    documentQueries,
    params.documentListRevision,
    params.nodes,
    params.syncHasPendingWork,
    params.syncSettlementRevision,
  ]);

  // Rows read from a replaced documentQueries never render, not even for the
  // commits before the new loop's first read settles.
  return state.documentQueries === documentQueries
    ? { error: state.error, items: state.items, loading: state.loading }
    : { error: null, items: [], loading: true };
}
