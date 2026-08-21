import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
} from "@symcrypt/client-sdk";
import type { MouseEvent } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../../components/mini-app/MiniAppLayout";
import { isImageDocumentAttachmentBlob } from "../../../../document-types/shared/documentAttachmentUtils";
import { BlobInfoTable } from "./BlobInfoTable";
import type { RenderBlobSyncCell } from "./blobInfoCells";
import { BLOB_LIST_LABELS, getBlobListPickSubtitle } from "./blobListLabels";
import {
  type BlobBrowserRoute,
  type BlobInfoListState,
  useBlobBrowserData,
} from "./blobListState";

// A fresh pick opens on the full, unfiltered list; the deep-link fields only
// matter for the Explorer's browse route.
const EMPTY_PICK_ROUTE: BlobBrowserRoute = { blobId: null, storageKey: null };

// The search input over the virtualized blob table. Shared by the Explorer's
// browse mode and the pick surface below.
export function BlobListScreen(params: {
  bleed?: boolean | undefined;
  blobInfo: BlobInfoListState;
  blobStore: BlobStore;
  // The fold decision and row pitch come from the list data hook, which owns the
  // scroll frame and measures it once for both the window math and the table.
  compact: boolean;
  downloadMessage?: string | null | undefined;
  frameRef: (frame: HTMLDivElement | null) => void;
  isRowSelectable?: ((blob: BlobInfo) => boolean) | undefined;
  isWindowPending: boolean;
  onQueryChange: (value: string) => void;
  onRowContextMenu?:
    | ((event: MouseEvent<HTMLElement>, blob: BlobInfo) => void)
    | undefined;
  onSelectBlob: (blob: BlobInfo) => void;
  onSort: (key: BlobInfoSortKey) => void;
  online: boolean;
  organizationNamesById?: ReadonlyMap<string, string> | undefined;
  query: string;
  renderSyncCell?: RenderBlobSyncCell | undefined;
  rowHeight: number;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
}) {
  return (
    <>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label={BLOB_LIST_LABELS.searchPlaceholder}
          onChange={(event) => params.onQueryChange(event.currentTarget.value)}
          placeholder={BLOB_LIST_LABELS.searchPlaceholder}
          value={params.query}
        />
      </MiniAppToolbar>
      {params.downloadMessage ? (
        <MiniAppStatus tone="error">{params.downloadMessage}</MiniAppStatus>
      ) : null}
      <div className="explorer-blob-browser-screen">
        <BlobInfoTable
          activeBlob={null}
          bleed={params.bleed}
          blobStore={params.blobStore}
          compact={params.compact}
          error={params.blobInfo.error}
          frameRef={params.frameRef}
          isLoading={params.blobInfo.isLoading || params.isWindowPending}
          isRowSelectable={params.isRowSelectable}
          online={params.online}
          onRowContextMenu={params.onRowContextMenu}
          onSelectBlob={params.onSelectBlob}
          onSort={params.onSort}
          organizationNamesById={params.organizationNamesById}
          renderSyncCell={params.renderSyncCell}
          rowHeight={params.rowHeight}
          rowOffset={params.rowOffset}
          rows={params.rows}
          sort={params.sort}
          totalCount={params.blobInfo.totalCount}
        />
      </div>
    </>
  );
}

function BlobPickHeader(params: { onCancel: () => void; slotLabel: string }) {
  const { onCancel, slotLabel } = params;

  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{BLOB_LIST_LABELS.pickTitle}</strong>
        <span>{getBlobListPickSubtitle(slotLabel)}</span>
      </MiniAppHeaderCopy>
      <MiniAppActions>
        <MiniAppButton onClick={onCancel}>
          {BLOB_LIST_LABELS.pickCancelAction}
        </MiniAppButton>
      </MiniAppActions>
    </MiniAppHeader>
  );
}

// Pick mode: choose an image blob for a document slot. Self-contained (owns its
// list data) so any mini-app can render it directly; only image blobs bind to
// image slots, so non-image rows are shown but not selectable, and a row click
// resolves the pick.
export function BlobPickSurface(params: {
  bleed?: boolean | undefined;
  blobStore: BlobStore;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  onCancel: () => void;
  online: boolean;
  onPickBlob: (blob: BlobInfo) => void;
  organizationNamesById?: ReadonlyMap<string, string> | undefined;
  renderSyncCell?: RenderBlobSyncCell | undefined;
  slotLabel: string;
}) {
  const data = useBlobBrowserData({
    loadBlobInfo: params.loadBlobInfo,
    route: EMPTY_PICK_ROUTE,
  });

  return (
    <>
      <BlobPickHeader onCancel={params.onCancel} slotLabel={params.slotLabel} />
      <BlobListScreen
        bleed={params.bleed}
        blobInfo={data.blobInfo}
        blobStore={params.blobStore}
        compact={data.compact}
        frameRef={data.frameRef}
        // Filtering non-image rows out of the windowed list would desync the
        // virtual-scroll padding from the total count, so disable instead.
        isRowSelectable={isImageDocumentAttachmentBlob}
        isWindowPending={data.isWindowPending}
        onQueryChange={data.handleQueryChange}
        onSelectBlob={params.onPickBlob}
        onSort={data.handleSort}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
        query={data.query}
        renderSyncCell={params.renderSyncCell}
        rowHeight={data.rowHeight}
        rowOffset={data.rowOffset}
        rows={data.rows}
        sort={data.sort}
      />
    </>
  );
}
