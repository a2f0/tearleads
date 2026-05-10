import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import type { BlobBytes } from "../../data/blobs";
import { useAttachmentImageUrls } from "../../document-types/shared/useAttachmentImageUrls";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  type NoteAttachmentStatus,
  useNotes,
} from "../../stores/notes/NotesProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import type { NoteAttachment } from "./noteDocument";
import "./Notes.css";

type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type AttachmentStatusBySlotId = Readonly<Record<string, NoteAttachmentStatus>>;
type HandleSelectedFiles = (fileList: FileList | null) => Promise<void>;

function useAttachmentDropzone(
  canAttach: boolean,
  handleSelectedFiles: HandleSelectedFiles,
) {
  const [dragActive, setDragActive] = useState(false);

  function activateDropzone(event: DragEvent<HTMLLabelElement>) {
    if (!canAttach) {
      return;
    }

    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!canAttach) {
      return;
    }

    void handleSelectedFiles(event.dataTransfer.files);
  }

  return {
    dragActive,
    handleDragEnter: activateDropzone,
    handleDragLeave,
    handleDragOver: activateDropzone,
    handleDrop,
  };
}

interface NotesToolbarProps {
  canAttach: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleSelectedFiles: HandleSelectedFiles;
  isAuthenticated: boolean;
  online: boolean;
  ready: boolean;
}

function NotesToolbar({
  canAttach,
  fileInputId,
  fileInputRef,
  handleSelectedFiles,
  isAuthenticated,
  online,
  ready,
}: NotesToolbarProps) {
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <div className="notes-toolbar">
      <button
        type="button"
        className="notes-attach-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!ready || !canAttach}
      >
        Attach File
      </button>
      <span className="notes-toolbar-status">
        {canAttach
          ? isAuthenticated && online
            ? "Drop files into the note to attach them."
            : "Attachments save locally and sync when you're online."
          : "Attachments require a local key package."}
      </span>
      <input
        id={fileInputId}
        ref={fileInputRef}
        className="notes-file-input"
        type="file"
        multiple
        disabled={!ready || !canAttach}
        onChange={handleInputChange}
      />
    </div>
  );
}

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
    return "Syncing attachment.";
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

function NotesAttachmentsPanel({
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
        <div className="notes-dropzone-empty">No attachments yet.</div>
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

interface SelectedAttachmentUpload {
  bytes: BlobBytes;
  mimeType: string | null;
  name: string;
}

type AttachFiles = (files: ReadonlyArray<SelectedAttachmentUpload>) => void;

async function readAttachmentUpload(
  file: File,
): Promise<SelectedAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

function createNotesFileHandlers(input: { attachFiles: AttachFiles }) {
  async function loadFiles(files: ReadonlyArray<File>) {
    input.attachFiles(await Promise.all(files.map(readAttachmentUpload)));
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await loadFiles(Array.from(fileList));
  }

  return {
    handleSelectedFiles,
  };
}

export function Notes() {
  const { blobStore, isAuthenticated, online } = useAppData();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    attachFiles,
    canAttach,
    ready,
    setText,
    syncing,
    text,
  } = useNotes();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const { handleSelectedFiles } = createNotesFileHandlers({ attachFiles });

  const {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useAttachmentDropzone(canAttach, handleSelectedFiles);

  return (
    <div className="notes">
      <NotesToolbar
        canAttach={canAttach}
        fileInputId={fileInputId}
        fileInputRef={fileInputRef}
        handleSelectedFiles={handleSelectedFiles}
        isAuthenticated={isAuthenticated}
        online={online}
        ready={ready}
      />
      <NotesAttachmentsPanel
        attachments={attachments}
        attachmentStatusBySlotId={attachmentStatusBySlotId}
        canAttach={canAttach}
        dragActive={dragActive}
        fileInputId={fileInputId}
        handleDragEnter={handleDragEnter}
        handleDragLeave={handleDragLeave}
        handleDragOver={handleDragOver}
        handleDrop={handleDrop}
        imageUrlBySlotId={imageUrlBySlotId}
      />
      <textarea
        className="notes-editor"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={ready ? "Type your notes here..." : "Loading notes..."}
        disabled={!ready}
        aria-label={syncing ? "Notes editor syncing" : "Notes editor"}
      />
    </div>
  );
}
