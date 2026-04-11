import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobBytes } from "../../data/blob-store";
import { useAttachmentImageUrls } from "../../data/documents/useAttachmentImageUrls";
import { type NoteAttachmentStatus, useNotes } from "./NotesProvider";
import type { NoteAttachment } from "./noteDocument";
import "./Notes.css";

type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type AttachmentStatusBySlotId = Readonly<Record<string, NoteAttachmentStatus>>;
type HandleSelectedFiles = (fileList: FileList | null) => Promise<void>;

function formatByteLength(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }

  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }

  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

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
  onReplaceAttachment: (slotId: string, fileList: FileList | null) => void;
}

interface NotesAttachmentItemProps {
  attachment: NoteAttachment;
  canAttach: boolean;
  imageUrl: string | undefined;
  onReplaceAttachment: (slotId: string, fileList: FileList | null) => void;
  status: NoteAttachmentStatus | undefined;
}

function getAttachmentStatusLabel(
  status: NoteAttachmentStatus | undefined,
): string | null {
  if (status === "needs_replacement") {
    return "Replace this file to finish the access change.";
  }

  if (status === "syncing") {
    return "Syncing replacement.";
  }

  return null;
}

function NotesAttachmentItem({
  attachment,
  canAttach,
  imageUrl,
  onReplaceAttachment,
  status,
}: NotesAttachmentItemProps) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const replacementInputId = useId();
  const statusLabel = getAttachmentStatusLabel(status);
  const needsReplacement = status === "needs_replacement";

  function handleReplacementChange(event: ChangeEvent<HTMLInputElement>) {
    onReplaceAttachment(attachment.slotId, event.currentTarget.files);
    event.currentTarget.value = "";
  }

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
            {needsReplacement ? (
              <>
                <button
                  type="button"
                  className="notes-attachment-replace-button"
                  disabled={!canAttach}
                  onClick={(event) => {
                    event.preventDefault();
                    replacementInputRef.current?.click();
                  }}
                >
                  Replace File
                </button>
                <input
                  id={replacementInputId}
                  ref={replacementInputRef}
                  className="notes-file-input"
                  type="file"
                  disabled={!canAttach}
                  onChange={handleReplacementChange}
                />
              </>
            ) : null}
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
  onReplaceAttachment,
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
              canAttach={canAttach}
              imageUrl={imageUrlBySlotId[attachment.slotId]}
              onReplaceAttachment={onReplaceAttachment}
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
type ReplaceAttachment = (
  slotId: string,
  file: SelectedAttachmentUpload,
) => void;

async function readAttachmentUpload(
  file: File,
): Promise<SelectedAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

function createNotesFileHandlers(input: {
  attachFiles: AttachFiles;
  replaceAttachment: ReplaceAttachment;
}) {
  async function loadFiles(files: ReadonlyArray<File>) {
    input.attachFiles(await Promise.all(files.map(readAttachmentUpload)));
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await loadFiles(Array.from(fileList));
  }

  async function handleSelectedReplacementFile(
    slotId: string,
    fileList: FileList | null,
  ) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const [file] = Array.from(fileList);
    if (!file) {
      return;
    }

    input.replaceAttachment(slotId, await readAttachmentUpload(file));
  }

  return {
    handleSelectedFiles,
    handleSelectedReplacementFile,
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
    replaceAttachment,
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
  const { handleSelectedFiles, handleSelectedReplacementFile } =
    createNotesFileHandlers({
      attachFiles,
      replaceAttachment,
    });

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
        onReplaceAttachment={(slotId, fileList) => {
          void handleSelectedReplacementFile(slotId, fileList);
        }}
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
