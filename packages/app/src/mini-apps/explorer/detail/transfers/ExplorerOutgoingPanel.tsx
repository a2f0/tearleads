import {
  type ContainerDocumentQueries,
  type ContainerNode,
  type DomainScope,
  type DomainSyncSnapshot,
  type PendingWriteQueueItem,
  requestAllDomainSyncLanes,
} from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import { useCallback, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { useDomainSyncSnapshot } from "../../../../providers/sdk/useDomainSyncSnapshot";
import { getQueueItems } from "../../../../stores/sync-queues/queueReadMachine";
import { getOrCreatePendingWriteQueueStore } from "../../../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../../../stores/sync-queues/useQueueRead";
import { getExplorerUploadStatusText } from "../../hooks/explorerUploadState";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import {
  EXPLORER_LABELS,
  getExplorerUploadsSummaryLabel,
  getExplorerWriteQueueSummaryLabel,
} from "../../labels";
import {
  ExplorerWriteQueueEntryView,
  WriteQueueBlockers,
  WriteQueueDiscardConfirmDialog,
  WriteQueueLoadError,
} from "../sync/ExplorerWriteQueueViews";
import {
  useWriteQueueActions,
  type WriteQueueActions,
} from "../sync/useWriteQueueActions";
import { countWriteQueueWrites } from "../sync/writeQueueItems";
import { ExplorerOutgoingTable } from "./ExplorerOutgoingTable";
import { deriveOutgoingRows, type OutgoingRow } from "./outgoingRows";
import { isOutstandingUploadStatus } from "./uploadTransfer";

const NO_ITEMS: ReadonlyArray<PendingWriteQueueItem> = [];

interface ExplorerOutgoingSharedProps {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  openContainerInfoRoute: (containerId: string) => void;
  openDocument: (localId: string, containerId: string) => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  /**
   * The full (objectKind, namespace, localId) key of the write-queue entry
   * whose detail replaces the list, or null for the list.
   */
  selectedEntryKey: string | null;
  uploadManager: ExplorerUploadManager;
}

export interface ExplorerOutgoingViewProps
  extends ExplorerOutgoingSharedProps,
    WriteQueueActions {
  // Why the latest pending-write read failed, or null when it succeeded.
  error: string | null;
  loading: boolean;
  snapshot: DomainSyncSnapshot;
  writes: ReadonlyArray<PendingWriteQueueItem>;
}

function getOutgoingSummary(
  params: ExplorerOutgoingViewProps,
  rows: ReadonlyArray<OutgoingRow>,
): string {
  const writes =
    params.loading && params.writes.length === 0
      ? EXPLORER_LABELS.writeQueueSummaryLoading
      : params.error !== null
        ? EXPLORER_LABELS.writeQueueSummaryUnavailable
        : getExplorerWriteQueueSummaryLabel({
            objectCount: params.writes.length,
            writeCount: countWriteQueueWrites(params.writes),
          });
  const uploads = rows.flatMap((row) =>
    row.kind === "write" ? [] : [row.upload],
  );
  if (uploads.length === 0) return writes;
  const files = getExplorerUploadsSummaryLabel({
    outstandingCount: uploads.filter((upload) =>
      isOutstandingUploadStatus(upload.status),
    ).length,
    totalCount: uploads.length,
  });
  return `${writes} · ${files}`;
}

function OutgoingEmptyMessage(params: {
  error: string | null;
  loading: boolean;
}) {
  if (params.error !== null)
    return <WriteQueueLoadError error={params.error} />;
  return (
    <span role="status">
      {params.loading
        ? EXPLORER_LABELS.writeQueueLoading
        : EXPLORER_LABELS.outgoingEmpty}
    </span>
  );
}

function ExplorerOutgoingList(params: ExplorerOutgoingViewProps) {
  const { uploadManager } = params;
  const [discardCandidate, setDiscardCandidate] =
    useState<PendingWriteQueueItem | null>(null);
  const rows = useMemo(
    () =>
      deriveOutgoingRows({
        billingBlockedOrganizationId: params.billingBlockedOrganizationId,
        lanes: params.snapshot.lanes,
        uploads: uploadManager.items,
        writes: params.writes,
      }),
    [
      params.billingBlockedOrganizationId,
      params.snapshot.lanes,
      params.writes,
      uploadManager.items,
    ],
  );
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );
  const uploadStatusText = getExplorerUploadStatusText(
    uploadManager.run,
    uploadManager.queuedFileCount,
  );

  return (
    <>
      <MiniAppStatus>{getOutgoingSummary(params, rows)}</MiniAppStatus>
      <WriteQueueBlockers
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        isAuthenticated={params.isAuthenticated}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
      />
      {/* Stops this window's queued and importing files; another Explorer
          window's files are listed but cancelled from that window. */}
      {uploadStatusText !== null &&
      (uploadManager.isImporting || uploadManager.queuedFileCount > 0) ? (
        <MiniAppStatus as="span" className="explorer-detail-import-status">
          {uploadStatusText}
          <MiniAppButton onClick={uploadManager.cancel} variant="ghost">
            {EXPLORER_LABELS.fileImportCancelAction}
          </MiniAppButton>
        </MiniAppStatus>
      ) : null}
      {/* With rows to show, a failed read is reported above them; without,
          in their place. */}
      {params.error !== null && rows.length > 0 ? (
        <MiniAppStatus>
          <WriteQueueLoadError error={params.error} />
        </MiniAppStatus>
      ) : null}
      <ExplorerOutgoingTable
        actions={{
          billingBlockedOrganizationId: params.billingBlockedOrganizationId,
          containerNamesById,
          openContainerInfoRoute: params.openContainerInfoRoute,
          openDocument: params.openDocument,
          openWriteQueueEntryRoute: params.openWriteQueueEntryRoute,
          organizationNamesById: params.organizationNamesById,
          requestDiscardPendingWrites: setDiscardCandidate,
          retryPendingWrites: params.retryPendingWrites,
        }}
        emptyMessage={
          <OutgoingEmptyMessage error={params.error} loading={params.loading} />
        }
        rows={rows}
      />
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
    </>
  );
}

/** The Outgoing tab's content, from what its panel read. */
export function ExplorerOutgoingView(params: ExplorerOutgoingViewProps) {
  if (params.selectedEntryKey === null) {
    return <ExplorerOutgoingList {...params} />;
  }
  return (
    <ExplorerWriteQueueEntryView
      billingBlockedOrganizationId={params.billingBlockedOrganizationId}
      error={params.error}
      isAuthenticated={params.isAuthenticated}
      items={params.writes}
      loading={params.loading}
      nodes={params.nodes}
      online={params.online}
      organizationNamesById={params.organizationNamesById}
      selectedEntryKey={params.selectedEntryKey}
      snapshot={params.snapshot}
    />
  );
}

interface ExplorerOutgoingPanelProps extends ExplorerOutgoingSharedProps {
  /** The queue is read only while the database is open. */
  dbReady: boolean;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
}

/**
 * The diagnostics hub's Outgoing tab: what waits to leave this device, and
 * this session's uploads, in one table where each file appears once. A
 * selected write-queue entry replaces the table with its detail. The tab owns
 * Refresh, so it stays on the entry detail too.
 */
export function ExplorerOutgoingPanel({
  dbReady,
  documentQueries,
  domainScope,
  ...shared
}: ExplorerOutgoingPanelProps) {
  const snapshot = useDomainSyncSnapshot(domainScope);
  // The shared store follows sync and persistence signals itself, so this
  // tab, the Sync Status tray app, and System Monitor read the queue once.
  // Like them, the tab reads only while the database is open, so a read
  // that fails on a closed database never reaches their shared state.
  const state = useQueueRead(
    getOrCreatePendingWriteQueueStore(domainScope),
    dbReady ? documentQueries : null,
  );
  const actions = useWriteQueueActions(documentQueries, domainScope);
  const handleRefresh = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );
  // The same Refresh as Incoming: re-request sync for the scope, which
  // re-drives each imported file's existing upload (never re-importing it)
  // and every queued write, an entry's included.
  useWindowRefreshMenuItem({
    disabled: !shared.online || !shared.isAuthenticated,
    onRefresh: handleRefresh,
    priority: 200,
  });

  return (
    <MiniAppPanel className="explorer-detail explorer-detail--outgoing" scroll>
      <ExplorerOutgoingView
        {...shared}
        {...actions}
        // A failed read shows its error in place of the rows it could not
        // refresh.
        error={state.status === "failed" ? state.message : null}
        loading={state.status === "loading"}
        snapshot={snapshot}
        writes={state.status === "failed" ? NO_ITEMS : getQueueItems(state)}
      />
    </MiniAppPanel>
  );
}
