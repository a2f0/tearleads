import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppImageViewer,
  MiniAppInfoSection,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import { Menu, type MenuPosition } from "../../../../components/shared/Menu";
import { MenuItem } from "../../../../components/shared/MenuItem";
import {
  getMediaPreviewKind,
  MediaPreview,
} from "../../../../document-types/shared/MediaPreview";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { getBlobChangedAt } from "../../../shared/blob-pick/blob-list/blobListState";
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
import {
  getBlobDisplayName,
  useBlobDetailToolbarActions,
} from "./useBlobDetailToolbarActions";

function BlobMetadataSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserMetadataHeading}>
      <MiniAppInfoTable className="mini-app-info-table--borderless">
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
    const media = (
      <MediaPreview
        className="explorer-blob-preview-media"
        kind={mediaKind}
        label={blob.name ?? blob.blobId ?? blob.storageKey}
        url={preview.url}
      />
    );

    // Tapping the picture is what anyone reaches for first to see it larger —
    // the toolbar's expand control is the discoverable route, not the only one.
    // The button carries its own name so the image's alt text (the blob's name,
    // which the toolbar action does not repeat) stays out of the accessible
    // name and the two controls remain distinguishable.
    return mediaKind === "image" && onOpenImage ? (
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

export function BlobBrowserHeader(params: { selectedBlob: BlobInfo | null }) {
  const { selectedBlob } = params;
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
    </MiniAppHeader>
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
