import { type ChangeEvent, useId, useRef } from "react";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type { DocumentAttachmentStatus } from "../../stores/documents/DocumentsProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import {
  type DocumentAttachmentSlot,
  getDocumentAttachmentStatusLabel,
  getLatestDocumentAttachmentBySlotId,
} from "./documentAttachmentUtils";

function DocumentAttachmentSlotCard(params: {
  canAttach: boolean;
  imageUrl: string | undefined;
  onSelectedFile: (fileList: FileList | null) => void;
  slot: DocumentAttachmentSlot;
  status: DocumentAttachmentStatus | undefined;
  storedAttachment: DocumentAttachment | null;
}) {
  const {
    canAttach,
    imageUrl,
    onSelectedFile,
    slot,
    status,
    storedAttachment,
  } = params;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
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
            : "Attach a file to bind this slot."}
        </span>
      </div>
      <div className="structured-document-slot-actions">
        <button
          type="button"
          className="structured-document-slot-button"
          disabled={!canAttach}
          onClick={() => inputRef.current?.click()}
        >
          {storedAttachment ? "Replace Image" : "Select Image"}
        </button>
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
  canAttach: boolean;
  imageUrlBySlotId: Readonly<Record<string, string | undefined>>;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
  slots: ReadonlyArray<DocumentAttachmentSlot>;
}) {
  const {
    attachmentStatusBySlotId,
    attachments,
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
