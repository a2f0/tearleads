import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import type { DragEvent } from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import { AttachmentActionButton } from "../shared/AttachmentActionButton";
import { getAttachmentFileType } from "../shared/attachmentFileType";
import "./NoteDocument.css";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

export type NoteDropzoneElement = HTMLFieldSetElement | HTMLLabelElement;
export type NoteAttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
export type NoteAttachmentStatusBySlotId = Readonly<
  Record<string, DocumentAttachmentStatus>
>;

function isSyncingStatus(
  status: DocumentAttachmentStatus | undefined,
): boolean {
  return status === "syncing";
}

// A single attachment tile: a fixed image thumbnail (or a type icon for
// non-images), the file name, and a "KIND · SIZE" line. The whole tile is a
// button that opens the enlarged preview; the download and remove actions live
// in a hover/focus overlay so the resting state stays clean and scannable.
function NoteAttachmentTile({
  attachment,
  canRemove,
  imageUrl,
  onDownloadAttachment,
  onOpenAttachment,
  onRemoveAttachment,
  status,
}: {
  attachment: DocumentAttachment;
  canRemove: boolean;
  imageUrl: string | undefined;
  onDownloadAttachment: (slotId: string) => void;
  onOpenAttachment: (slotId: string) => void;
  onRemoveAttachment: (slotId: string) => void;
  status: DocumentAttachmentStatus | undefined;
}) {
  const fileType = getAttachmentFileType({
    mimeType: attachment.mimeType,
    name: attachment.name,
  });
  const { Icon } = fileType;
  const syncing = isSyncingStatus(status);
  const removeLabel = NOTE_DOCUMENT_LABELS.removeAttachment(attachment.name);
  const downloadLabel = NOTE_DOCUMENT_LABELS.downloadAttachment(
    attachment.name,
  );

  return (
    <li className="note-document-attachment">
      <button
        type="button"
        className="note-document-attachment-open"
        onClick={() => onOpenAttachment(attachment.slotId)}
        title={NOTE_DOCUMENT_LABELS.openAttachment(attachment.name)}
        aria-label={NOTE_DOCUMENT_LABELS.openAttachment(attachment.name)}
      >
        <span className="note-document-attachment-thumb">
          {fileType.isImage && imageUrl ? (
            <img
              className="note-document-attachment-thumb-image"
              src={imageUrl}
              alt=""
            />
          ) : (
            <Icon
              className="note-document-attachment-thumb-icon"
              aria-hidden
              size={28}
            />
          )}
          {syncing ? (
            <span className="note-document-attachment-badge">
              {NOTE_DOCUMENT_LABELS.attachmentSyncing}
            </span>
          ) : null}
        </span>
        <span className="note-document-attachment-info">
          <span
            className="note-document-attachment-name"
            title={attachment.name}
          >
            {attachment.name}
          </span>
          <span className="note-document-attachment-detail">
            {fileType.kind} · {formatByteLength(attachment.byteLength)}
          </span>
        </span>
      </button>
      <div className="note-document-attachment-tools">
        <button
          type="button"
          className="note-document-attachment-tool"
          aria-label={downloadLabel}
          title={downloadLabel}
          onClick={() => onDownloadAttachment(attachment.slotId)}
        >
          <DownloadSimpleIcon aria-hidden size={14} />
        </button>
        {canRemove ? (
          <button
            type="button"
            className="note-document-attachment-tool note-document-attachment-tool--remove"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveAttachment(attachment.slotId);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <TrashIcon aria-hidden size={14} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

// The attachments panel below the editor: a labelled dropzone whose header
// carries the count and the attach controls, with the attachments laid out as a
// tile grid. When empty it collapses to a single hint line that doubles as the
// drop target. Kept as a <fieldset> so the whole region is a drag/drop surface
// and an accessible group. The header's Upload button opens the shared file
// input; a "Select Blob" button appears alongside it — sharing the structured
// document button chrome — only when the host offers a blob to pick.
export function NoteAttachmentsPanel({
  attachments,
  attachmentStatusBySlotId,
  canAttach,
  dropzoneClassName,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleDownloadAttachment,
  handleRemoveAttachment,
  imageUrlBySlotId,
  interactive,
  onOpenAttachment,
  onSelectBlob,
  onUploadAttachment,
}: {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  canAttach: boolean;
  dropzoneClassName: string | undefined;
  handleDragEnter: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragLeave: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragOver: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDrop: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDownloadAttachment: (slotId: string) => void;
  handleRemoveAttachment: (slotId: string) => void;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  interactive: boolean;
  onOpenAttachment: (slotId: string) => void;
  onSelectBlob: (() => void) | undefined;
  onUploadAttachment: () => void;
}) {
  const hasAttachments = attachments.length > 0;

  return (
    <fieldset
      className={dropzoneClassName}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="note-document-attachments-header">
        <span className="note-document-attachments-title">
          {hasAttachments
            ? NOTE_DOCUMENT_LABELS.attachmentsCount(attachments.length)
            : NOTE_DOCUMENT_LABELS.attachments}
        </span>
        {interactive ? (
          <div className="note-document-attachments-actions">
            <AttachmentActionButton
              label={NOTE_DOCUMENT_LABELS.uploadAttachment}
              onClick={onUploadAttachment}
            >
              <FileArrowUpIcon aria-hidden size={14} />
            </AttachmentActionButton>
            {onSelectBlob ? (
              <AttachmentActionButton
                label={NOTE_DOCUMENT_LABELS.selectBlob}
                onClick={onSelectBlob}
              >
                <StackIcon aria-hidden size={14} />
              </AttachmentActionButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasAttachments ? (
        <ul
          aria-label={NOTE_DOCUMENT_LABELS.attachments}
          className="note-document-attachments"
        >
          {attachments.map((attachment) => (
            <NoteAttachmentTile
              key={attachment.slotId}
              attachment={attachment}
              canRemove={canAttach && interactive}
              imageUrl={imageUrlBySlotId[attachment.slotId]}
              onDownloadAttachment={handleDownloadAttachment}
              onOpenAttachment={onOpenAttachment}
              onRemoveAttachment={handleRemoveAttachment}
              status={attachmentStatusBySlotId[attachment.slotId]}
            />
          ))}
        </ul>
      ) : (
        <div className="note-document-attachments-empty">
          <span className="note-document-attachments-empty-title">
            {NOTE_DOCUMENT_LABELS.attachmentsEmpty}
          </span>
          {interactive ? (
            <span className="note-document-attachments-empty-hint">
              {NOTE_DOCUMENT_LABELS.attachmentsEmptyHint}
            </span>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}
