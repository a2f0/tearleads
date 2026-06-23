import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import { type ChangeEvent, useId, useRef } from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import {
  type DocumentAttachmentSlot,
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

function DocumentAttachmentSlotCard(params: {
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
  const imageIsLoading = Boolean(storedAttachment && !imageUrl);

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
        <div
          aria-busy={imageIsLoading || undefined}
          className="structured-document-slot-preview structured-document-slot-placeholder"
        >
          {imageIsLoading ? (
            <>
              <span
                className="structured-document-slot-spinner"
                aria-hidden="true"
              />
              <span>Downloading image...</span>
            </>
          ) : (
            "No image selected"
          )}
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
            onClick={() => blobPicker.onRequestBlobPick(slot)}
            type="button"
          >
            Choose Blob
          </button>
        ) : null}
        {storedAttachment ? (
          <button
            aria-label={`Clear ${slot.label}`}
            className="structured-document-slot-button"
            disabled={!canAttach}
            onClick={() => onClearAttachment(slot.slotId)}
            title={`Clear ${slot.label}`}
            type="button"
          >
            <TrashIcon aria-hidden size={14} />
            Clear Image
          </button>
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
  onClearAttachment: (slotId: string) => void;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
  slots: ReadonlyArray<DocumentAttachmentSlot>;
}) {
  const {
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
      {slots.map((slot) => (
        <DocumentAttachmentSlotCard
          key={slot.slotId}
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
