import {
  type ContainerDocumentQueries,
  type DomainScope,
  type PendingDownloadQueueItem,
  type RetryDocumentDownloadInput,
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
import { useTearleads } from "../../../../providers/sdk/TearleadsProvider";
import { useDomainSyncSnapshot } from "../../../../providers/sdk/useDomainSyncSnapshot";
import { EXPLORER_LABELS, getExplorerDownloadsCountLabel } from "../../labels";
import {
  type DownloadHistoryEntry,
  getDownloadHistoryKey,
} from "./downloadHistory";
import {
  ExplorerTransferNameCell,
  type ExplorerTransferOpenAction,
  type ExplorerTransferProgress,
  ExplorerTransferStatusCell,
  getExplorerTransferStatusPercent,
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
    percent: getExplorerTransferStatusPercent(status),
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
  if (item.objectKind === "attachment")
    return downloadTransfer(
      "queued",
      EXPLORER_LABELS.downloadsFileWaiting,
      detail,
    );
  return downloadTransfer(
    "queued",
    item.reason === "continuation"
      ? EXPLORER_LABELS.downloadsRemaining
      : EXPLORER_LABELS.downloadsWaiting,
    detail,
  );
}

function getDownloadName(entry: DownloadHistoryEntry): string {
  const { item } = entry;
  if (item.objectKind === "attachment") return item.fileName;
  if (item.title !== null) return item.title;
  const folder = item.objectKind === "container";
  if (entry.status === "complete")
    return folder
      ? EXPLORER_LABELS.downloadsUntitledFolder
      : EXPLORER_LABELS.downloadsUntitledDocument;
  return folder
    ? EXPLORER_LABELS.downloadsUnknownFolder
    : EXPLORER_LABELS.downloadsUnknownDocument;
}

// A synced document only re-lists its file bindings when it pulls again, and
// its store may not be open, so a retry asks each document with a pending
// file directly. Only shown rows are retried: each opens and keeps a store.
// The request names the document id the row was read with.
function retryPendingFileDownloads(
  entries: ReadonlyArray<DownloadHistoryEntry>,
  retryDownload: (input: RetryDocumentDownloadInput) => Promise<boolean>,
) {
  const documents = new Map<string, string>();
  for (const { item, status } of entries) {
    if (status === "pending" && item.objectKind === "attachment")
      documents.set(item.localId, item.documentId);
  }
  for (const [localId, documentId] of documents) {
    void retryDownload({ documentId, localId }).catch(() => false);
  }
}

/** Where a finished download's row leads in Explorer. */
export interface ExplorerDownloadDestinations {
  openBlobDetail: (storageKey: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
}

// A finished file opens its stored blob, a document its info, and a folder
// its info. An orphaned document has no container route to open.
function getDownloadOpenAction(
  entry: DownloadHistoryEntry,
  destinations: ExplorerDownloadDestinations,
): ExplorerTransferOpenAction | null {
  if (entry.status !== "complete") return null;
  const name = getDownloadName(entry);
  const stored = entry.item;
  switch (stored.objectKind) {
    case "attachment":
      return {
        label: `${EXPLORER_LABELS.downloadsOpenFileAction}: ${name}`,
        onOpen: () => destinations.openBlobDetail(stored.storageKey),
      };
    case "document": {
      const { containerId } = stored;
      return containerId === null
        ? null
        : {
            label: `${EXPLORER_LABELS.downloadsOpenDocumentAction}: ${name}`,
            onOpen: () =>
              destinations.openDocumentInfoRoute(stored.localId, containerId),
          };
    }
    case "container":
      return {
        label: `${EXPLORER_LABELS.downloadsOpenFolderAction}: ${name}`,
        onOpen: () => destinations.openContainerInfoRoute(stored.localId),
      };
  }
}

function DownloadRow(params: {
  destinations: ExplorerDownloadDestinations;
  entry: DownloadHistoryEntry;
  isAuthenticated: boolean;
  lanes: ReadonlyMap<string, SyncLaneSnapshot>;
  online: boolean;
}) {
  const { entry } = params;
  const { item } = entry;
  const transfer =
    entry.status === "complete"
      ? downloadTransfer(
          "complete",
          EXPLORER_LABELS.syncLanesStatusComplete,
          null,
        )
      : pendingDownloadTransfer(
          entry.item,
          // A file downloads through its document's lane.
          entry.item.objectKind === "container"
            ? undefined
            : params.lanes.get(`documents:${entry.item.localId}`),
          params.online,
          params.isAuthenticated,
        );
  const open = getDownloadOpenAction(entry, params.destinations);
  return (
    <MiniAppTableRow
      interactive={open !== null}
      onActivate={open ? open.onOpen : undefined}
    >
      <ExplorerTransferNameCell
        open={open}
        title={item.documentId}
        transfer={transfer}
      >
        {getDownloadName(entry)}
        <small>
          {" "}
          {item.objectKind === "attachment" ? item.title : item.documentId}
        </small>
      </ExplorerTransferNameCell>
      <ExplorerTransferStatusCell transfer={transfer} />
    </MiniAppTableRow>
  );
}

/**
 * The scope's download queue plus the downloads the SDK recorded finishing,
 * which stay listed as Complete until the domain scope rotates, as Sync Lanes
 * does, whether or not this view was open when they finished.
 */
export function ExplorerDownloadsPanel(params: {
  /** The queue is read only while the database is open. */
  dbReady: boolean;
  destinations: ExplorerDownloadDestinations;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  online: boolean;
  isAuthenticated: boolean;
}) {
  const { domainScope, isAuthenticated, online } = params;
  const { documents } = useTearleads();
  const snapshot = useDomainSyncSnapshot(domainScope);
  const { entries, readNow, state } = useDownloadHistory({
    dbReady: params.dbReady,
    documentQueries: params.documentQueries,
    domainScope,
  });
  const [limit, setLimit] = useState(DOWNLOADS_ROW_LIMIT);
  const lanes = useMemo(
    () => new Map(snapshot.lanes.map((lane) => [lane.key, lane])),
    [snapshot.lanes],
  );
  const pendingCount = entries.filter(
    (entry) => entry.status === "pending",
  ).length;
  const handleRefresh = useCallback(() => {
    requestAllDomainSyncLanes(domainScope);
    retryPendingFileDownloads(entries.slice(0, limit), (input) =>
      documents.retryDownload(input),
    );
    readNow();
  }, [documents, domainScope, entries, limit, readNow]);
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
              destinations={params.destinations}
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
