import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import type { ChangeEvent, DragEvent, ReactNode, RefObject } from "react";
import { classNames } from "../../components/shared/classNames";
import { formatByteLength } from "../../utils/formatByteLength";
import "./NoteDocument.css";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

type NoteAttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type NoteAttachmentStatusBySlotId = Readonly<
  Record<string, DocumentAttachmentStatus>
>;
type NoteHandleSelectedFiles = (fileList: FileList | null) => void;

function getAttachmentStatusLabel(
  status: DocumentAttachmentStatus | undefined,
): string | null {
  return status === "syncing" ? NOTE_DOCUMENT_LABELS.attachmentSyncing : null;
}

function NoteAttachmentItem({
  attachment,
  imageUrl,
  status,
}: {
  attachment: DocumentAttachment;
  imageUrl: string | undefined;
  status: DocumentAttachmentStatus | undefined;
}) {
  const statusLabel = getAttachmentStatusLabel(status);

  return (
    <li className="note-document-attachment">
      <div className="note-document-attachment-main">
        <div className="note-document-attachment-meta">
          <span className="note-document-attachment-name">
            {attachment.name}
          </span>
          <span className="note-document-attachment-size">
            {formatByteLength(attachment.byteLength)}
          </span>
        </div>
        {statusLabel ? (
          <div className="note-document-attachment-status">
            <span>{statusLabel}</span>
          </div>
        ) : null}
        {imageUrl ? (
          <img
            className="note-document-attachment-image"
            src={imageUrl}
            alt={attachment.name}
          />
        ) : null}
      </div>
    </li>
  );
}

// Shared note editor + attachments presentation used by both the notes
// mini-app and the explorer's note document renderer. It is intentionally
// unaware of how a note is stored: callers pass the editor text plus an
// attachment value map and the drag/drop + file-input handlers, mapping their
// own model into this shape. The hidden file input lives here so the dropzone
// label can trigger it; an optional `toolbar` slot lets a caller render an
// explicit attach control wired to the same `fileInputId`.
export function NoteEditorFields({
  attachments,
  attachmentStatusBySlotId,
  canAttach,
  dragActive,
  fileInputId,
  fileInputRef,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleSelectedFiles,
  imageUrlBySlotId,
  ready,
  setText,
  syncing,
  text,
  toolbar,
}: {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  handleDrop: (event: DragEvent<HTMLLabelElement>) => void;
  handleSelectedFiles: NoteHandleSelectedFiles;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
  toolbar?: ReactNode | undefined;
}) {
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <>
      {toolbar}
      <label
        htmlFor={fileInputId}
        className={classNames(
          "note-document-dropzone",
          dragActive && "note-document-dropzone--active",
          !canAttach && "note-document-dropzone--disabled",
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {attachments.length === 0 ? (
          <div className="note-document-dropzone-empty">
            {NOTE_DOCUMENT_LABELS.attachmentsEmpty}
          </div>
        ) : (
          <ul className="note-document-attachments">
            {attachments.map((attachment) => (
              <NoteAttachmentItem
                key={attachment.slotId}
                attachment={attachment}
                imageUrl={imageUrlBySlotId[attachment.slotId]}
                status={attachmentStatusBySlotId[attachment.slotId]}
              />
            ))}
          </ul>
        )}
      </label>
      <textarea
        className="note-document-editor"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          ready
            ? NOTE_DOCUMENT_LABELS.editorReadyPlaceholder
            : NOTE_DOCUMENT_LABELS.editorLoadingPlaceholder
        }
        disabled={!ready}
        aria-label={
          syncing
            ? NOTE_DOCUMENT_LABELS.editorSyncing
            : NOTE_DOCUMENT_LABELS.editor
        }
      />
      <input
        id={fileInputId}
        ref={fileInputRef}
        className="note-document-file-input"
        type="file"
        multiple
        disabled={!ready || !canAttach}
        onChange={handleInputChange}
      />
    </>
  );
}
