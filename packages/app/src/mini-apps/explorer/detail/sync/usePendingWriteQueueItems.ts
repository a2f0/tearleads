import type {
  ContainerDocumentQueries,
  ContainerNode,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

// Minimum spacing between chained pending-write reads. listPendingWrites() is
// an identity-wide SQLite scan sharing the database's single serialized queue,
// so during a bulk import a read per revision bump would stack hundreds of
// heavy scans behind the import's writes. Instead at most one read is in
// flight, at most one re-read is queued behind it, and chained re-reads wait
// this long — the final read still observes the settled state.
const PENDING_WRITE_READ_COALESCE_MS = 300;

interface PendingWriteReadState {
  disposed: boolean;
  inFlight: boolean;
  rerunRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

// Owns the coalesced pending-write reads: loading is true only until the first
// read settles; later re-reads keep the last result on screen instead of
// flipping the panel back to "Loading".
export function usePendingWriteQueueItems(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  syncHasPendingWork: boolean;
  syncSettlementRevision: string;
}) {
  const [state, setState] = useState<{
    error: string | null;
    items: ReadonlyArray<PendingWriteQueueItem>;
    loading: boolean;
  }>({ error: null, items: [], loading: true });
  const readStateRef = useRef<PendingWriteReadState>({
    disposed: false,
    inFlight: false,
    rerunRequested: false,
    timer: null,
  });

  const runRead = useCallback(() => {
    const readState = readStateRef.current;
    readState.timer = null;
    if (readState.disposed) {
      return;
    }
    if (readState.inFlight) {
      readState.rerunRequested = true;
      return;
    }

    readState.inFlight = true;
    void params.documentQueries
      .listPendingWrites()
      .then(
        (items) => {
          if (!readState.disposed) {
            setState({ error: null, items, loading: false });
          }
        },
        (error: unknown) => {
          if (!readState.disposed) {
            setState({
              error: unknownErrorMessage(error),
              items: [],
              loading: false,
            });
          }
        },
      )
      .then(() => {
        readState.inFlight = false;
        if (readState.rerunRequested && !readState.disposed) {
          readState.rerunRequested = false;
          readState.timer = setTimeout(runRead, PENDING_WRITE_READ_COALESCE_MS);
        }
      });
  }, [params.documentQueries]);

  useEffect(() => {
    const readState = readStateRef.current;
    readState.disposed = false;
    return () => {
      readState.disposed = true;
      if (readState.timer !== null) {
        clearTimeout(readState.timer);
        readState.timer = null;
      }
    };
  }, []);

  useEffect(() => {
    const readState = readStateRef.current;
    if (readState.timer !== null) {
      // An already-scheduled re-read will observe this change when it fires.
      return;
    }
    if (readState.inFlight) {
      readState.rerunRequested = true;
      return;
    }
    runRead();
  }, [
    runRead,
    params.documentListRevision,
    params.nodes,
    params.syncHasPendingWork,
    params.syncSettlementRevision,
  ]);

  return state;
}
