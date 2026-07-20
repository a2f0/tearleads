import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { useRoutedLayoutTier } from "../../../../navigation/useRoutedLayoutTier";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueSummaryLabel,
} from "../../labels";
import {
  ExplorerWriteQueueTable,
  WRITE_QUEUE_COLUMNS,
  WRITE_QUEUE_COMPACT_COLUMNS,
} from "./ExplorerWriteQueueTable";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";
import "./ExplorerWriteQueuePanel.css";

interface ExplorerWriteQueuePanelProps {
  billingBlockedOrganizationId: string | null;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  isAuthenticated: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
}

interface ExplorerWriteQueuePanelViewProps
  extends Omit<
    ExplorerWriteQueuePanelProps,
    "documentListRevision" | "documentQueries" | "domainScope"
  > {
  error: boolean;
  items: ReadonlyArray<PendingWriteQueueItem>;
  loading: boolean;
}

function WriteQueueBlockers(params: {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
}) {
  const messages: string[] = [];
  if (!params.online) {
    messages.push(EXPLORER_LABELS.writeQueueWaitingForNetwork);
  }
  if (!params.isAuthenticated) {
    messages.push(EXPLORER_LABELS.writeQueueSignedOut);
  }
  if (params.billingBlockedOrganizationId) {
    const organization =
      params.organizationNamesById.get(params.billingBlockedOrganizationId) ??
      params.billingBlockedOrganizationId;
    messages.push(
      `${EXPLORER_LABELS.writeQueueBillingPausedMessage} ${organization}.`,
    );
  }
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="explorer-write-queue-blockers" role="status">
      {messages.join(" ")}
    </div>
  );
}

function WriteQueueEmptyState(params: { error: boolean; loading: boolean }) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columns = compact ? WRITE_QUEUE_COMPACT_COLUMNS : WRITE_QUEUE_COLUMNS;
  const label = params.loading
    ? EXPLORER_LABELS.writeQueueLoading
    : params.error
      ? EXPLORER_LABELS.writeQueueFailedToLoad
      : EXPLORER_LABELS.writeQueueEmpty;
  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={EXPLORER_LABELS.writeQueueTitle}
        columns={columns}
      >
        <MiniAppTableEmptyRow colSpan={columns.length}>
          <span role={params.error ? "alert" : "status"}>{label}</span>
        </MiniAppTableEmptyRow>
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function ExplorerWriteQueuePanelView(
  params: ExplorerWriteQueuePanelViewProps,
) {
  const writeCount = params.items.reduce(
    (total, item) =>
      total +
      item.operations.reduce(
        (operationTotal, operation) => operationTotal + operation.count,
        0,
      ),
    0,
  );
  const summary = getExplorerWriteQueueSummaryLabel({
    objectCount: params.items.length,
    writeCount,
  });
  const subtitle =
    params.loading && params.items.length === 0
      ? EXPLORER_LABELS.writeQueueSummaryLoading
      : params.error
        ? EXPLORER_LABELS.writeQueueSummaryUnavailable
        : summary;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--write-queue"
      scroll
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.writeQueueTitle}</strong>
          <span>{subtitle}</span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <WriteQueueBlockers
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        isAuthenticated={params.isAuthenticated}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
      />
      {params.error || params.items.length === 0 ? (
        <WriteQueueEmptyState error={params.error} loading={params.loading} />
      ) : (
        <ExplorerWriteQueueTable
          billingBlockedOrganizationId={params.billingBlockedOrganizationId}
          items={params.items}
          nodes={params.nodes}
          openContainerInfoRoute={params.openContainerInfoRoute}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          organizationNamesById={params.organizationNamesById}
        />
      )}
    </MiniAppPanel>
  );
}

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
function usePendingWriteQueueItems(
  params: Pick<
    ExplorerWriteQueuePanelProps,
    "documentListRevision" | "documentQueries" | "nodes"
  > & { syncHasPendingWork: boolean; syncSettlementRevision: string },
) {
  const [state, setState] = useState<{
    error: boolean;
    items: ReadonlyArray<PendingWriteQueueItem>;
    loading: boolean;
  }>({ error: false, items: [], loading: true });
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
            setState({ error: false, items, loading: false });
          }
        },
        () => {
          if (!readState.disposed) {
            setState({ error: true, items: [], loading: false });
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

export function ExplorerWriteQueuePanel(params: ExplorerWriteQueuePanelProps) {
  const syncSnapshot = useDomainSyncSnapshot(params.domainScope);
  const syncSettlementRevision = syncSnapshot.lanes
    .map(
      (lane) =>
        `${lane.key}:${lane.runCount}:${lane.running}:${lane.lastCompletedAt ?? ""}:${lane.lastFailedAt ?? ""}`,
    )
    .join("\0");
  const state = usePendingWriteQueueItems({
    documentListRevision: params.documentListRevision,
    documentQueries: params.documentQueries,
    nodes: params.nodes,
    syncHasPendingWork: syncSnapshot.hasPendingWork,
    syncSettlementRevision,
  });

  return (
    <ExplorerWriteQueuePanelView
      billingBlockedOrganizationId={params.billingBlockedOrganizationId}
      error={state.error}
      isAuthenticated={params.isAuthenticated}
      items={state.items}
      loading={state.loading}
      nodes={params.nodes}
      online={params.online}
      openContainerInfoRoute={params.openContainerInfoRoute}
      openDocumentInfoRoute={params.openDocumentInfoRoute}
      organizationNamesById={params.organizationNamesById}
    />
  );
}
