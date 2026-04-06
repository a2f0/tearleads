import { useEffect, useId, useRef, useState } from "react";
import { useAppData } from "../../data/AppDataProvider";
import { useNotes } from "./NotesProvider";
import "./Notes.css";

function formatByteLength(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }

  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }

  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
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
  const [dragActive, setDragActive] = useState(false);
  const [imageUrlBySlotId, setImageUrlBySlotId] = useState<
    Readonly<Record<string, string>>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const objectUrlsRef = useRef<
    Map<string, { storageKey: string; url: string }>
  >(new Map());

  useEffect(() => {
    return () => {
      for (const entry of objectUrlsRef.current.values()) {
        URL.revokeObjectURL(entry.url);
      }
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
        for (const entry of objectUrlsRef.current.values()) {
          URL.revokeObjectURL(entry.url);
        }
        objectUrlsRef.current.clear();
        setImageUrlBySlotId({});
        return;
      }

      const currentObjectUrls = objectUrlsRef.current;
      const nextObjectUrls = new Map<
        string,
        { storageKey: string; url: string }
      >();
      const nextImageUrlBySlotId: Record<string, string> = {};
      const createdObjectUrls: string[] = [];

      for (const attachment of imageAttachments) {
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

      if (cancelled) {
        for (const url of createdObjectUrls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      for (const [slotId, entry] of currentObjectUrls.entries()) {
        const nextEntry = nextObjectUrls.get(slotId);
        if (!nextEntry || nextEntry.url !== entry.url) {
          URL.revokeObjectURL(entry.url);
        }
      }

      objectUrlsRef.current = nextObjectUrls;
      setImageUrlBySlotId(nextImageUrlBySlotId);
    }

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentStorageKeyBySlotId, blobStore]);

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

  return (
    <div className="notes">
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
          onChange={(event) => {
            void handleSelectedFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <label
        htmlFor={fileInputId}
        className={`notes-dropzone${dragActive ? " notes-dropzone--active" : ""}${!canAttach ? " notes-dropzone--disabled" : ""}`}
        onDragEnter={(event) => {
          if (!canAttach) {
            return;
          }

          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!canAttach) {
            return;
          }

          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (!canAttach) {
            return;
          }

          void handleSelectedFiles(event.dataTransfer.files);
        }}
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
      <textarea
        className="notes-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={ready ? "Type your notes here..." : "Loading notes..."}
        disabled={!ready}
        aria-label={syncing ? "Notes editor syncing" : "Notes editor"}
      />
    </div>
  );
}
