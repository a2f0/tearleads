import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { Menu, type MenuPosition } from "../../../../components/shared/Menu";
import { MenuItem } from "../../../../components/shared/MenuItem";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInfoSection,
  MiniAppPanel,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/shared/MiniAppTable";
import {
  getMediaPreviewKind,
  MediaPreview,
} from "../../../../document-types/shared/MediaPreview";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  type BlobPreviewState,
  getBlobChangedAt,
  useBlobPreview,
} from "../../../shared/blob-pick/blob-list/blobListState";
import {
  EXPLORER_LABELS,
  getExplorerBlobBrowserDocumentCountLabel,
  getExplorerBlobBrowserReferenceCountLabel,
} from "../../labels";
import { compactId } from "../compactId";
import { BlobReferencesSection } from "./ExplorerBlobReferencesSection";

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

  const mediaKind = getMediaPreviewKind(blob.mimeType);
  if (preview.url && mediaKind) {
    return (
      <MediaPreview
        className="explorer-blob-preview-media"
        kind={mediaKind}
        label={blob.name ?? blob.blobId ?? blob.storageKey}
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
  preview: BlobPreviewState;
}) {
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserPreviewHeading}>
      <div className="explorer-blob-preview-frame">
        <BlobPreviewContent blob={params.blob} preview={params.preview} />
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

  if (!params.blob) {
    return (
      <MiniAppPanel className="explorer-blob-browser-detail">
        <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoSelection}</MiniAppStatus>
      </MiniAppPanel>
    );
  }

  const blob = params.blob;
  const canOpen = preview.status === "ready" && Boolean(preview.url);

  return (
    <>
      <MiniAppToolbar>
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
        <MiniAppButton onClick={() => params.onDownload(blob)}>
          {EXPLORER_LABELS.blobBrowserDownloadAction}
        </MiniAppButton>
      </MiniAppToolbar>
      {params.downloadMessage ? (
        <MiniAppStatus tone="error">{params.downloadMessage}</MiniAppStatus>
      ) : null}
      <MiniAppPanel className="explorer-blob-browser-detail">
        <BlobPreviewSection blob={blob} preview={preview} />
        <BlobMetadataSection blob={blob} preview={preview} />
        <BlobReferencesSection
          blob={blob}
          containerNamesById={params.containerNamesById}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      </MiniAppPanel>
    </>
  );
}

export function BlobBrowserHeader(params: {
  embedded?: boolean;
  onBack: () => void;
  selectedBlob: BlobInfo | null;
}) {
  const { embedded = false, onBack, selectedBlob } = params;
  // In the compact tabbed hub the tab bar handles leaving the browser, so the
  // list-mode "Back to Explorer" button is dropped; blob-detail keeps its
  // in-panel "Back to List".
  const showBack = selectedBlob !== null || !embedded;

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
      {showBack ? (
        <MiniAppActions>
          <MiniAppButton onClick={onBack}>
            {selectedBlob
              ? EXPLORER_LABELS.blobBrowserBackToListAction
              : EXPLORER_LABELS.blobBrowserBackAction}
          </MiniAppButton>
        </MiniAppActions>
      ) : null}
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
