import {
  type BlobInfo,
  type BlobInfoSort,
  type BlobInfoSortKey,
  type BlobStore,
  type ContainerDocumentObjectSyncState,
  createContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import { MiniAppStatus } from "../../../../components/shared/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  MiniAppColumnMenuButton,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  useMiniAppColumnVisibility,
} from "../../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../../components/shared/MiniAppVirtual";
import { getAttachmentFileType } from "../../../../document-types/shared/attachmentFileType";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../../ExplorerSyncStateBadge";
import {
  EXPLORER_LABELS,
  getExplorerBlobBrowserReferenceCountLabel,
} from "../../labels";
import {
  BLOB_INFO_COLUMN_MENU_OPTIONS,
  BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  type BlobInfoColumnId,
  getBlobInfoColumns,
  getVisibleBlobInfoColumnIds,
} from "./ExplorerBlobBrowserColumns";
import {
  BLOB_BROWSER_ROW_HEIGHT,
  getBlobChangedAt,
  useBlobThumbnailUrl,
} from "./ExplorerBlobBrowserState";
import "./ExplorerBlobInfoTable.css";

const BLOB_INFO_COLUMN_STORAGE_KEY =
  "tearleads.explorer.blob-browser:hidden-columns";

function useBlobInfoColumnVisibility() {
  return useMiniAppColumnVisibility<BlobInfoColumnId>({
    storageKey: BLOB_INFO_COLUMN_STORAGE_KEY,
    toggleableColumnIds: BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  });
}

function getBlobInfoSyncState(
  blob: BlobInfo,
): ContainerDocumentObjectSyncState {
  const pendingReferences = blob.references.filter(
    (reference) => reference.attachmentKind === "pending",
  );

  return createContainerDocumentObjectSyncState({
    localOnly: !blob.blobId && pendingReferences.length === 0,
    pendingAttachmentBytes: pendingReferences.reduce(
      (total, reference) => total + reference.byteLength,
      0,
    ),
    pendingAttachmentCount: pendingReferences.length,
  });
}

// The identity cell hides the blob id and shows a thumbnail instead: an image
// blob renders its bytes inline, everything else falls back to a file-type icon.
// The id stays reachable via the button's accessible name and the cell tooltip.
function BlobIdentityCell(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  onSelectBlob: (blob: BlobInfo) => void;
  selectable: boolean;
}) {
  const { blob, blobStore, onSelectBlob, selectable } = params;
  const thumbnailUrl = useBlobThumbnailUrl({ blob, blobStore });
  const { Icon, isImage } = getAttachmentFileType({
    mimeType: blob.mimeType,
    name: blob.name,
  });
  const identity = blob.blobId ?? blob.storageKey;

  return (
    // Browsers don't reliably show a `title` on a disabled button, so the
    // not-selectable hint lives on the (never-disabled) cell, which resolves the
    // tooltip for the button it wraps.
    <MiniAppTableCell
      title={selectable ? identity : "Only image blobs can be attached."}
    >
      <MiniAppTableActionButton
        aria-label={identity}
        className="explorer-blob-browser-row-button"
        disabled={!selectable}
        onClick={() => onSelectBlob(blob)}
      >
        <span className="explorer-blob-browser-thumb">
          {isImage && thumbnailUrl ? (
            <img
              alt=""
              className="explorer-blob-browser-thumb-image"
              src={thumbnailUrl}
            />
          ) : (
            <Icon
              aria-hidden
              className="explorer-blob-browser-thumb-icon"
              size={20}
            />
          )}
        </span>
      </MiniAppTableActionButton>
    </MiniAppTableCell>
  );
}

function renderBlobInfoCell(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  columnId: BlobInfoColumnId;
  online: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  selectable: boolean;
}) {
  const { blob, blobStore, columnId, online, onSelectBlob, selectable } =
    params;

  switch (columnId) {
    case "blob":
      return (
        <BlobIdentityCell
          blob={blob}
          blobStore={blobStore}
          key="blob"
          onSelectBlob={onSelectBlob}
          selectable={selectable}
        />
      );
    case "mime":
      return (
        <MiniAppTableCell key="mime">{blob.mimeType ?? "-"}</MiniAppTableCell>
      );
    case "size":
      return (
        <MiniAppTableCell key="size">
          {formatByteLength(blob.byteLength)}
        </MiniAppTableCell>
      );
    case "references":
      return (
        <MiniAppTableCell key="references">
          {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
        </MiniAppTableCell>
      );
    case "updated":
      return (
        <MiniAppTableCell
          key="updated"
          title={getBlobChangedAt(blob) ?? undefined}
        >
          {formatMiniAppDateTime(getBlobChangedAt(blob), {
            emptyFallback: "-",
          })}
        </MiniAppTableCell>
      );
    case "sync":
      return (
        <MiniAppTableCell
          key="sync"
          className="explorer-blob-browser-sync-cell"
        >
          <ExplorerSyncStateBadge
            online={online}
            showSynced
            syncState={getBlobInfoSyncState(blob)}
          />
        </MiniAppTableCell>
      );
  }
}

function BlobInfoTableContent(params: {
  activeBlob: BlobInfo | null;
  blobStore: BlobStore;
  error: string | null;
  isRowSelectable?: ((blob: BlobInfo) => boolean) | undefined;
  isLoading: boolean;
  online: boolean;
  onRowContextMenu?:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
  visibleColumnIds: ReadonlyArray<BlobInfoColumnId>;
}) {
  const topPadding = params.rowOffset * BLOB_BROWSER_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, params.totalCount - params.rowOffset - params.rows.length) *
    BLOB_BROWSER_ROW_HEIGHT;

  return (
    <>
      {topPadding > 0 ? (
        <MiniAppVirtualTableSpacerRow
          colSpan={params.visibleColumnIds.length}
          height={topPadding}
        />
      ) : null}
      {params.rows.length > 0 ? (
        params.rows.map((blob) => {
          const selectable = params.isRowSelectable
            ? params.isRowSelectable(blob)
            : true;
          return (
            <MiniAppTableRow
              className="explorer-blob-browser-table-row"
              interactive
              key={blob.key}
              onContextMenu={
                params.onRowContextMenu
                  ? (event) => params.onRowContextMenu?.(event, blob)
                  : undefined
              }
              selected={params.activeBlob?.key === blob.key}
            >
              {params.visibleColumnIds.map((columnId) =>
                renderBlobInfoCell({
                  blob,
                  blobStore: params.blobStore,
                  columnId,
                  online: params.online,
                  onSelectBlob: params.onSelectBlob,
                  selectable,
                }),
              )}
            </MiniAppTableRow>
          );
        })
      ) : params.isLoading ? (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {EXPLORER_LABELS.blobBrowserLoading}
        </MiniAppTableEmptyRow>
      ) : params.error ? (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {params.error}
        </MiniAppTableEmptyRow>
      ) : (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {EXPLORER_LABELS.blobBrowserEmpty}
        </MiniAppTableEmptyRow>
      )}
      {bottomPadding > 0 ? (
        <MiniAppVirtualTableSpacerRow
          colSpan={params.visibleColumnIds.length}
          height={bottomPadding}
        />
      ) : null}
    </>
  );
}

export function BlobInfoTable(params: {
  activeBlob: BlobInfo | null;
  blobStore: BlobStore;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
  // When provided, rows that fail the predicate are shown but not selectable
  // (pick mode: only image blobs bind to image slots).
  isRowSelectable?: ((blob: BlobInfo) => boolean) | undefined;
  isLoading: boolean;
  online: boolean;
  onRowContextMenu?:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  onSort: (key: BlobInfoSortKey) => void;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
  totalCount: number;
}) {
  const columnVisibility = useBlobInfoColumnVisibility();
  const visibleColumnIds = useMemo(
    () => getVisibleBlobInfoColumnIds(columnVisibility.hiddenColumns),
    [columnVisibility.hiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        getBlobInfoColumns({
          hiddenColumns: columnVisibility.hiddenColumns,
          onSort: params.onSort,
          sort: params.sort,
        }),
        <MiniAppColumnMenuButton
          ariaLabel={EXPLORER_LABELS.columnsMenuButton}
          hiddenColumns={columnVisibility.hiddenColumns}
          options={BLOB_INFO_COLUMN_MENU_OPTIONS}
          stateLabels={{
            off: EXPLORER_LABELS.columnsMenuStateOff,
            on: EXPLORER_LABELS.columnsMenuStateOn,
          }}
          toggleColumn={columnVisibility.toggleColumn}
        />,
      ),
    [
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      params.onSort,
      params.sort,
    ],
  );

  return (
    <MiniAppTableFrame
      className="explorer-blob-browser-table-wrap mini-app-table-frame--virtual mini-app-table-frame--compact"
      ref={params.frameRef}
      style={getMiniAppVirtualFrameStyle(BLOB_BROWSER_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={EXPLORER_LABELS.blobBrowserTitle}
        columns={columns}
      >
        <BlobInfoTableContent
          activeBlob={params.activeBlob}
          blobStore={params.blobStore}
          error={params.error}
          isLoading={params.isLoading}
          isRowSelectable={params.isRowSelectable}
          online={params.online}
          onRowContextMenu={params.onRowContextMenu}
          onSelectBlob={params.onSelectBlob}
          rowOffset={params.rowOffset}
          rows={params.rows}
          totalCount={params.totalCount}
          visibleColumnIds={visibleColumnIds}
        />
      </MiniAppTable>
      {params.totalCount > params.rows.length ? (
        <MiniAppStatus as="span">
          {params.rows.length}/{params.totalCount}
        </MiniAppStatus>
      ) : null}
    </MiniAppTableFrame>
  );
}
