import type { DragEvent } from "react";
import { formatByteLength } from "../../../utils/formatByteLength";
import { NOTES_LABELS } from "../labels";
import type { NoteAttachment } from "../noteDocument";
import type {
  AttachmentImageUrlBySlotId,
  AttachmentStatusBySlotId,
  NoteAttachmentStatus,
} from "../types";

interface NotesAttachmentsPanelProps {
  attachments: ReadonlyArray<NoteAttachment>;
  attachmentStatusBySlotId: AttachmentStatusBySlotId;
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  handleDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  handleDrop: (event: DragEvent<HTMLLabelElement>) => void;
  imageUrlBySlotId: AttachmentImageUrlBySlotId;
}

interface NotesAttachmentItemProps {
  attachment: NoteAttachment;
  imageUrl: string | undefined;
  status: NoteAttachmentStatus | undefined;
}

function getAttachmentStatusLabel(
  status: NoteAttachmentStatus | undefined,
): string | null {
  if (status === "syncing") {
    return NOTES_LABELS.attachmentSyncing;
  }

  return null;
}

function NotesAttachmentItem({
  attachment,
  imageUrl,
  status,
}: NotesAttachmentItemProps) {
  const statusLabel = getAttachmentStatusLabel(status);

  return (
    <li className="notes-attachment">
      <div className="notes-attachment-main">
        <div className="notes-attachment-meta">
          <span className="notes-attachment-name">{attachment.name}</span>
          <span className="notes-attachment-size">
            {formatByteLength(attachment.byteLength)}
          </span>
        </div>
        {statusLabel ? (
          <div className="notes-attachment-status">
            <span>{statusLabel}</span>
          </div>
        ) : null}
        {imageUrl ? (
          <img
            className="notes-attachment-image"
            src={imageUrl}
            alt={attachment.name}
          />
        ) : null}
      </div>
    </li>
  );
}

export function NotesAttachmentsPanel({
  attachments,
  attachmentStatusBySlotId,
  canAttach,
  dragActive,
  fileInputId,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  imageUrlBySlotId,
}: NotesAttachmentsPanelProps) {
  return (
    <label
      htmlFor={fileInputId}
      className={`notes-dropzone${dragActive ? " notes-dropzone--active" : ""}${!canAttach ? " notes-dropzone--disabled" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {attachments.length === 0 ? (
        <div className="notes-dropzone-empty">
          {NOTES_LABELS.attachmentsEmpty}
        </div>
      ) : (
        <ul className="notes-attachments">
          {attachments.map((attachment) => (
            <NotesAttachmentItem
              key={attachment.slotId}
              attachment={attachment}
              imageUrl={imageUrlBySlotId[attachment.slotId]}
              status={attachmentStatusBySlotId[attachment.slotId]}
            />
          ))}
        </ul>
      )}
    </label>
  );
}
