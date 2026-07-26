import {
  type BlobInfo,
  type BlobStore,
  type ContainerDocumentObjectSyncState,
  createContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppTableActionButton,
  MiniAppTableCell,
} from "../../../../components/mini-app/MiniAppTable";
import { classNames } from "../../../../components/shared/classNames";
import { getAttachmentFileType } from "../../../../document-types/shared/attachmentFileType";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import type {
  BlobInfoColumnId,
  BlobInfoCompactFieldColumnId,
} from "./blobListColumns";
import { getBlobInfoColumnLabel } from "./blobListColumns";
import {
  BLOB_LIST_LABELS,
  getBlobListReferenceCountLabel,
} from "./blobListLabels";
import { getBlobChangedAt } from "./blobListState";
import { useBlobThumbnailUrl } from "./blobPreview";

// A host that shows the sync column supplies the cell: the shared table computes
// the generic per-blob sync state and hands it back for host-specific rendering
// (e.g. the Explorer's sync badge). Omitting it drops the sync column entirely.
export type RenderBlobSyncCell = (
  syncState: ContainerDocumentObjectSyncState,
  online: boolean,
) => ReactNode;

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

function getBlobIdentity(blob: BlobInfo): string {
  return blob.blobId ?? blob.storageKey;
}

// Browsers don't reliably show a `title` on a disabled button, so the
// not-selectable hint rides on the never-disabled element wrapping it, which
// resolves the tooltip for the button inside.
function getBlobIdentityTitle(blob: BlobInfo, selectable: boolean): string {
  return selectable
    ? getBlobIdentity(blob)
    : BLOB_LIST_LABELS.pickUnavailableHint;
}

// The identity control hides the blob id and shows a thumbnail instead: an image
// blob renders its bytes inline, everything else falls back to a file-type icon.
// The id stays reachable via the button's accessible name and the tooltip. A
// folded row promotes it to the summary's spanning visual, hence the larger
// compact size.
function BlobIdentityButton(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  compact: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  selectable: boolean;
}) {
  const { blob, blobStore, compact, onSelectBlob, selectable } = params;
  const thumbnailUrl = useBlobThumbnailUrl({ blob, blobStore });
  const { Icon, isImage } = getAttachmentFileType({
    mimeType: blob.mimeType,
    name: blob.name,
  });

  return (
    <MiniAppTableActionButton
      aria-label={getBlobIdentity(blob)}
      className={classNames(
        "explorer-blob-browser-row-button",
        compact && "explorer-blob-browser-row-button--compact",
      )}
      disabled={!selectable}
      onClick={() => onSelectBlob(blob)}
    >
      <span
        className={classNames(
          "explorer-blob-browser-thumb",
          compact && "explorer-blob-browser-thumb--compact",
        )}
      >
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
            // A folded glyph fills its box the way an image thumbnail does, so
            // the square in BlobList.css stays the one place the compact size is
            // decided — and the two variants cover the summary's lines to the
            // same depth in both the touch and the denser windowed rem.
            size={compact ? "100%" : 20}
          />
        )}
      </span>
    </MiniAppTableActionButton>
  );
}

function BlobIdentityCell(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  onSelectBlob: (blob: BlobInfo) => void;
  selectable: boolean;
}) {
  return (
    <MiniAppTableCell
      title={getBlobIdentityTitle(params.blob, params.selectable)}
    >
      <BlobIdentityButton
        blob={params.blob}
        blobStore={params.blobStore}
        compact={false}
        onSelectBlob={params.onSelectBlob}
        selectable={params.selectable}
      />
    </MiniAppTableCell>
  );
}

function getBlobOrganizationLabel(
  blob: BlobInfo,
  organizationNamesById: ReadonlyMap<string, string>,
): string {
  const organizationId = blob.organizationId;
  if (!organizationId) {
    return "-";
  }

  return organizationNamesById.get(organizationId) ?? organizationId;
}

export function renderBlobInfoCell(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  columnId: BlobInfoColumnId;
  online: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  renderSyncCell: RenderBlobSyncCell | undefined;
  selectable: boolean;
}) {
  const {
    blob,
    blobStore,
    columnId,
    online,
    onSelectBlob,
    organizationNamesById,
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
    case "organization":
      return (
        <MiniAppTableCell
          key="organization"
          title={blob.organizationId ?? undefined}
        >
          {getBlobOrganizationLabel(blob, organizationNamesById)}
        </MiniAppTableCell>
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

// One folded line-field per visible data column, in the same order the wide
// table shows them: the first lands on the primary line, the rest share the
// muted second line.
function getBlobInfoCompactField(
  columnId: BlobInfoCompactFieldColumnId,
  params: {
    blob: BlobInfo;
    online: boolean;
    organizationNamesById: ReadonlyMap<string, string>;
    renderSyncCell: RenderBlobSyncCell | undefined;
  },
): MiniAppCompactTableField {
  const { blob, online, organizationNamesById, renderSyncCell } = params;
  const label = getBlobInfoColumnLabel(columnId);

  switch (columnId) {
    case "organization":
      return {
        id: columnId,
        label,
        text: getBlobOrganizationLabel(blob, organizationNamesById),
        title: blob.organizationId ?? undefined,
      };
    case "mime":
      return { id: columnId, label, text: blob.mimeType ?? "-" };
    case "size":
      return { id: columnId, label, text: formatByteLength(blob.byteLength) };
    case "references":
      return {
        id: columnId,
        label,
        text: getBlobListReferenceCountLabel(blob.referenceCount),
      };
    case "updated":
      return {
        id: columnId,
        label,
        text: formatMiniAppDateTime(getBlobChangedAt(blob), {
          emptyFallback: "-",
        }),
        title: getBlobChangedAt(blob) ?? undefined,
      };
    case "sync":
      // The badge carries its own accessible name, so it is `content` (which
      // never takes the visually-hidden label prefix) rather than text.
      return {
        content: renderSyncCell?.(getBlobInfoSyncState(blob), online),
        id: columnId,
      };
  }
}

// The folded row: the thumbnail spans both lines, the first visible data column
// leads, and the rest share the muted second line.
export function BlobSummaryCell(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
  columnIds: ReadonlyArray<BlobInfoCompactFieldColumnId>;
  online: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  renderSyncCell: RenderBlobSyncCell | undefined;
  selectable: boolean;
}) {
  const fields = params.columnIds.map((columnId) =>
    getBlobInfoCompactField(columnId, {
      blob: params.blob,
      online: params.online,
      organizationNamesById: params.organizationNamesById,
      renderSyncCell: params.renderSyncCell,
    }),
  );

  return (
    <MiniAppCompactTableCell
      primary={fields.slice(0, 1)}
      secondary={fields.slice(1)}
      visual={
        <span title={getBlobIdentityTitle(params.blob, params.selectable)}>
          <BlobIdentityButton
            blob={params.blob}
            blobStore={params.blobStore}
            compact
            onSelectBlob={params.onSelectBlob}
            selectable={params.selectable}
          />
        </span>
      }
    />
  );
}
