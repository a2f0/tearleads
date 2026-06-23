import type {
  BlobInfo,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInfoSection,
  MiniAppInput,
  MiniAppPanel,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppInfoTable,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/shared/MiniAppVirtual";
import { formatByteLength } from "../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerBlobBrowserDocumentCountLabel,
  getExplorerBlobBrowserReferenceCountLabel,
} from "../labels";
import { compactId } from "./compactId";
import { getBlobInfoColumns } from "./ExplorerBlobBrowserColumns";
import {
  BLOB_BROWSER_ROW_HEIGHT,
  type BlobInfoListState,
  type BlobPreviewState,
  getBlobChangedAt,
  isImageMimeType,
  useBlobPreview,
} from "./ExplorerBlobBrowserState";
import { BlobReferencesSection } from "./ExplorerBlobReferencesSection";

function BlobInfoTable(params: {
  activeBlob: BlobInfo | null;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
  isLoading: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  onSort: (key: BlobInfoSortKey) => void;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
  totalCount: number;
}) {
  const columns = useMemo(
    () => getBlobInfoColumns({ onSort: params.onSort, sort: params.sort }),
    [params.onSort, params.sort],
  );
  const topPadding = params.rowOffset * BLOB_BROWSER_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, params.totalCount - params.rowOffset - params.rows.length) *
    BLOB_BROWSER_ROW_HEIGHT;

  return (
    <MiniAppTableFrame
      className="explorer-blob-browser-table-wrap mini-app-table-frame--virtual"
      ref={params.frameRef}
      style={getMiniAppVirtualFrameStyle(BLOB_BROWSER_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={EXPLORER_LABELS.blobBrowserTitle}
        columns={columns}
      >
        {topPadding > 0 ? (
          <MiniAppVirtualTableSpacerRow
            colSpan={columns.length}
            height={topPadding}
          />
        ) : null}
        {params.rows.length > 0 ? (
          params.rows.map((blob) => (
            <MiniAppTableRow
              className="explorer-blob-browser-table-row"
              interactive
              key={blob.key}
              selected={params.activeBlob?.key === blob.key}
            >
              <MiniAppTableCell title={blob.blobId ?? blob.storageKey}>
                <MiniAppTableActionButton
                  className="explorer-blob-browser-row-button"
                  onClick={() => params.onSelectBlob(blob)}
                >
                  {compactId(blob.blobId ?? blob.storageKey)}
                </MiniAppTableActionButton>
              </MiniAppTableCell>
              <MiniAppTableCell>{blob.mimeType ?? "-"}</MiniAppTableCell>
              <MiniAppTableCell>
                {formatByteLength(blob.byteLength)}
              </MiniAppTableCell>
              <MiniAppTableCell>
                {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
              </MiniAppTableCell>
              <MiniAppTableCell title={getBlobChangedAt(blob) ?? undefined}>
                {formatMiniAppDateTime(getBlobChangedAt(blob), {
                  emptyFallback: "-",
                })}
              </MiniAppTableCell>
            </MiniAppTableRow>
          ))
        ) : params.isLoading ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.blobBrowserLoading}
          </MiniAppTableEmptyRow>
        ) : params.error ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {params.error}
          </MiniAppTableEmptyRow>
        ) : (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.blobBrowserEmpty}
          </MiniAppTableEmptyRow>
        )}
        {bottomPadding > 0 ? (
          <MiniAppVirtualTableSpacerRow
            colSpan={columns.length}
            height={bottomPadding}
          />
        ) : null}
      </MiniAppTable>
      {params.totalCount > params.rows.length ? (
        <MiniAppStatus as="span">
          {params.rows.length}/{params.totalCount}
        </MiniAppStatus>
      ) : null}
    </MiniAppTableFrame>
  );
}

function BlobMetadataSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserMetadataHeading}>
      <MiniAppInfoTable>
        <tbody>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserIdRow}</th>
            <td title={blob.blobId ?? undefined}>{compactId(blob.blobId)}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserStorageKeyRow}</th>
            <td title={blob.storageKey}>{compactId(blob.storageKey)}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserMimeTypeRow}</th>
            <td>{blob.mimeType ?? "-"}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserByteLengthRow}</th>
            <td>
              {formatByteLength(
                preview.status === "ready"
                  ? preview.byteLength
                  : blob.byteLength,
              )}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserReferenceColumn}</th>
            <td>
              {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
              {", "}
              {getExplorerBlobBrowserDocumentCountLabel(blob.documentCount)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserUpdatedRow}</th>
            <td title={getBlobChangedAt(blob) ?? undefined}>
              {formatMiniAppDateTime(getBlobChangedAt(blob), {
                emptyFallback: "-",
              })}
            </td>
          </tr>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function BlobPreviewContent(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  if (preview.status === "loading") {
    return <MiniAppStatus>{EXPLORER_LABELS.blobBrowserLoading}</MiniAppStatus>;
  }

  if (preview.status === "missing") {
    return (
      <MiniAppStatus>
        {EXPLORER_LABELS.blobBrowserLocalBytesMissing}
      </MiniAppStatus>
    );
  }

  if (preview.status === "error") {
    return <MiniAppStatus tone="error">{preview.error}</MiniAppStatus>;
  }

  if (preview.status !== "ready") {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoPreview}</MiniAppStatus>
    );
  }

  if (preview.url && isImageMimeType(blob.mimeType)) {
    return (
      <img
        alt={blob.name ?? blob.blobId ?? blob.storageKey}
        className="explorer-blob-preview-image"
        src={preview.url}
      />
    );
  }

  if (preview.text !== null) {
    return (
      <>
        <pre className="explorer-blob-preview-text">{preview.text}</pre>
        {preview.truncated ? (
          <MiniAppStatus>
            {EXPLORER_LABELS.blobBrowserTextTruncated}
          </MiniAppStatus>
        ) : null}
      </>
    );
  }

  return <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoPreview}</MiniAppStatus>;
}

function BlobPreviewSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { preview } = params;
  const canOpen = preview.status === "ready" && Boolean(preview.url);

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserPreviewHeading}>
      <MiniAppActions className="explorer-blob-browser-preview-actions">
        <MiniAppButton
          disabled={!canOpen}
          onClick={() => {
            if (preview.status === "ready" && preview.url) {
              window.open(preview.url, "_blank", "noopener,noreferrer");
            }
          }}
        >
          {EXPLORER_LABELS.blobBrowserOpenBlobAction}
        </MiniAppButton>
      </MiniAppActions>
      <div className="explorer-blob-preview-frame">
        <BlobPreviewContent blob={params.blob} preview={preview} />
      </div>
    </MiniAppInfoSection>
  );
}

export function BlobDetail(params: {
  blob: BlobInfo | null;
  blobStore: BlobStore;
  containerNamesById: ReadonlyMap<string, string>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const preview = useBlobPreview({
    blob: params.blob,
    blobStore: params.blobStore,
  });

  if (!params.blob) {
    return (
      <MiniAppPanel className="explorer-blob-browser-detail">
        <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoSelection}</MiniAppStatus>
      </MiniAppPanel>
    );
  }

  return (
    <MiniAppPanel className="explorer-blob-browser-detail">
      <BlobMetadataSection blob={params.blob} preview={preview} />
      <BlobPreviewSection blob={params.blob} preview={preview} />
      <BlobReferencesSection
        blob={params.blob}
        containerNamesById={params.containerNamesById}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        selectDocumentProjection={params.selectDocumentProjection}
      />
    </MiniAppPanel>
  );
}

export function BlobBrowserHeader(params: {
  onBack: () => void;
  selectedBlob: BlobInfo | null;
}) {
  const { onBack, selectedBlob } = params;

  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{EXPLORER_LABELS.blobBrowserTitle}</strong>
        <span>
          {selectedBlob
            ? compactId(selectedBlob.blobId ?? selectedBlob.storageKey)
            : EXPLORER_LABELS.blobBrowserNoSelection}
        </span>
      </MiniAppHeaderCopy>
      <MiniAppActions>
        <MiniAppButton onClick={onBack}>
          {selectedBlob
            ? EXPLORER_LABELS.blobBrowserBackToListAction
            : EXPLORER_LABELS.blobBrowserBackAction}
        </MiniAppButton>
      </MiniAppActions>
    </MiniAppHeader>
  );
}

export function BlobBrowserListScreen(params: {
  blobInfo: BlobInfoListState;
  frameRef: (frame: HTMLDivElement | null) => void;
  isWindowPending: boolean;
  onQueryChange: (value: string) => void;
  onSelectBlob: (blob: BlobInfo) => void;
  onSort: (key: BlobInfoSortKey) => void;
  query: string;
  rowOffset: number;
  rows: ReadonlyArray<BlobInfo>;
  sort: BlobInfoSort;
}) {
  return (
    <>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          onChange={(event) => params.onQueryChange(event.currentTarget.value)}
          placeholder={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          value={params.query}
        />
      </MiniAppToolbar>
      <div className="explorer-blob-browser-screen">
        <BlobInfoTable
          activeBlob={null}
          error={params.blobInfo.error}
          frameRef={params.frameRef}
          isLoading={params.blobInfo.isLoading || params.isWindowPending}
          onSelectBlob={params.onSelectBlob}
          onSort={params.onSort}
          rowOffset={params.rowOffset}
          rows={params.rows}
          sort={params.sort}
          totalCount={params.blobInfo.totalCount}
        />
      </div>
    </>
  );
}
