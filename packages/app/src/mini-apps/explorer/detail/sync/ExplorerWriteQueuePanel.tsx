import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
  DomainSyncSnapshot,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import {
  discardRegisteredDocumentLocalState,
  requestAllDomainSyncLanes,
  requestContainerContentsDocumentPriming,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { useCurrentWindow } from "../../../../components/window/CurrentWindowContext";
import { useRoutedLayoutTier } from "../../../../navigation/useRoutedLayoutTier";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueSummaryLabel,
} from "../../labels";
import { ExplorerWriteQueueEntryDetail } from "./ExplorerWriteQueueEntryDetail";
import {
  ExplorerWriteQueueTable,
  getWriteQueueItemKey,
  getWriteQueueItemName,
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
  openDocument: (localId: string, containerId: string) => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  // When set (the full (objectKind, namespace, localId) key), the panel shows the
  // drill-in detail for that pending-write entry instead of the list. Null
  // renders the list.
  selectedEntryKey: string | null;
}

interface ExplorerWriteQueuePanelViewProps
  extends Omit<
    ExplorerWriteQueuePanelProps,
    "documentListRevision" | "documentQueries" | "domainScope"
  > {
  // Requests the confirmation dialog; the destructive discard itself only
  // runs from the dialog's confirm action.
  discardPendingWrites: (item: PendingWriteQueueItem) => void;
  error: boolean;
  items: ReadonlyArray<PendingWriteQueueItem>;
  loading: boolean;
  retryPendingWrites: (item: PendingWriteQueueItem) => void;
  snapshot: DomainSyncSnapshot;
}

// The dialog names the document and states the consequence: discarding
// deletes queued edits irreversibly, and the action sits next to Retry in
// the row menu, so a mis-tap must not be able to destroy anything.
function WriteQueueDiscardConfirmDialog(params: {
  item: PendingWriteQueueItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="write-queue-discard-title"
        aria-modal="true"
      >
        <MiniAppModalForm
          onSubmit={(event) => {
            event.preventDefault();
            params.onConfirm();
          }}
        >
          <h2 id="write-queue-discard-title">
            {EXPLORER_LABELS.writeQueueDiscardConfirmTitle}
          </h2>
          <MiniAppStatus>
            <strong>{getWriteQueueItemName(params.item)}</strong>
            {" — "}
            {EXPLORER_LABELS.writeQueueDiscardConfirmBody}
          </MiniAppStatus>
          <MiniAppActions>
            <MiniAppButton onClick={params.onCancel}>Cancel</MiniAppButton>
            <MiniAppButton type="submit">
              {EXPLORER_LABELS.writeQueueDiscardAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
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
    <MiniAppTableFrame className="mini-app-table-frame--bleed">
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

function WriteQueueEntryBody(params: ExplorerWriteQueuePanelViewProps) {
  const selectedEntry =
    params.selectedEntryKey === null
      ? null
      : (params.items.find(
          (item) => getWriteQueueItemKey(item) === params.selectedEntryKey,
        ) ?? null);
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );

  if (selectedEntry) {
    return (
      <ExplorerWriteQueueEntryDetail
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        containerNamesById={containerNamesById}
        isAuthenticated={params.isAuthenticated}
        item={selectedEntry}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
        snapshot={params.snapshot}
      />
    );
  }

  // The entry may not have loaded yet; don't claim it is gone.
  if (params.loading) {
    return <MiniAppStatus>{EXPLORER_LABELS.writeQueueLoading}</MiniAppStatus>;
  }

  // The read failed, so an empty list is a query failure, not an empty queue.
  // Surface the error instead of falsely claiming the change finished syncing.
  if (params.error) {
    return (
      <MiniAppStatus>
        <span role="alert">{EXPLORER_LABELS.writeQueueFailedToLoad}</span>
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppStatus>
      {EXPLORER_LABELS.writeQueueEntryNotQueued}{" "}
      <code>{params.selectedEntryKey}</code>
    </MiniAppStatus>
  );
}

function WriteQueueListBody(
  params: ExplorerWriteQueuePanelViewProps & {
    requestDiscardPendingWrites: (item: PendingWriteQueueItem) => void;
  },
) {
  return (
    <>
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
          discardPendingWrites={params.requestDiscardPendingWrites}
          items={params.items}
          nodes={params.nodes}
          openContainerInfoRoute={params.openContainerInfoRoute}
          openDocument={params.openDocument}
          openWriteQueueEntryRoute={params.openWriteQueueEntryRoute}
          organizationNamesById={params.organizationNamesById}
          retryPendingWrites={params.retryPendingWrites}
        />
      )}
    </>
  );
}

function getWriteQueuePanelTitles(params: ExplorerWriteQueuePanelViewProps): {
  subtitle: string;
  title: string;
} {
  const showingEntryDetail = params.selectedEntryKey !== null;
  const selectedEntry = showingEntryDetail
    ? (params.items.find(
        (item) => getWriteQueueItemKey(item) === params.selectedEntryKey,
      ) ?? null)
    : null;
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
  const listSubtitle =
    params.loading && params.items.length === 0
      ? EXPLORER_LABELS.writeQueueSummaryLoading
      : params.error
        ? EXPLORER_LABELS.writeQueueSummaryUnavailable
        : summary;
  return {
    subtitle: showingEntryDetail
      ? selectedEntry
        ? getWriteQueueItemName(selectedEntry)
        : (params.selectedEntryKey ?? "")
      : listSubtitle,
    title: showingEntryDetail
      ? EXPLORER_LABELS.writeQueueEntryDetailTitle
      : EXPLORER_LABELS.writeQueueTitle,
  };
}

export function ExplorerWriteQueuePanelView(
  params: ExplorerWriteQueuePanelViewProps,
) {
  const [discardCandidate, setDiscardCandidate] =
    useState<PendingWriteQueueItem | null>(null);
  const { subtitle, title } = getWriteQueuePanelTitles(params);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--write-queue"
      scroll
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      {params.selectedEntryKey !== null ? (
        <WriteQueueEntryBody {...params} />
      ) : (
        <WriteQueueListBody
          {...params}
          requestDiscardPendingWrites={setDiscardCandidate}
        />
      )}
      {discardCandidate ? (
        <WriteQueueDiscardConfirmDialog
          item={discardCandidate}
          onCancel={() => setDiscardCandidate(null)}
          onConfirm={() => {
            setDiscardCandidate(null);
            params.discardPendingWrites(discardCandidate);
          }}
        />
      ) : null}
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
  const { documentQueries, domainScope } = params;
  // Per-entry "Retry sync": reset the item's parked retry state (recorded
  // terminal failure, and for documents the durable re-key budget — a cap
  // burned during an outage should not be terminal forever), then arm every
  // pump-driven lane. Clean stores skip cheaply, blocked/errored intents
  // replay, and offline requests stay queued until prerequisites return.
  const retryPendingWrites = useCallback(
    (item: PendingWriteQueueItem) => {
      void documentQueries
        .retryPendingWriteItem({
          localId: item.localId,
          namespace: item.namespace,
          objectKind: item.objectKind,
        })
        .catch(() => undefined)
        .finally(() => {
          requestAllDomainSyncLanes(domainScope);
          // A failure-only revalidation item has no queued work for any lane
          // to pick up; priming (which selects documents with a recorded
          // sync failure) is what actually re-opens the store and retries
          // the refused revalidation.
          if (item.objectKind === "document") {
            requestContainerContentsDocumentPriming(domainScope);
          }
        });
    },
    [documentQueries, domainScope],
  );
  // Per-entry "Discard local edits": tear down the document's local state
  // through its registered store (so an in-flight persist cannot resurrect
  // the deleted rows), then re-arm document priming so the server copy is
  // re-created without an app restart. Retry keeps the queued writes; this is
  // the escape hatch for a queue that can never sync (e.g. permanently
  // conflicting update ids), trading local-only edits for server truth. A
  // refusal (the document moved, relinked, or changed under the dialog) is
  // surfaced — a confirmed destructive action must never silently no-op.
  const currentWindow = useCurrentWindow();
  const discardPendingWrites = useCallback(
    (item: PendingWriteQueueItem) => {
      if (item.remoteId === null) {
        return;
      }
      void discardRegisteredDocumentLocalState(
        domainScope,
        item.localId,
        item.remoteId,
      )
        // A refusal (false) and an operational failure (throw) read
        // differently to the user: the first means the document's state made
        // the discard unsafe, the second that nothing changed and retrying
        // is reasonable.
        .then(
          (discarded): "discarded" | "refused" =>
            discarded ? "discarded" : "refused",
          (): "failed" => "failed",
        )
        .then((outcome) => {
          if (outcome === "discarded") {
            requestContainerContentsDocumentPriming(domainScope);
            return;
          }
          currentWindow?.showStatusMessage(
            outcome === "refused"
              ? EXPLORER_LABELS.writeQueueDiscardRefusedStatus
              : EXPLORER_LABELS.writeQueueDiscardFailedStatus,
          );
        })
        .finally(() => {
          requestAllDomainSyncLanes(domainScope);
        });
    },
    [currentWindow, domainScope],
  );
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
      discardPendingWrites={discardPendingWrites}
      error={state.error}
      isAuthenticated={params.isAuthenticated}
      items={state.items}
      loading={state.loading}
      nodes={params.nodes}
      online={params.online}
      openContainerInfoRoute={params.openContainerInfoRoute}
      openDocument={params.openDocument}
      openWriteQueueEntryRoute={params.openWriteQueueEntryRoute}
      organizationNamesById={params.organizationNamesById}
      retryPendingWrites={retryPendingWrites}
      selectedEntryKey={params.selectedEntryKey}
      snapshot={syncSnapshot}
    />
  );
}
