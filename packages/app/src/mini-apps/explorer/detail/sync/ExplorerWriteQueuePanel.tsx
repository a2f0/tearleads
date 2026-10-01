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
import { useCurrentWindow } from "@tearleads/windowing";
import { useCallback, useMemo, useState } from "react";
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
import { usePendingWriteQueueItems } from "./usePendingWriteQueueItems";
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
  // Why the latest pending-write read failed, or null when it succeeded.
  error: string | null;
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

// The read's own error rides along with the label: it is what tells the user
// whether the failure is transient or needs action (e.g. an obsolete local
// schema that only a local database reset fixes).
function WriteQueueLoadError(params: { error: string }) {
  return (
    <span role="alert">
      {EXPLORER_LABELS.writeQueueFailedToLoad} <span>{params.error}</span>
    </span>
  );
}

function WriteQueueEmptyState(params: {
  error: string | null;
  loading: boolean;
}) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columns = compact ? WRITE_QUEUE_COMPACT_COLUMNS : WRITE_QUEUE_COLUMNS;
  return (
    <MiniAppTableFrame className="mini-app-table-frame--bleed">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.writeQueueTitle}
        columns={columns}
      >
        <MiniAppTableEmptyRow colSpan={columns.length}>
          {!params.loading && params.error !== null ? (
            <WriteQueueLoadError error={params.error} />
          ) : (
            <span role="status">
              {params.loading
                ? EXPLORER_LABELS.writeQueueLoading
                : EXPLORER_LABELS.writeQueueEmpty}
            </span>
          )}
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
  if (params.error !== null) {
    return (
      <MiniAppStatus>
        <WriteQueueLoadError error={params.error} />
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
      {params.error !== null || params.items.length === 0 ? (
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
      : params.error !== null
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
