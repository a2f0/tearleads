import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import { AttachmentActionButton } from "./AttachmentActionButton";
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

function idlePreviewText(
  attachment: DocumentAttachment | null,
  hasLocalBytes: boolean,
) {
  if (!attachment) return "No image selected";
  return hasLocalBytes ? "Preview unavailable" : "Waiting for image bytes";
}

function DocumentAttachmentSlotPreview(params: {
  loadingText: string | null;
  hasLocalBytes: boolean;
  imageUrl: string | undefined;
  onOpenAttachment: (() => void) | null;
  slot: DocumentAttachmentSlot;
  storedAttachment: DocumentAttachment | null;
}) {
  const {
    loadingText,
    hasLocalBytes,
    imageUrl,
    onOpenAttachment,
    slot,
    storedAttachment,
  } = params;
  const altText = storedAttachment?.name ?? slot.label;

  const [failedUrl, setFailedUrl] = useState<string>();
  if (imageUrl && imageUrl !== failedUrl) {
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
          key={imageUrl}
          onError={() => setFailedUrl(imageUrl)}
          alt=""
        />
      </button>
    ) : (
      <img
        className="structured-document-slot-preview"
        src={imageUrl}
        key={imageUrl}
        onError={() => setFailedUrl(imageUrl)}
        alt={altText}
      />
    );
  }

  const placeholderContent = loadingText ? (
    <>
      <span className="structured-document-slot-spinner" aria-hidden="true" />
      <span>{loadingText}</span>
    </>
  ) : (
    idlePreviewText(storedAttachment, hasLocalBytes)
  );

  return onOpenAttachment && storedAttachment ? (
    <button
      aria-busy={Boolean(loadingText) || undefined}
      aria-label={`Open ${slot.label}`}
      className="structured-document-slot-preview structured-document-slot-placeholder structured-document-slot-preview-button"
      onClick={onOpenAttachment}
      title={`Open ${storedAttachment.name}`}
      type="button"
    >
      {placeholderContent}
    </button>
  ) : (
    <div
      aria-busy={Boolean(loadingText) || undefined}
      className="structured-document-slot-preview structured-document-slot-placeholder"
    >
      {placeholderContent}
    </div>
  );
}

function DocumentAttachmentSlotCard(params: {
  attachmentStorageKey: string | undefined;
  loadingPreview: boolean;
  blobPicker: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrl: string | undefined;
  onClearAttachment: (slotId: string) => void;
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
    onSelectedFile,
    slot,
    status,
    storedAttachment,
  } = params;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusLabel = getDocumentAttachmentStatusLabel(status);
  const loadingText = params.loadingPreview ? "Loading preview..." : null;
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
        loadingText={loadingText}
        hasLocalBytes={Boolean(attachmentStorageKey)}
        imageUrl={imageUrl}
        onOpenAttachment={openAttachment}
        slot={slot}
        storedAttachment={storedAttachment}
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
  loadingPreviewSlots: ReadonlySet<string>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string | undefined>>;
  attachmentStatusBySlotId: Readonly<
    Record<string, DocumentAttachmentStatus | undefined>
  >;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobPicker?: DocumentAttachmentBlobPickerConfig | undefined;
  canAttach: boolean;
  imageUrlBySlotId: Readonly<Record<string, string | undefined>>;
  onClearAttachment: (slotId: string) => void;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
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
    onSelectedAttachment,
    slots,
  } = params;

  return (
    <div className="structured-document-attachments">
      {expandAttachmentSlots(slots, attachments, canAttach).map((slot) => (
        <DocumentAttachmentSlotCard
          key={slot.slotId}
          loadingPreview={params.loadingPreviewSlots.has(slot.slotId)}
          attachmentStorageKey={attachmentStorageKeyBySlotId[slot.slotId]}
          blobPicker={blobPicker}
          canAttach={canAttach}
          imageUrl={imageUrlBySlotId[slot.slotId]}
          onClearAttachment={onClearAttachment}
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
