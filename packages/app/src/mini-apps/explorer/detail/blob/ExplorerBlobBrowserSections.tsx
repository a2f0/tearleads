import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { Menu, MenuItem, type MenuPosition } from "@tearleads/windowing";
import {
  MiniAppImageViewer,
  MiniAppInfoSection,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../../components/mini-app/MiniAppTable";
import {
  getMediaPreviewKind,
  MediaPreview,
} from "../../../../document-types/shared/MediaPreview";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  getBlobChangedAt,
  getBlobDisplayName,
} from "../../../shared/blob-pick/blob-list/blobListState";
import {
  type BlobPreviewState,
  useBlobPreview,
} from "../../../shared/blob-pick/blob-list/blobPreview";
import {
  EXPLORER_LABELS,
  getExplorerBlobBrowserDocumentCountLabel,
  getExplorerBlobBrowserReferenceCountLabel,
} from "../../labels";
import { compactId } from "../compactId";
import { BlobReferencesSection } from "./ExplorerBlobReferencesSection";
import { useBlobDetailToolbarActions } from "./useBlobDetailToolbarActions";

function BlobMetadataSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserMetadataHeading}>
      {/* Pinned: a long filename wraps in the value column rather than
          squeezing the labels onto two lines. */}
      <MiniAppInfoTable className="mini-app-info-table--borderless mini-app-info-table--pinned">
        <tbody>
          <MiniAppInfoRow label={EXPLORER_LABELS.blobBrowserFilenameColumn}>
            {getBlobDisplayName(blob)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.blobBrowserIdRow}
            title={blob.blobId ?? undefined}
          >
            {compactId(blob.blobId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.blobBrowserStorageKeyRow}
            title={blob.storageKey}
          >
            {compactId(blob.storageKey)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.blobBrowserMimeTypeRow}>
            {blob.mimeType ?? "-"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.blobBrowserByteLengthRow}>
            {formatByteLength(
              preview.status === "ready" ? preview.byteLength : blob.byteLength,
            )}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.blobBrowserReferenceColumn}>
            {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
            {", "}
            {getExplorerBlobBrowserDocumentCountLabel(blob.documentCount)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.blobBrowserUpdatedRow}
            title={getBlobChangedAt(blob) ?? undefined}
          >
            {formatMiniAppDateTime(getBlobChangedAt(blob), {
              emptyFallback: "-",
            })}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function BlobMediaPreview(params: {
  blob: BlobInfo;
  kind: NonNullable<ReturnType<typeof getMediaPreviewKind>>;
  onOpenImage: (() => void) | null;
  url: string;
}) {
  const { blob, kind, onOpenImage, url } = params;
  const media = (
    <MediaPreview
      className="explorer-blob-preview-media"
      kind={kind}
      label={blob.name ?? blob.blobId ?? blob.storageKey}
      url={url}
    />
  );

  // Tapping the picture is what anyone reaches for first to see it larger —
  // the toolbar's expand control is the discoverable route, not the only one.
  // The button carries its own name so the image's alt text (the blob's name,
  // which the toolbar action does not repeat) stays out of the accessible
  // name and the two controls remain distinguishable.
  return kind === "image" && onOpenImage ? (
    <button
      aria-label={EXPLORER_LABELS.blobBrowserOpenPreviewAction}
      className="explorer-blob-preview-open"
      onClick={onOpenImage}
      title={EXPLORER_LABELS.blobBrowserOpenPreviewAction}
      type="button"
    >
      {media}
    </button>
  ) : (
    media
  );
}

function BlobPreviewContent(params: {
  blob: BlobInfo;
  onOpenImage: (() => void) | null;
  preview: BlobPreviewState;
}) {
  const { blob, onOpenImage, preview } = params;

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

  const mediaKind = getMediaPreviewKind(blob.mimeType);
  if (preview.url && mediaKind) {
    return (
      <BlobMediaPreview
        blob={blob}
        kind={mediaKind}
        onOpenImage={onOpenImage}
        url={preview.url}
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
  onOpenImage: (() => void) | null;
  preview: BlobPreviewState;
}) {
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserPreviewHeading}>
      <div className="explorer-blob-preview-frame">
        <BlobPreviewContent
          blob={params.blob}
          onOpenImage={params.onOpenImage}
          preview={params.preview}
        />
      </div>
    </MiniAppInfoSection>
  );
}

export function BlobDetail(params: {
  blob: BlobInfo | null;
  blobStore: BlobStore;
  containerNamesById: ReadonlyMap<string, string>;
  downloadMessage: string | null;
  onDownload: (blob: BlobInfo) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const preview = useBlobPreview({
    blob: params.blob,
    blobStore: params.blobStore,
  });
  // Open and Download live on the window toolbar / routed app bar rather than in
  // a bar of their own inside the panel, so the detail screen is all content.
  const toolbar = useBlobDetailToolbarActions({
    blob: params.blob,
    onDownload: params.onDownload,
    preview,
  });

  if (!params.blob) {
    return (
      <MiniAppPanel className="explorer-blob-browser-detail">
        <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoSelection}</MiniAppStatus>
      </MiniAppPanel>
    );
  }

  const blob = params.blob;

  return (
    <>
      {params.downloadMessage ? (
        <MiniAppStatus tone="error">{params.downloadMessage}</MiniAppStatus>
      ) : null}
      <MiniAppPanel className="explorer-blob-browser-detail">
        <BlobPreviewSection
          blob={blob}
          onOpenImage={toolbar.openImage}
          preview={preview}
        />
        <BlobMetadataSection blob={blob} preview={preview} />
        <BlobReferencesSection
          blob={blob}
          containerNamesById={params.containerNamesById}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      </MiniAppPanel>
      {toolbar.viewerUrl ? (
        <MiniAppImageViewer
          label={getBlobDisplayName(blob)}
          onClose={toolbar.closeViewer}
          onDownload={toolbar.handleDownload}
          url={toolbar.viewerUrl}
        />
      ) : null}
    </>
  );
}

export function BlobBrowserRowContextMenu(params: {
  blob: BlobInfo;
  onClose: () => void;
  onDownload: (blob: BlobInfo) => void;
  position: MenuPosition;
}) {
  const { blob, onClose, onDownload, position } = params;

  return (
    <Menu direction="down" onClose={onClose} position={position}>
      <MenuItem
        icon={DownloadSimpleIcon}
        label={EXPLORER_LABELS.blobBrowserDownloadAction}
        onClick={() => {
          onClose();
          onDownload(blob);
        }}
      />
    </Menu>
  );
}
