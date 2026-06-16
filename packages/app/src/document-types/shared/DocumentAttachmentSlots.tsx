import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import {
  type ChangeEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  type DocumentAttachmentSlot,
  getDocumentAttachmentBlobName,
  getDocumentAttachmentStatusLabel,
  getLatestDocumentAttachmentBySlotId,
  isImageDocumentAttachmentBlob,
} from "./documentAttachmentUtils";

const BLOB_PICKER_LIMIT = 100;

interface DocumentAttachmentBlobPickerConfig {
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  onSelectedBlob: (slotId: string, blob: BlobInfo) => Promise<void> | void;
}

interface BlobPickerListState {
  error: string | null;
  isLoading: boolean;
  rows: ReadonlyArray<BlobInfo>;
}

function useDocumentAttachmentBlobPickerList(
  loadBlobInfo: DocumentAttachmentBlobPickerConfig["loadBlobInfo"],
  query: string,
): BlobPickerListState {
  const [state, setState] = useState<BlobPickerListState>({
    error: null,
    isLoading: false,
    rows: [],
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, error: null, isLoading: true }));

    void loadBlobInfo({
      limit: BLOB_PICKER_LIMIT,
      query,
      sort: {
        direction: "desc",
        key: "updated",
      },
    })
      .then((result) => {
        if (!cancelled) {
          setState({
            error: null,
            isLoading: false,
            rows: result.rows,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: unknownErrorMessage(error),
            isLoading: false,
            rows: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadBlobInfo, query]);

  return state;
}

function DocumentAttachmentBlobPickerResults(params: {
  canAttach: boolean;
  error: string | null;
  imageRows: ReadonlyArray<BlobInfo>;
  isLoading: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  selectingBlobKey: string | null;
}) {
  const {
    canAttach,
    error,
    imageRows,
    isLoading,
    onSelectBlob,
    selectingBlobKey,
  } = params;

  if (isLoading) {
    return (
      <span className="structured-document-blob-picker-status">
        Loading blobs...
      </span>
    );
  }

  if (error) {
    return (
      <span className="structured-document-blob-picker-status structured-document-blob-picker-status--error">
        {error}
      </span>
    );
  }

  if (imageRows.length === 0) {
    return (
      <span className="structured-document-blob-picker-status">
        No image blobs found.
      </span>
    );
  }

  return imageRows.map((blob) => (
    <button
      className="structured-document-blob-picker-option"
      disabled={!canAttach || selectingBlobKey !== null}
      key={blob.key}
      onClick={() => onSelectBlob(blob)}
      title={blob.blobId ?? blob.storageKey}
      type="button"
    >
      <span>{getDocumentAttachmentBlobName(blob)}</span>
      <span>
        {blob.mimeType ?? "image"}
        {" - "}
        {formatByteLength(blob.byteLength)}
      </span>
    </button>
  ));
}

function DocumentAttachmentBlobPicker(params: {
  blobPicker: DocumentAttachmentBlobPickerConfig;
  canAttach: boolean;
  onClose: () => void;
  slot: DocumentAttachmentSlot;
}) {
  const { blobPicker, canAttach, onClose, slot } = params;
  const { loadBlobInfo, onSelectedBlob } = blobPicker;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectingBlobKey, setSelectingBlobKey] = useState<string | null>(null);
  const state = useDocumentAttachmentBlobPickerList(
    loadBlobInfo,
    debouncedQuery,
  );
  const imageRows = useMemo(
    () => state.rows.filter(isImageDocumentAttachmentBlob),
    [state.rows],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleSelectBlob(blob: BlobInfo) {
    setSelectingBlobKey(blob.key);
    setSelectionError(null);

    try {
      await onSelectedBlob(slot.slotId, blob);
      onClose();
    } catch (error) {
      setSelectionError(unknownErrorMessage(error));
    } finally {
      setSelectingBlobKey(null);
    }
  }

  return (
    <div
      aria-label={`Select blob for ${slot.label}`}
      className="structured-document-blob-picker"
      role="dialog"
    >
      <div className="structured-document-blob-picker-toolbar">
        <input
          aria-label={`Search image blobs for ${slot.label}`}
          className="structured-document-blob-picker-search"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder="Search image blobs"
          value={query}
        />
        <button
          className="structured-document-slot-button"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
      <div className="structured-document-blob-picker-results">
        <DocumentAttachmentBlobPickerResults
          canAttach={canAttach}
          error={state.error}
          imageRows={imageRows}
          isLoading={state.isLoading}
          onSelectBlob={(blob) => {
            void handleSelectBlob(blob);
          }}
          selectingBlobKey={selectingBlobKey}
        />
      </div>
      {selectionError ? (
        <span className="structured-document-blob-picker-status structured-document-blob-picker-status--error">
          {selectionError}
        </span>
      ) : null}
    </div>
  );
}

function DocumentAttachmentSlotCard(params: {
  blobPicker: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrl: string | undefined;
  onSelectedFile: (fileList: FileList | null) => void;
  slot: DocumentAttachmentSlot;
  status: DocumentAttachmentStatus | undefined;
  storedAttachment: DocumentAttachment | null;
}) {
  const {
    blobPicker,
    canAttach,
    imageUrl,
    onSelectedFile,
    slot,
    status,
    storedAttachment,
  } = params;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [blobPickerOpen, setBlobPickerOpen] = useState(false);
  const statusLabel = getDocumentAttachmentStatusLabel(status);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    onSelectedFile(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <section className="structured-document-slot">
      <div className="structured-document-slot-copy">
        <strong>{slot.label}</strong>
        <span className="structured-document-slot-description">
          {slot.description}
        </span>
      </div>
      {imageUrl ? (
        <img
          className="structured-document-slot-preview"
          src={imageUrl}
          alt={storedAttachment?.name ?? slot.label}
        />
      ) : (
        <div className="structured-document-slot-preview structured-document-slot-placeholder">
          No image selected
        </div>
      )}
      <div className="structured-document-slot-meta">
        <span className="structured-document-slot-name">
          {storedAttachment?.name ?? "No file selected"}
        </span>
        <span className="structured-document-slot-detail">
          {storedAttachment
            ? formatByteLength(storedAttachment.byteLength)
            : "Attach an image to bind this slot."}
        </span>
      </div>
      <div className="structured-document-slot-actions">
        <button
          type="button"
          className="structured-document-slot-button"
          disabled={!canAttach}
          onClick={() => inputRef.current?.click()}
        >
          {storedAttachment ? "Replace Image" : "Upload Image"}
        </button>
        {blobPicker ? (
          <button
            className="structured-document-slot-button"
            disabled={!canAttach}
            onClick={() => setBlobPickerOpen((isOpen) => !isOpen)}
            type="button"
          >
            Choose Blob
          </button>
        ) : null}
        {statusLabel ? (
          <span className="structured-document-slot-status">{statusLabel}</span>
        ) : null}
      </div>
      {blobPicker && blobPickerOpen ? (
        <DocumentAttachmentBlobPicker
          blobPicker={blobPicker}
          canAttach={canAttach}
          onClose={() => setBlobPickerOpen(false)}
          slot={slot}
        />
      ) : null}
      <input
        id={inputId}
        ref={inputRef}
        className="structured-document-file-input"
        type="file"
        accept="image/*"
        disabled={!canAttach}
        onChange={handleInputChange}
      />
    </section>
  );
}

export function DocumentAttachmentSlots(params: {
  attachmentStatusBySlotId: Readonly<
    Record<string, DocumentAttachmentStatus | undefined>
  >;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobPicker?: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrlBySlotId: Readonly<Record<string, string | undefined>>;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
  slots: ReadonlyArray<DocumentAttachmentSlot>;
}) {
  const {
    attachmentStatusBySlotId,
    attachments,
    blobPicker,
    canAttach,
    imageUrlBySlotId,
    onSelectedAttachment,
    slots,
  } = params;

  return (
    <div className="structured-document-attachments">
      {slots.map((slot) => (
        <DocumentAttachmentSlotCard
          key={slot.slotId}
          blobPicker={blobPicker}
          canAttach={canAttach}
          imageUrl={imageUrlBySlotId[slot.slotId]}
          onSelectedFile={(fileList) => {
            onSelectedAttachment(slot.slotId, fileList);
          }}
          slot={slot}
          status={attachmentStatusBySlotId[slot.slotId]}
          storedAttachment={getLatestDocumentAttachmentBySlotId(
            attachments,
            slot.slotId,
          )}
        />
      ))}
    </div>
  );
}
