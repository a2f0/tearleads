import {
  type BlobInfo,
  type BlobInfoSort,
  type BlobInfoSortKey,
  type BlobStore,
  type ContainerDocumentObjectSyncState,
  createContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { type MouseEvent, type ReactNode, useMemo } from "react";
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
import {
  BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  type BlobInfoColumnId,
  getBlobInfoColumnMenuOptions,
  getBlobInfoColumns,
  getVisibleBlobInfoColumnIds,
} from "./blobListColumns";
import {
  BLOB_LIST_LABELS,
  getBlobListReferenceCountLabel,
} from "./blobListLabels";
import {
  BLOB_BROWSER_ROW_HEIGHT,
  getBlobChangedAt,
  useBlobThumbnailUrl,
} from "./blobListState";
import "./BlobList.css";

// A host that shows the sync column supplies the cell: the shared table computes
// the generic per-blob sync state and hands it back for host-specific rendering
// (e.g. the Explorer's sync badge). Omitting it drops the sync column entirely.
export type RenderBlobSyncCell = (
  syncState: ContainerDocumentObjectSyncState,
  online: boolean,
) => ReactNode;

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
  renderSyncCell: RenderBlobSyncCell | undefined;
  selectable: boolean;
}) {
  const {
    blob,
    blobStore,
    columnId,
    online,
    onSelectBlob,
    renderSyncCell,
    selectable,
  } = params;

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
          {getBlobListReferenceCountLabel(blob.referenceCount)}
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
      return renderSyncCell ? (
        <MiniAppTableCell
          key="sync"
          className="explorer-blob-browser-sync-cell"
        >
          {renderSyncCell(getBlobInfoSyncState(blob), online)}
        </MiniAppTableCell>
      ) : null;
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
  renderSyncCell: RenderBlobSyncCell | undefined;
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
                  renderSyncCell: params.renderSyncCell,
                  selectable,
                }),
              )}
            </MiniAppTableRow>
          );
        })
      ) : params.isLoading ? (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {BLOB_LIST_LABELS.loading}
        </MiniAppTableEmptyRow>
      ) : params.error ? (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {params.error}
        </MiniAppTableEmptyRow>
      ) : (
        <MiniAppTableEmptyRow colSpan={params.visibleColumnIds.length}>
          {BLOB_LIST_LABELS.empty}
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
  // Omit to drop the sync column (e.g. the Notes pick surface).
  renderSyncCell?: RenderBlobSyncCell | undefined;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
  totalCount: number;
}) {
  const includeSync = params.renderSyncCell !== undefined;
  const columnVisibility = useBlobInfoColumnVisibility();
  const visibleColumnIds = useMemo(
    () =>
      getVisibleBlobInfoColumnIds(columnVisibility.hiddenColumns, includeSync),
    [columnVisibility.hiddenColumns, includeSync],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        getBlobInfoColumns({
          hiddenColumns: columnVisibility.hiddenColumns,
          includeSync,
          onSort: params.onSort,
          sort: params.sort,
        }),
        <MiniAppColumnMenuButton
          ariaLabel={BLOB_LIST_LABELS.columnsMenuButton}
          hiddenColumns={columnVisibility.hiddenColumns}
          options={getBlobInfoColumnMenuOptions(includeSync)}
          stateLabels={{
            off: BLOB_LIST_LABELS.columnsMenuStateOff,
            on: BLOB_LIST_LABELS.columnsMenuStateOn,
          }}
          toggleColumn={columnVisibility.toggleColumn}
        />,
      ),
    [
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      includeSync,
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
      <MiniAppTable aria-label={BLOB_LIST_LABELS.title} columns={columns}>
        <BlobInfoTableContent
          activeBlob={params.activeBlob}
          blobStore={params.blobStore}
          error={params.error}
          isLoading={params.isLoading}
          isRowSelectable={params.isRowSelectable}
          online={params.online}
          onRowContextMenu={params.onRowContextMenu}
          onSelectBlob={params.onSelectBlob}
          renderSyncCell={params.renderSyncCell}
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
