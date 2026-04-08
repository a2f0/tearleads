import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobStore } from "../../data/blob-store";
import { useNotes } from "./NotesProvider";
import type { NoteAttachment } from "./noteDocument";
import "./Notes.css";

type AttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type AttachmentObjectUrlEntry = {
  storageKey: string;
  url: string;
};
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

function revokeAttachmentObjectUrls(
  objectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
) {
  for (const entry of objectUrls.values()) {
    URL.revokeObjectURL(entry.url);
  }
}

async function buildAttachmentImageState(
  attachments: ReadonlyArray<NoteAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
  blobStore: BlobStore,
  currentObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
): Promise<{
  createdObjectUrls: string[];
  nextImageUrlBySlotId: Record<string, string>;
  nextObjectUrls: Map<string, AttachmentObjectUrlEntry>;
}> {
  const nextObjectUrls = new Map<string, AttachmentObjectUrlEntry>();
  const nextImageUrlBySlotId: Record<string, string> = {};
  const createdObjectUrls: string[] = [];

  for (const attachment of attachments) {
    const storageKey = attachmentStorageKeyBySlotId[attachment.slotId];
    if (!storageKey) {
      continue;
    }

    const existingEntry = currentObjectUrls.get(attachment.slotId);
    if (existingEntry && existingEntry.storageKey === storageKey) {
      nextObjectUrls.set(attachment.slotId, existingEntry);
      nextImageUrlBySlotId[attachment.slotId] = existingEntry.url;
      continue;
    }

    const blobBytes = await blobStore.readBytes(storageKey);
    if (!blobBytes) {
      continue;
    }

    const url = URL.createObjectURL(
      new Blob([blobBytes], {
        type: attachment.mimeType ?? "application/octet-stream",
      }),
    );
    createdObjectUrls.push(url);
    nextObjectUrls.set(attachment.slotId, { storageKey, url });
    nextImageUrlBySlotId[attachment.slotId] = url;
  }

  return {
    createdObjectUrls,
    nextImageUrlBySlotId,
    nextObjectUrls,
  };
}

function applyAttachmentImageState(
  currentObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
  nextObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
  setImageUrlBySlotId: (value: AttachmentImageUrlBySlotId) => void,
  nextImageUrlBySlotId: AttachmentImageUrlBySlotId,
  objectUrlsRef: RefObject<Map<string, AttachmentObjectUrlEntry>>,
) {
  for (const [slotId, entry] of currentObjectUrls.entries()) {
    const nextEntry = nextObjectUrls.get(slotId);
    if (!nextEntry || nextEntry.url !== entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }

  objectUrlsRef.current = new Map(nextObjectUrls);
  setImageUrlBySlotId(nextImageUrlBySlotId);
}

function useAttachmentImageUrls(
  attachments: ReadonlyArray<NoteAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
  blobStore: BlobStore,
): AttachmentImageUrlBySlotId {
  const [imageUrlBySlotId, setImageUrlBySlotId] =
    useState<AttachmentImageUrlBySlotId>({});
  const objectUrlsRef = useRef<Map<string, AttachmentObjectUrlEntry>>(
    new Map(),
  );

  useEffect(() => {
    return () => {
      revokeAttachmentObjectUrls(objectUrlsRef.current);
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadImages() {
      const imageAttachments = attachments.filter(
        (attachment) =>
          attachment.mimeType?.startsWith("image/") &&
          attachmentStorageKeyBySlotId[attachment.slotId],
      );

      if (imageAttachments.length === 0) {
        revokeAttachmentObjectUrls(objectUrlsRef.current);
        objectUrlsRef.current.clear();
        setImageUrlBySlotId({});
        return;
      }

      const currentObjectUrls = objectUrlsRef.current;
      const { createdObjectUrls, nextImageUrlBySlotId, nextObjectUrls } =
        await buildAttachmentImageState(
          imageAttachments,
          attachmentStorageKeyBySlotId,
          blobStore,
          currentObjectUrls,
        );

      if (cancelled) {
        for (const url of createdObjectUrls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      applyAttachmentImageState(
        currentObjectUrls,
        nextObjectUrls,
        setImageUrlBySlotId,
        nextImageUrlBySlotId,
        objectUrlsRef,
      );
    }

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentStorageKeyBySlotId, blobStore]);

  return imageUrlBySlotId;
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
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  handleDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  handleDrop: (event: DragEvent<HTMLLabelElement>) => void;
  imageUrlBySlotId: AttachmentImageUrlBySlotId;
}

function NotesAttachmentsPanel({
  attachments,
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
            <li key={attachment.slotId} className="notes-attachment">
              <div className="notes-attachment-main">
                <div className="notes-attachment-meta">
                  <span className="notes-attachment-name">
                    {attachment.name}
                  </span>
                  <span className="notes-attachment-size">
                    {formatByteLength(attachment.byteLength)}
                  </span>
                </div>
                {imageUrlBySlotId[attachment.slotId] ? (
                  <img
                    className="notes-attachment-image"
                    src={imageUrlBySlotId[attachment.slotId]}
                    alt={attachment.name}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

export function Notes() {
  const { blobStore, isAuthenticated, online } = useAppData();
  const {
    attachments,
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

  async function loadFiles(files: ReadonlyArray<File>) {
    const uploads = await Promise.all(
      files.map(async (file) => ({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type.length > 0 ? file.type : null,
        name: file.name,
      })),
    );

    attachFiles(uploads);
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await loadFiles(Array.from(fileList));
  }

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
