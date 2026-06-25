import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { classNames } from "../../components/shared/classNames";
import { formatByteLength } from "../../utils/formatByteLength";
import "./NoteDocument.css";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

type NoteDropzoneElement = HTMLFieldSetElement | HTMLLabelElement;
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
  canRemove,
  imageUrl,
  onRemoveAttachment,
  status,
}: {
  attachment: DocumentAttachment;
  canRemove: boolean;
  imageUrl: string | undefined;
  onRemoveAttachment: (slotId: string) => void;
  status: DocumentAttachmentStatus | undefined;
}) {
  const statusLabel = getAttachmentStatusLabel(status);
  const removeLabel = NOTE_DOCUMENT_LABELS.removeAttachment(attachment.name);

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
          <button
            type="button"
            className="note-document-attachment-remove"
            aria-label={removeLabel}
            title={removeLabel}
            disabled={!canRemove}
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

function useAutosizeTextarea(text: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor) {
      return;
    }

    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
  }, [text]);

  return ref;
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
  handleRemoveAttachment,
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
  handleDragEnter: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragLeave: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragOver: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDrop: (event: DragEvent<NoteDropzoneElement>) => void;
  handleRemoveAttachment: (slotId: string) => void;
  handleSelectedFiles: NoteHandleSelectedFiles;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
  toolbar?: ReactNode | undefined;
}) {
  const editorRef = useAutosizeTextarea(text);
  const dropzoneClassName = classNames(
    "note-document-dropzone",
    dragActive && "note-document-dropzone--active",
    !canAttach && "note-document-dropzone--disabled",
  );

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <>
      {toolbar}
      <div className="note-document-scroll">
        {attachments.length === 0 ? (
          <label
            htmlFor={fileInputId}
            className={dropzoneClassName}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="note-document-dropzone-empty">
              {NOTE_DOCUMENT_LABELS.attachmentsEmpty}
            </div>
          </label>
        ) : (
          <fieldset
            aria-label={NOTE_DOCUMENT_LABELS.attachments}
            className={dropzoneClassName}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <ul className="note-document-attachments">
              {attachments.map((attachment) => (
                <NoteAttachmentItem
                  key={attachment.slotId}
                  attachment={attachment}
                  canRemove={canAttach}
                  imageUrl={imageUrlBySlotId[attachment.slotId]}
                  onRemoveAttachment={handleRemoveAttachment}
                  status={attachmentStatusBySlotId[attachment.slotId]}
                />
              ))}
            </ul>
          </fieldset>
        )}
        <textarea
          ref={editorRef}
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
      </div>
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
