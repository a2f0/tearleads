import type {
  BlobInfo,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
} from "@tearleads/client-sdk";
import type { MouseEvent } from "react";
import {
  MiniAppItemGrid,
  MiniAppItemGridHeader,
  MiniAppItemTile,
} from "../../../../components/mini-app/item-view/MiniAppItemGrid";
import { MiniAppStatus } from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppTableFrame } from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { BlobListCompactSortHeader } from "./BlobListCompactSortHeader";
import { BlobThumbnail, getBlobIdentityTitle } from "./blobInfoCells";
import { BLOB_LIST_LABELS } from "./blobListLabels";
import { getBlobDisplayName } from "./blobListState";
import "./BlobList.css";

function getBlobKey(blob: BlobInfo): string {
  return blob.key;
}

function getBlobGridStatus(params: {
  error: string | null;
  isLoading: boolean;
}): string {
  if (params.isLoading) {
    return BLOB_LIST_LABELS.loading;
  }

  return params.error ?? BLOB_LIST_LABELS.empty;
}

function BlobInfoTile(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  onContextMenu:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  selectable: boolean;
}) {
  const { blob, onContextMenu, selectable } = params;
  const tile = (
    <MiniAppItemTile
      disabled={!selectable}
      label={getBlobDisplayName(blob)}
      onClick={() => params.onSelectBlob(blob)}
      onContextMenu={
        onContextMenu ? (event) => onContextMenu(event, blob) : undefined
      }
      visual={<BlobThumbnail blob={blob} blobStore={params.blobStore} fill />}
    />
  );

  // A disabled button does not reliably show its own `title`, so the
  // not-selectable hint rides on a wrapper that is never disabled.
  return selectable ? (
    tile
  ) : (
    <span
      className="blob-list-tile-hint"
      title={getBlobIdentityTitle(blob, false)}
    >
      {tile}
    </span>
  );
}

/**
 * The grid view of the blob list: square tiles in lines, windowed the way the
 * table windows rows. The list data hook counts columns from the frame it
 * measured and fetches whole lines, so `rowOffset` and `rows` arrive in blobs
 * and `columns` turns them back into lines here.
 *
 * Sorting keeps the folded table's single sort menu, pinned above the tiles.
 */
export function BlobInfoGrid(params: {
  bleed?: boolean | undefined;
  blobStore: BlobStore;
  columns: number;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
  // When provided, blobs that fail the predicate are shown but not selectable
  // (pick mode: only blobs the slot accepts bind to it).
  isRowSelectable?: ((blob: BlobInfo) => boolean) | undefined;
  isLoading: boolean;
  onRowContextMenu?:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  onSort: (key: BlobInfoSortKey) => void;
  // The pitch the list data hook's window math used: one line of tiles.
  rowHeight: number;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
  totalCount: number;
}) {
  const { isRowSelectable } = params;

  return (
    <MiniAppTableFrame
      className={classNames(
        "blob-list-grid-frame",
        params.bleed && "mini-app-table-frame--bleed",
      )}
      ref={params.frameRef}
      style={getMiniAppVirtualFrameStyle(params.rowHeight)}
    >
      <MiniAppItemGridHeader>
        <BlobListCompactSortHeader onSort={params.onSort} sort={params.sort} />
      </MiniAppItemGridHeader>
      <MiniAppItemGrid
        aria-label={BLOB_LIST_LABELS.title}
        columns={params.columns}
        getItemKey={getBlobKey}
        itemOffset={params.rowOffset}
        items={params.rows}
        renderItem={(blob) => (
          <BlobInfoTile
            blob={blob}
            blobStore={params.blobStore}
            onContextMenu={params.onRowContextMenu}
            onSelectBlob={params.onSelectBlob}
            selectable={isRowSelectable ? isRowSelectable(blob) : true}
          />
        )}
        status={getBlobGridStatus(params)}
        totalCount={params.totalCount}
      />
      {params.totalCount > params.rows.length ? (
        <MiniAppStatus as="span">
          {params.rows.length}/{params.totalCount}
        </MiniAppStatus>
      ) : null}
    </MiniAppTableFrame>
  );
}
