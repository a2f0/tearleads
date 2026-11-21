import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import { type ChangeEvent, useId, useRef } from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import { AttachmentActionButton } from "./AttachmentActionButton";
import {
  AttachmentPreviewNotice,
  type AttachmentPreviewNoticeSource,
} from "./AttachmentPreviewNotice";
import { useDocumentBlobOpen } from "./DocumentBlobOpenContext";
import {
  type DocumentAttachmentSlot,
  expandAttachmentSlots,
  getDocumentAttachmentStatusLabel,
  getLatestDocumentAttachmentBySlotId,
} from "./documentAttachmentUtils";

// "Choose Blob" hands selection off to the Explorer's blob-browser panel (in
// pick mode) rather than showing an inline list. The host passes a callback
// that opens that panel for the given slot; the chosen blob is applied back on
// the document once the panel routes here.
export interface DocumentAttachmentBlobPickerConfig {
  onRequestBlobPick: (slot: DocumentAttachmentSlot) => void;
}

function DocumentAttachmentSlotActions(params: {
  blobPicker: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  onClearAttachment: (slotId: string) => void;
  onUploadAttachment: () => void;
  slot: DocumentAttachmentSlot;
  storedAttachment: DocumentAttachment | null;
}) {
  const {
    blobPicker,
    canAttach,
    onClearAttachment,
    onUploadAttachment,
    slot,
    storedAttachment,
  } = params;

  if (!canAttach) {
    return null;
  }

  return (
    <>
      <AttachmentActionButton
        label={
          slot.multiple
            ? "Add Photos"
            : storedAttachment
              ? "Replace Image"
              : "Upload Image"
        }
        onClick={onUploadAttachment}
      />
      {blobPicker ? (
        <AttachmentActionButton
          label="Choose Blob"
          onClick={() => blobPicker.onRequestBlobPick(slot)}
        />
      ) : null}
      {storedAttachment ? (
        <AttachmentActionButton
          ariaLabel={`Clear ${slot.label}`}
          label="Clear Image"
          onClick={() => onClearAttachment(slot.slotId)}
          title={`Clear ${slot.label}`}
        >
          <TrashIcon aria-hidden size={14} />
        </AttachmentActionButton>
      ) : null}
    </>
  );
}

function slotPlaceholder(slot: {
  hasStorageKey: boolean;
  stored: boolean;
  unavailable: boolean;
}): string {
  if (!slot.stored) return "No image selected";
  if (slot.unavailable) return "Image unavailable";
  return slot.hasStorageKey ? "No image preview" : "Waiting for image bytes";
}

function DocumentAttachmentSlotPreview(params: {
  hasStorageKey: boolean;
  imageUrl: string | undefined;
  onOpenAttachment: (() => void) | null;
  slot: DocumentAttachmentSlot;
  storedAttachment: DocumentAttachment | null;
  unavailable: boolean;
}) {
  const {
    hasStorageKey,
    imageUrl,
    onOpenAttachment,
    slot,
    storedAttachment,
    unavailable,
  } = params;
  const altText = storedAttachment?.name ?? slot.label;
  const descriptionId = useId();

  if (imageUrl) {
    return onOpenAttachment && storedAttachment ? (
      <button
        aria-label={`Open ${slot.label}`}
        className="structured-document-slot-preview structured-document-slot-preview-button"
        onClick={onOpenAttachment}
        title={`Open ${storedAttachment.name}`}
        type="button"
      >
        <img
          className="structured-document-slot-preview-image"
          src={imageUrl}
          alt=""
        />
      </button>
    ) : (
      <img
        className="structured-document-slot-preview"
        src={imageUrl}
        alt={altText}
      />
    );
  }

  const placeholderContent = slotPlaceholder({
    hasStorageKey,
    stored: storedAttachment !== null,
    unavailable,
  });

  return onOpenAttachment && storedAttachment ? (
    <button
      aria-describedby={descriptionId}
      aria-label={`Open ${slot.label}`}
      className="structured-document-slot-preview structured-document-slot-placeholder structured-document-slot-preview-button"
      onClick={onOpenAttachment}
      title={`Open ${storedAttachment.name}`}
      type="button"
    >
      <span id={descriptionId}>{placeholderContent}</span>
    </button>
  ) : (
    <div className="structured-document-slot-preview structured-document-slot-placeholder">
      {placeholderContent}
    </div>
  );
}

function DocumentAttachmentSlotCard(params: {
  attachmentStorageKey: string | undefined;
  blobPicker: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrl: string | undefined;
  onClearAttachment: (slotId: string) => void;
  onRetryDownload: (() => void) | undefined;
  onSelectedFile: (fileList: FileList | null) => void;
  slot: DocumentAttachmentSlot;
  status: DocumentAttachmentStatus | undefined;
  storedAttachment: DocumentAttachment | null;
}) {
  const {
    attachmentStorageKey,
    blobPicker,
    canAttach,
    imageUrl,
    onClearAttachment,
    onRetryDownload,
    onSelectedFile,
    slot,
    status,
    storedAttachment,
  } = params;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusLabel = getDocumentAttachmentStatusLabel(status);
  const blobOpen = useDocumentBlobOpen();
  const openAttachment =
    storedAttachment && attachmentStorageKey && blobOpen
      ? () => blobOpen.openBlob({ storageKey: attachmentStorageKey })
      : null;

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    onSelectedFile(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <section className="structured-document-slot">
      <div className="structured-document-slot-copy">
        <strong>{slot.label}</strong>
      </div>
      <DocumentAttachmentSlotPreview
        hasStorageKey={Boolean(attachmentStorageKey)}
        imageUrl={imageUrl}
        onOpenAttachment={openAttachment}
        slot={slot}
        storedAttachment={storedAttachment}
        unavailable={status === "unavailable"}
      />
      {storedAttachment ? (
        <div className="structured-document-slot-meta">
          <span className="structured-document-slot-name">
            {storedAttachment.name}
          </span>
          <span className="structured-document-slot-detail">
            {formatByteLength(storedAttachment.byteLength)}
          </span>
        </div>
      ) : null}
      <div className="structured-document-slot-actions">
        <DocumentAttachmentSlotActions
          blobPicker={blobPicker}
          canAttach={canAttach}
          onClearAttachment={onClearAttachment}
          onUploadAttachment={() => inputRef.current?.click()}
          slot={slot}
          storedAttachment={storedAttachment}
        />
        {status === "unavailable" && onRetryDownload ? (
          <AttachmentActionButton
            ariaLabel={`Retry download of ${slot.label}`}
            label="Retry Download"
            onClick={onRetryDownload}
          />
        ) : null}
        {statusLabel ? (
          <span className="structured-document-slot-status">{statusLabel}</span>
        ) : null}
      </div>
      <input
        id={inputId}
        ref={inputRef}
        className="structured-document-file-input"
        type="file"
        accept="image/*"
        aria-label={slot.label}
        multiple={slot.multiple}
        disabled={!canAttach}
        onChange={handleInputChange}
      />
    </section>
  );
}

export function DocumentAttachmentSlots(params: {
  attachmentStorageKeyBySlotId: Readonly<Record<string, string | undefined>>;
  attachmentStatusBySlotId: Readonly<
    Record<string, DocumentAttachmentStatus | undefined>
  >;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobPicker?: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrlBySlotId: Readonly<Record<string, string | undefined>>;
  onClearAttachment: (slotId: string) => void;
  /** Fetch an unavailable copy from the server again. */
  onRetryDownload?: (() => void) | undefined;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
  previewNotice?: AttachmentPreviewNoticeSource | undefined;
  slots: ReadonlyArray<DocumentAttachmentSlot>;
}) {
  const {
    attachmentStorageKeyBySlotId,
    attachmentStatusBySlotId,
    attachments,
    blobPicker,
    canAttach,
    imageUrlBySlotId,
    onClearAttachment,
    onRetryDownload,
    onSelectedAttachment,
    previewNotice,
    slots,
  } = params;

  return (
    <div className="structured-document-attachments">
      {previewNotice ? <AttachmentPreviewNotice {...previewNotice} /> : null}
      {expandAttachmentSlots(slots, attachments, canAttach).map((slot) => (
        <DocumentAttachmentSlotCard
          key={slot.slotId}
          attachmentStorageKey={attachmentStorageKeyBySlotId[slot.slotId]}
          blobPicker={blobPicker}
          canAttach={canAttach}
          imageUrl={imageUrlBySlotId[slot.slotId]}
          onClearAttachment={onClearAttachment}
          onRetryDownload={onRetryDownload}
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
