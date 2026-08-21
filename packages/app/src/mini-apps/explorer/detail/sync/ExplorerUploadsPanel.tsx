import type { DomainScope, SyncLaneSnapshot } from "@symcrypt/client-sdk";
import { useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
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
import { formatByteLength } from "../../../../utils/formatByteLength";
import {
  type ExplorerUploadItem,
  getExplorerUploadStatusText,
} from "../../hooks/explorerUploadState";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS, getExplorerUploadsSummaryLabel } from "../../labels";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";

// Rows shown before the user asks for more; a 1000-file stress upload should
// not render a 1000-row table by default.
const UPLOADS_ROW_LIMIT = 100;

const UPLOADS_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: EXPLORER_LABELS.uploadsFileColumn, id: "file", width: "18rem" },
  { header: EXPLORER_LABELS.uploadsSizeColumn, id: "size", width: "7rem" },
  { header: EXPLORER_LABELS.uploadsStatusColumn, id: "status", width: "10rem" },
];

// The panel-facing status: the manager's ingest lifecycle, refined for
// "imported" items by the document's sync lane so the tail of an upload
// (local ingest done, bytes still moving) stays visible.
type ExplorerUploadDerivedStatus =
  | ExplorerUploadItem["status"]
  | "pending-sync"
  | "sync-queued"
  | "uploading"
  | "uploaded"
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
    case "complete":
      return "uploaded";
    case "error":
      return "sync-failed";
    default:
      return "pending-sync";
  }
}

const UPLOAD_STATUS_LABELS: Record<ExplorerUploadDerivedStatus, string> = {
  cancelled: EXPLORER_LABELS.uploadsCancelledStatus,
  failed: EXPLORER_LABELS.uploadsFailedStatus,
  imported: EXPLORER_LABELS.uploadsPendingSyncStatus,
  importing: EXPLORER_LABELS.uploadsImportingStatus,
  "pending-sync": EXPLORER_LABELS.uploadsPendingSyncStatus,
  queued: EXPLORER_LABELS.uploadsQueuedStatus,
  "sync-failed": EXPLORER_LABELS.uploadsSyncFailedStatus,
  "sync-queued": EXPLORER_LABELS.uploadsSyncQueuedStatus,
  uploaded: EXPLORER_LABELS.uploadsUploadedStatus,
  uploading: EXPLORER_LABELS.uploadsUploadingStatus,
};

function isUploadFailure(status: ExplorerUploadDerivedStatus): boolean {
  return status === "failed" || status === "sync-failed";
}

interface UploadRow {
  item: ExplorerUploadItem;
  status: ExplorerUploadDerivedStatus;
  statusDetail: string | null;
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
            <MiniAppTableCell>
              <MiniAppTableText>{row.item.fileName}</MiniAppTableText>
            </MiniAppTableCell>
            <MiniAppTableCell>
              <MiniAppTableText>
                {formatByteLength(row.item.fileSize)}
              </MiniAppTableText>
            </MiniAppTableCell>
            <MiniAppTableCell>
              <MiniAppTableText
                {...(row.statusDetail === null
                  ? {}
                  : { title: row.statusDetail })}
              >
                {isUploadFailure(row.status) ? (
                  <span role="alert">{UPLOAD_STATUS_LABELS[row.status]}</span>
                ) : (
                  UPLOAD_STATUS_LABELS[row.status]
                )}
              </MiniAppTableText>
            </MiniAppTableCell>
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

interface ExplorerUploadsPanelProps {
  domainScope: DomainScope;
  uploadManager: ExplorerUploadManager;
}

/**
 * The session-wide upload queue: every file from every upload entry point,
 * newest selection first, with the ingest lifecycle refined by sync-lane
 * telemetry so an item is traceable from "queued" through "uploaded". This is
 * the global surface for the manager's Cancel (the container detail's status
 * line only covers the folder it targets).
 */
export function ExplorerUploadsPanel(params: ExplorerUploadsPanelProps) {
  const { uploadManager } = params;
  const syncSnapshot = useDomainSyncSnapshot(params.domainScope);
  const rows = useMemo(() => {
    const lanesByKey = new Map(
      syncSnapshot.lanes.map((lane) => [lane.key, lane]),
    );
    return uploadManager.items
      .map((item): UploadRow => {
        const lane = item.localId
          ? lanesByKey.get(`documents:${item.localId}`)
          : undefined;
        const status = deriveExplorerUploadItemStatus(item, lane);
        return {
          item,
          status,
          statusDetail: item.error ?? lane?.lastError ?? null,
        };
      })
      .reverse();
  }, [syncSnapshot, uploadManager.items]);
  const outstandingCount = rows.filter(
    (row) =>
      row.status === "queued" ||
      row.status === "importing" ||
      row.status === "pending-sync" ||
      row.status === "sync-queued" ||
      row.status === "uploading",
  ).length;
  const activeStatusText = getExplorerUploadStatusText(
    uploadManager.run,
    uploadManager.queuedFileCount,
  );

  return (
    <MiniAppPanel className="explorer-detail explorer-detail--uploads" scroll>
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.uploadsTitle}</strong>
          <span>
            {getExplorerUploadsSummaryLabel({
              outstandingCount,
              totalCount: rows.length,
            })}
          </span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
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
    </MiniAppPanel>
  );
}
