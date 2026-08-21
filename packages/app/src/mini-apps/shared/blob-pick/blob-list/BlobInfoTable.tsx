import type {
  BlobInfo,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
} from "@symcrypt/client-sdk";
import { type MouseEvent, useMemo } from "react";
import { MiniAppStatus } from "../../../../components/mini-app/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  MiniAppColumnMenuButton,
  MiniAppTable,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import {
  BlobSummaryCell,
  type RenderBlobSyncCell,
  renderBlobInfoCell,
} from "./blobInfoCells";
import { useBlobInfoColumnVisibility } from "./blobListColumnPreferences";
import {
  type BlobInfoColumnId,
  getBlobInfoColumnMenuOptions,
  getBlobInfoColumns,
  getBlobInfoCompactFieldColumnIds,
  getVisibleBlobInfoColumnIds,
} from "./blobListColumns";
import { BLOB_LIST_LABELS } from "./blobListLabels";
import { EMPTY_ORGANIZATION_NAMES } from "./useBlobOrganizationNames";
import "./BlobList.css";

function BlobInfoTableContent(params: {
  activeBlob: BlobInfo | null;
  blobStore: BlobStore;
  columnCount: number;
  compact: boolean;
  error: string | null;
  isRowSelectable?: ((blob: BlobInfo) => boolean) | undefined;
  isLoading: boolean;
  online: boolean;
  onRowContextMenu?:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  renderSyncCell: RenderBlobSyncCell | undefined;
  rowHeight: number;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
  visibleColumnIds: ReadonlyArray<BlobInfoColumnId>;
}) {
  const topPadding = params.rowOffset * params.rowHeight;
  const bottomPadding =
    Math.max(0, params.totalCount - params.rowOffset - params.rows.length) *
    params.rowHeight;
  const compactFieldColumnIds = getBlobInfoCompactFieldColumnIds(
    params.visibleColumnIds,
  );

  return (
    <>
      {topPadding > 0 ? (
        <MiniAppVirtualTableSpacerRow
          colSpan={params.columnCount}
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
              onActivate={
                selectable ? () => params.onSelectBlob(blob) : undefined
              }
              onContextMenu={
                params.onRowContextMenu
                  ? (event) => params.onRowContextMenu?.(event, blob)
                  : undefined
              }
              selected={params.activeBlob?.key === blob.key}
            >
              {params.compact ? (
                <BlobSummaryCell
                  blob={blob}
                  blobStore={params.blobStore}
                  columnIds={compactFieldColumnIds}
                  online={params.online}
                  onSelectBlob={params.onSelectBlob}
                  organizationNamesById={params.organizationNamesById}
                  renderSyncCell={params.renderSyncCell}
                  selectable={selectable}
                />
              ) : (
                params.visibleColumnIds.map((columnId) =>
                  renderBlobInfoCell({
                    blob,
                    blobStore: params.blobStore,
                    columnId,
                    online: params.online,
                    onSelectBlob: params.onSelectBlob,
                    organizationNamesById: params.organizationNamesById,
                    renderSyncCell: params.renderSyncCell,
                    selectable,
                  }),
                )
              )}
            </MiniAppTableRow>
          );
        })
      ) : params.isLoading ? (
        <MiniAppTableEmptyRow colSpan={params.columnCount}>
          {BLOB_LIST_LABELS.loading}
        </MiniAppTableEmptyRow>
      ) : params.error ? (
        <MiniAppTableEmptyRow colSpan={params.columnCount}>
          {params.error}
        </MiniAppTableEmptyRow>
      ) : (
        <MiniAppTableEmptyRow colSpan={params.columnCount}>
          {BLOB_LIST_LABELS.empty}
        </MiniAppTableEmptyRow>
      )}
      {bottomPadding > 0 ? (
        <MiniAppVirtualTableSpacerRow
          colSpan={params.columnCount}
          height={bottomPadding}
        />
      ) : null}
    </>
  );
}

export function BlobInfoTable(params: {
  activeBlob: BlobInfo | null;
  bleed?: boolean | undefined;
  blobStore: BlobStore;
  // Both resolved by the caller, which owns the scroll frame and therefore the
  // only measurement of it. Deriving either here would risk a second answer
  // that disagrees with the one the window query already used.
  compact: boolean;
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
  organizationNamesById?: ReadonlyMap<string, string> | undefined;
  // Omit to drop the sync column (e.g. the Notes pick surface).
  renderSyncCell?: RenderBlobSyncCell | undefined;
  rowHeight: number;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
  totalCount: number;
}) {
  const includeSync = params.renderSyncCell !== undefined;
  const organizationNamesById =
    params.organizationNamesById ?? EMPTY_ORGANIZATION_NAMES;
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
          compact: params.compact,
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
      params.compact,
      params.onSort,
      params.sort,
    ],
  );

  return (
    <MiniAppTableFrame
      className={classNames(
        "explorer-blob-browser-table-wrap",
        "mini-app-table-frame--virtual",
        "mini-app-table-frame--compact",
        params.bleed && "mini-app-table-frame--bleed",
        // Folded rows take the taller two-line pitch; the shared modifier
        // restores it over the routed 44px floor.
        params.compact && "mini-app-table-frame--two-line",
      )}
      ref={params.frameRef}
      style={getMiniAppVirtualFrameStyle(params.rowHeight)}
    >
      <MiniAppTable aria-label={BLOB_LIST_LABELS.title} columns={columns}>
        <BlobInfoTableContent
          activeBlob={params.activeBlob}
          blobStore={params.blobStore}
          columnCount={columns.length}
          compact={params.compact}
          error={params.error}
          isLoading={params.isLoading}
          isRowSelectable={params.isRowSelectable}
          online={params.online}
          onRowContextMenu={params.onRowContextMenu}
          onSelectBlob={params.onSelectBlob}
          organizationNamesById={organizationNamesById}
          renderSyncCell={params.renderSyncCell}
          rowHeight={params.rowHeight}
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
