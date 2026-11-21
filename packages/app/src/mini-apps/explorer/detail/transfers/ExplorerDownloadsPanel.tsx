import {
  type ContainerDocumentQueries,
  type ContainerNode,
  type DomainScope,
  type PendingDownloadQueueItem,
  requestAllDomainSyncLanes,
  type SyncLaneSnapshot,
  type SyncLaneStatus,
} from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import { useCallback, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../../components/mini-app/MiniAppTable";
import { EXPLORER_LABELS, getExplorerDownloadsCountLabel } from "../../labels";
import { getExplorerSyncLaneProgress } from "../sync/ExplorerSyncLaneUtils";
import { useDomainSyncSnapshot } from "../sync/useDomainSyncSnapshot";
import {
  type DownloadHistoryEntry,
  getDownloadHistoryEntries,
  getDownloadHistoryKey,
} from "./downloadHistoryMachine";
import {
  ExplorerTransferNameCell,
  type ExplorerTransferProgress,
  ExplorerTransferStatusCell,
} from "./ExplorerTransferCells";
import { useDownloadHistory } from "./useDownloadHistory";

const DOWNLOADS_ROW_LIMIT = 100;

const COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  // The item flexes so its progress bar spans the rest of the row.
  { id: "item", header: EXPLORER_LABELS.downloadsItemColumn },
  {
    id: "status",
    header: EXPLORER_LABELS.downloadsStatusColumn,
    width: "11rem",
  },
];

function downloadTransfer(
  status: SyncLaneStatus,
  label: string,
  detail: string | null,
): ExplorerTransferProgress {
  return {
    detail,
    label,
    // A failed pull is still queued: only a stored download fills the bar.
    percent: getExplorerSyncLaneProgress(
      status === "error" ? "queued" : status,
    ),
    status,
  };
}

function pendingDownloadTransfer(
  item: PendingDownloadQueueItem,
  lane: SyncLaneSnapshot | undefined,
  online: boolean,
  isAuthenticated: boolean,
): ExplorerTransferProgress {
  const detail = item.lastError ?? lane?.lastError ?? null;
  if (!isAuthenticated)
    return downloadTransfer("queued", EXPLORER_LABELS.downloadsSignIn, detail);
  if (!online)
    return downloadTransfer("queued", EXPLORER_LABELS.downloadsOffline, detail);
  if (lane?.running)
    return downloadTransfer(
      "running",
      EXPLORER_LABELS.downloadsRunning,
      detail,
    );
  if (item.lastError || lane?.status === "error")
    return downloadTransfer("error", EXPLORER_LABELS.downloadsError, detail);
  return downloadTransfer(
    "queued",
    item.reason === "continuation"
      ? EXPLORER_LABELS.downloadsRemaining
      : EXPLORER_LABELS.downloadsWaiting,
    detail,
  );
}

function getDownloadName(entry: DownloadHistoryEntry): string {
  if (entry.item.title !== null) return entry.item.title;
  const folder = entry.item.objectKind === "container";
  if (entry.status === "complete")
    return folder
      ? EXPLORER_LABELS.downloadsUntitledFolder
      : EXPLORER_LABELS.downloadsUntitledDocument;
  return folder
    ? EXPLORER_LABELS.downloadsUnknownFolder
    : EXPLORER_LABELS.downloadsUnknownDocument;
}

function DownloadRow(params: {
  entry: DownloadHistoryEntry;
  isAuthenticated: boolean;
  lanes: ReadonlyMap<string, SyncLaneSnapshot>;
  online: boolean;
}) {
  const { entry } = params;
  const transfer =
    entry.status === "complete"
      ? downloadTransfer(
          "complete",
          EXPLORER_LABELS.syncLanesStatusComplete,
          null,
        )
      : pendingDownloadTransfer(
          entry.item,
          entry.item.objectKind === "document"
            ? params.lanes.get(`documents:${entry.item.localId}`)
            : undefined,
          params.online,
          params.isAuthenticated,
        );
  return (
    <MiniAppTableRow>
      <ExplorerTransferNameCell
        title={entry.item.documentId}
        transfer={transfer}
      >
        {getDownloadName(entry)}
        <small> {entry.item.documentId}</small>
      </ExplorerTransferNameCell>
      <ExplorerTransferStatusCell transfer={transfer} />
    </MiniAppTableRow>
  );
}

/**
 * The scope's download queue plus the pulls this view saw finish, which stay
 * listed as Complete until the domain scope rotates, as Sync Lanes does.
 */
export function ExplorerDownloadsPanel(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  isAuthenticated: boolean;
}) {
  const { domainScope, isAuthenticated, online } = params;
  const snapshot = useDomainSyncSnapshot(domainScope);
  const { readNow, state } = useDownloadHistory({
    ...params,
    syncSnapshot: snapshot,
  });
  const [limit, setLimit] = useState(DOWNLOADS_ROW_LIMIT);
  const lanes = useMemo(
    () => new Map(snapshot.lanes.map((lane) => [lane.key, lane])),
    [snapshot.lanes],
  );
  const entries = getDownloadHistoryEntries(state);
  const pendingCount = entries.filter(
    (entry) => entry.status === "pending",
  ).length;
  const handleRefresh = useCallback(() => {
    requestAllDomainSyncLanes(domainScope);
    readNow();
  }, [domainScope, readNow]);
  // Overrides Explorer's reconciliation Refresh while this view is open, as
  // Sync Lanes does. It stays enabled with work pending, since re-requesting
  // the lanes is the retry.
  useWindowRefreshMenuItem({
    disabled: !online || !isAuthenticated,
    onRefresh: handleRefresh,
    priority: 200,
  });
  return (
    <MiniAppPanel className="explorer-detail explorer-detail--downloads" scroll>
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.downloadsAction}</strong>
          <span>{EXPLORER_LABELS.downloadsDescription}</span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      {state.status === "failed" ? (
        <MiniAppStatus role="alert">{state.message}</MiniAppStatus>
      ) : (
        <MiniAppStatus>
          {state.status === "loading"
            ? EXPLORER_LABELS.downloadsLoading
            : getExplorerDownloadsCountLabel(pendingCount)}
        </MiniAppStatus>
      )}
      <MiniAppTableFrame className="mini-app-table-frame--bleed">
        <MiniAppTable
          aria-label={EXPLORER_LABELS.downloadsAction}
          columns={COLUMNS}
        >
          {entries.slice(0, limit).map((entry) => (
            <DownloadRow
              entry={entry}
              isAuthenticated={isAuthenticated}
              key={getDownloadHistoryKey(entry.item)}
              lanes={lanes}
              online={online}
            />
          ))}
          {state.status === "ready" && entries.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              {EXPLORER_LABELS.downloadsEmpty}
            </MiniAppTableEmptyRow>
          ) : null}
          {entries.length > limit ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              <MiniAppButton
                onClick={() =>
                  setLimit((current) => current + DOWNLOADS_ROW_LIMIT)
                }
              >
                {EXPLORER_LABELS.downloadsShowMoreAction}
              </MiniAppButton>
            </MiniAppTableEmptyRow>
          ) : null}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppPanel>
  );
}
