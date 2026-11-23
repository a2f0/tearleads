import type {
  DomainScope,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@tearleads/client-sdk";
import { useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import { useDomainSyncSnapshot } from "../../../../providers/sdk/useDomainSyncSnapshot";
import type { ExplorerUploadItem } from "../../../../stores/explorer/explorerUploadItemMachine";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { getExplorerUploadStatusText } from "../../hooks/explorerUploadState";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import {
  EXPLORER_LABELS,
  getExplorerSyncLaneUploadProgressLabel,
  getExplorerUploadsSummaryLabel,
} from "../../labels";
import { ExplorerOutgoingSectionFrame } from "./ExplorerOutgoingSectionFrame";
import {
  ExplorerTransferNameCell,
  type ExplorerTransferProgress,
  ExplorerTransferStatusCell,
  getExplorerTransferStatusPercent,
} from "./ExplorerTransferCells";

type SyncLaneProgress = NonNullable<SyncLaneSnapshot["progress"]>;

// Rows shown before the user asks for more; a 1000-file stress upload should
// not render a 1000-row table by default.
const UPLOADS_ROW_LIMIT = 100;

const UPLOADS_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  // The file flexes so its progress bar spans the rest of the row.
  { header: EXPLORER_LABELS.uploadsFileColumn, id: "file" },
  { header: EXPLORER_LABELS.uploadsSizeColumn, id: "size", width: "7rem" },
  { header: EXPLORER_LABELS.uploadsStatusColumn, id: "status", width: "11rem" },
];

// The panel-facing status: the item's own lifecycle, refined for "imported"
// items by the document's sync lane so the tail of an upload (local ingest
// done, bytes still moving) stays visible until the SDK confirms it synced.
type ExplorerUploadDerivedStatus =
  | Exclude<ExplorerUploadItem["status"], "imported">
  | "pending-sync"
  | "sync-queued"
  | "uploading"
  | "sync-failed";

export function deriveExplorerUploadItemStatus(
  item: ExplorerUploadItem,
  lane: SyncLaneSnapshot | undefined,
): ExplorerUploadDerivedStatus {
  if (item.status !== "imported") {
    return item.status;
  }
  switch (lane?.status) {
    case "queued":
      return "sync-queued";
    case "running":
      return "uploading";
    case "error":
      return "sync-failed";
    default:
      // A completed lane still waits for the SDK to confirm nothing is left.
      return "pending-sync";
  }
}

const UPLOAD_STATUS_DISPLAY: Record<
  ExplorerUploadDerivedStatus,
  { label: string; status: SyncLaneStatus }
> = {
  cancelled: { label: EXPLORER_LABELS.uploadsCancelledStatus, status: "idle" },
  failed: { label: EXPLORER_LABELS.uploadsFailedStatus, status: "error" },
  importing: {
    label: EXPLORER_LABELS.uploadsImportingStatus,
    status: "running",
  },
  "pending-sync": {
    label: EXPLORER_LABELS.uploadsPendingSyncStatus,
    status: "queued",
  },
  queued: { label: EXPLORER_LABELS.uploadsQueuedStatus, status: "queued" },
  // Deleted before its upload was confirmed.
  removed: { label: EXPLORER_LABELS.uploadsRemovedStatus, status: "idle" },
  "sync-failed": {
    label: EXPLORER_LABELS.uploadsSyncFailedStatus,
    status: "error",
  },
  "sync-queued": {
    label: EXPLORER_LABELS.uploadsSyncQueuedStatus,
    status: "queued",
  },
  uploaded: {
    label: EXPLORER_LABELS.syncLanesStatusComplete,
    status: "complete",
  },
  uploading: {
    label: EXPLORER_LABELS.uploadsUploadingStatus,
    status: "running",
  },
};

const OUTSTANDING_UPLOAD_STATUSES: ReadonlySet<ExplorerUploadDerivedStatus> =
  new Set(["queued", "importing", "pending-sync", "sync-queued", "uploading"]);

/** The summed byte progress of the item's attachment uploads, if any began. */
function getUploadByteProgress(
  item: ExplorerUploadItem,
  blobLanesByStorageKey: ReadonlyMap<string, SyncLaneSnapshot>,
): SyncLaneProgress | null {
  const reported = item.storageKeys.flatMap((storageKey) => {
    const progress = blobLanesByStorageKey.get(storageKey)?.progress;
    return progress ? [progress] : [];
  });
  const total = reported.reduce<SyncLaneProgress>(
    (sum, progress) => ({
      bytesTotal: sum.bytesTotal + progress.bytesTotal,
      bytesUploaded: sum.bytesUploaded + progress.bytesUploaded,
      partsCompleted: sum.partsCompleted + progress.partsCompleted,
      partsTotal: sum.partsTotal + progress.partsTotal,
    }),
    { bytesTotal: 0, bytesUploaded: 0, partsCompleted: 0, partsTotal: 0 },
  );
  return total.bytesTotal > 0 ? total : null;
}

function getUploadTransfer(
  item: ExplorerUploadItem,
  derived: ExplorerUploadDerivedStatus,
  input: {
    byteProgress: SyncLaneProgress | null;
    laneError: string | null;
  },
): ExplorerTransferProgress {
  const display = UPLOAD_STATUS_DISPLAY[derived];
  const { byteProgress } = input;
  // Transferred bytes drive the bar while the item awaits confirmation; the
  // Sync Lanes status fill stands in when no attachment upload reported.
  const showBytes = item.status === "imported" && byteProgress !== null;
  return {
    detail:
      item.error ??
      input.laneError ??
      (showBytes ? getExplorerSyncLaneUploadProgressLabel(byteProgress) : null),
    label: display.label,
    percent: showBytes
      ? Math.round((byteProgress.bytesUploaded / byteProgress.bytesTotal) * 100)
      : getExplorerTransferStatusPercent(display.status),
    status: display.status,
  };
}

interface UploadRow {
  derived: ExplorerUploadDerivedStatus;
  item: ExplorerUploadItem;
  transfer: ExplorerTransferProgress;
}

function UploadsTable(params: { rows: ReadonlyArray<UploadRow> }) {
  const [rowLimit, setRowLimit] = useState(UPLOADS_ROW_LIMIT);
  const visibleRows = params.rows.slice(0, rowLimit);

  return (
    <MiniAppTableFrame className="mini-app-table-frame--bleed">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.uploadsTitle}
        columns={UPLOADS_COLUMNS}
      >
        {visibleRows.map((row) => (
          <MiniAppTableRow key={row.item.id}>
            <ExplorerTransferNameCell transfer={row.transfer}>
              {row.item.fileName}
            </ExplorerTransferNameCell>
            <MiniAppTableCell>
              <MiniAppTableText>
                {formatByteLength(row.item.fileSize)}
              </MiniAppTableText>
            </MiniAppTableCell>
            <ExplorerTransferStatusCell announceError transfer={row.transfer} />
          </MiniAppTableRow>
        ))}
        {params.rows.length > rowLimit ? (
          <MiniAppTableEmptyRow colSpan={UPLOADS_COLUMNS.length}>
            <MiniAppButton
              onClick={() => setRowLimit((limit) => limit + UPLOADS_ROW_LIMIT)}
              variant="ghost"
            >
              {EXPLORER_LABELS.uploadsShowMoreAction}
            </MiniAppButton>
          </MiniAppTableEmptyRow>
        ) : null}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function useUploadRows(
  items: ReadonlyArray<ExplorerUploadItem>,
  lanes: ReadonlyArray<SyncLaneSnapshot>,
): ReadonlyArray<UploadRow> {
  return useMemo(() => {
    const lanesByKey = new Map(lanes.map((lane) => [lane.key, lane]));
    const blobLanesByStorageKey = new Map(
      lanes.flatMap((lane) =>
        lane.blobStorageKey === null ? [] : [[lane.blobStorageKey, lane]],
      ),
    );
    return items
      .map((item): UploadRow => {
        const lane = item.localId
          ? lanesByKey.get(`documents:${item.localId}`)
          : undefined;
        const derived = deriveExplorerUploadItemStatus(item, lane);
        return {
          derived,
          item,
          transfer: getUploadTransfer(item, derived, {
            byteProgress: getUploadByteProgress(item, blobLanesByStorageKey),
            laneError:
              item.status === "imported" ? (lane?.lastError ?? null) : null,
          }),
        };
      })
      .reverse();
  }, [items, lanes]);
}

interface ExplorerUploadsPanelProps {
  domainScope: DomainScope;
  uploadManager: ExplorerUploadManager;
}

/**
 * The Outgoing tab's Uploads section: every file from every upload entry
 * point, newest selection first, traceable from "Queued" through "Complete".
 * Files whose upload the SDK confirmed stay listed as Complete for the
 * scope's lifetime, as Downloads and Sync Lanes do. The Cancel here stops
 * this window's queued and importing files (the container detail's status
 * line only covers the folder it targets); another Explorer window's files
 * are listed but cancelled from that window. The tab owns Refresh.
 */
export function ExplorerUploadsPanel(params: ExplorerUploadsPanelProps) {
  const { domainScope, uploadManager } = params;
  const syncSnapshot = useDomainSyncSnapshot(domainScope);
  const rows = useUploadRows(uploadManager.items, syncSnapshot.lanes);
  const outstandingCount = rows.filter((row) =>
    OUTSTANDING_UPLOAD_STATUSES.has(row.derived),
  ).length;
  const activeStatusText = getExplorerUploadStatusText(
    uploadManager.run,
    uploadManager.queuedFileCount,
  );

  return (
    <ExplorerOutgoingSectionFrame
      section="uploads"
      summary={getExplorerUploadsSummaryLabel({
        outstandingCount,
        totalCount: rows.length,
      })}
      title={EXPLORER_LABELS.uploadsTitle}
    >
      {activeStatusText !== null &&
      (uploadManager.isImporting || uploadManager.queuedFileCount > 0) ? (
        <MiniAppStatus as="span" className="explorer-detail-import-status">
          {activeStatusText}
          <MiniAppButton onClick={uploadManager.cancel} variant="ghost">
            {EXPLORER_LABELS.fileImportCancelAction}
          </MiniAppButton>
        </MiniAppStatus>
      ) : null}
      {rows.length === 0 ? (
        <MiniAppTableFrame className="mini-app-table-frame--bleed">
          <MiniAppTable
            aria-label={EXPLORER_LABELS.uploadsTitle}
            columns={UPLOADS_COLUMNS}
          >
            <MiniAppTableEmptyRow colSpan={UPLOADS_COLUMNS.length}>
              <span role="status">{EXPLORER_LABELS.uploadsEmpty}</span>
            </MiniAppTableEmptyRow>
          </MiniAppTable>
        </MiniAppTableFrame>
      ) : (
        <UploadsTable rows={rows} />
      )}
    </ExplorerOutgoingSectionFrame>
  );
}
