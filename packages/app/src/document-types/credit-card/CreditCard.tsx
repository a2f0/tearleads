import { type ChangeEvent, useEffect, useId, useMemo, useRef } from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobBytes } from "../../data/blobs";
import {
  type DocumentAttachmentStatus,
  useDocument,
} from "../../data/documents/DocumentsProvider";
import type { CreditCardDocumentFields } from "../../data/documents/documentKinds";
import { useAttachmentImageUrls } from "../../data/documents/useAttachmentImageUrls";
import { useLog } from "../../logging/LogProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import {
  CREDIT_CARD_ATTACHMENT_SLOTS,
  createEmptyCreditCardDocument,
  getCreditCardAttachmentBySlotId,
  parseCreditCardFields,
  updateCreditCardFields,
} from "./creditCardDocument";
import "./CreditCard.css";

interface CreditCardAttachmentUpload {
  bytes: BlobBytes;
  mimeType: string | null;
  name: string;
}

async function readAttachmentUpload(
  file: File,
): Promise<CreditCardAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

function getAttachmentStatusLabel(
  status: DocumentAttachmentStatus | undefined,
): string | null {
  if (status === "needs_replacement") {
    return "Replace this image to finish the access change.";
  }

  if (status === "syncing") {
    return "Syncing image.";
  }

  return null;
}

function CreditCardSlotCard(params: {
  canAttach: boolean;
  imageUrl: string | undefined;
  onSelectedFile: (fileList: FileList | null) => void;
  slot: (typeof CREDIT_CARD_ATTACHMENT_SLOTS)[number];
  status: DocumentAttachmentStatus | undefined;
  storedAttachment: ReturnType<typeof getCreditCardAttachmentBySlotId>;
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
  const statusLabel = getAttachmentStatusLabel(status);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    onSelectedFile(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <section className="credit-card-slot">
      <div className="credit-card-slot-copy">
        <strong>{slot.label}</strong>
        <span className="credit-card-slot-description">{slot.description}</span>
      </div>
      {imageUrl ? (
        <img
          className="credit-card-slot-preview"
          src={imageUrl}
          alt={storedAttachment?.name ?? slot.label}
        />
      ) : (
        <div className="credit-card-slot-preview credit-card-slot-placeholder">
          No image selected
        </div>
      )}
      <div className="credit-card-slot-meta">
        <span className="credit-card-slot-name">
          {storedAttachment?.name ?? "No file selected"}
        </span>
        <span className="credit-card-slot-detail">
          {storedAttachment
            ? formatByteLength(storedAttachment.byteLength)
            : "Attach a file to bind this slot."}
        </span>
      </div>
      <div className="credit-card-slot-actions">
        <button
          type="button"
          className="credit-card-slot-button"
          disabled={!canAttach}
          onClick={() => inputRef.current?.click()}
        >
          {storedAttachment ? "Replace Image" : "Select Image"}
        </button>
        {statusLabel ? (
          <span className="credit-card-slot-status">{statusLabel}</span>
        ) : null}
      </div>
      <input
        id={inputId}
        ref={inputRef}
        className="credit-card-file-input"
        type="file"
        accept="image/*"
        disabled={!canAttach}
        onChange={handleInputChange}
      />
    </section>
  );
}

function CreditCardHeader(params: {
  canAttach: boolean;
  isAuthenticated: boolean;
  online: boolean;
  ready: boolean;
  syncing: boolean;
}) {
  const { canAttach, isAuthenticated, online, ready, syncing } = params;

  return (
    <div className="credit-card-header">
      <div className="credit-card-title">
        <strong>Credit Card</strong>
        <span className="credit-card-status">
          {!ready ? "Loading..." : syncing ? "Syncing..." : "Ready"}
        </span>
      </div>
      <span className="credit-card-status">
        {canAttach
          ? isAuthenticated && online
            ? "Card images stay bound to fixed slots on this document."
            : "Card images save locally and sync when you're online."
          : "Card image attachments require a local key package."}
      </span>
    </div>
  );
}

function CreditCardFields(params: {
  fields: CreditCardDocumentFields;
  onChange: (patch: Partial<CreditCardDocumentFields>) => void;
  ready: boolean;
}) {
  const { fields, onChange, ready } = params;

  return (
    <div className="credit-card-fields">
      <label className="credit-card-field">
        Card Number
        <input
          aria-label="Credit card number"
          type="password"
          value={fields.cardNumber}
          onChange={(event) => onChange({ cardNumber: event.target.value })}
          placeholder={ready ? "4111 1111 1111 1111" : "Loading..."}
          disabled={!ready}
          autoComplete="cc-number"
          inputMode="numeric"
        />
      </label>
      <label className="credit-card-field">
        Name on Card
        <input
          aria-label="Name on card"
          value={fields.nameOnCard}
          onChange={(event) => onChange({ nameOnCard: event.target.value })}
          placeholder={ready ? "Ada Lovelace" : "Loading..."}
          disabled={!ready}
          autoComplete="cc-name"
        />
      </label>
      <label className="credit-card-field">
        Expiration Date
        <input
          aria-label="Credit card expiration date"
          type="month"
          value={fields.expirationDate}
          onChange={(event) => onChange({ expirationDate: event.target.value })}
          disabled={!ready}
          autoComplete="cc-exp"
        />
      </label>
      <label className="credit-card-field">
        CVV Code
        <input
          aria-label="Credit card CVV code"
          value={fields.cvvCode}
          onChange={(event) => onChange({ cvvCode: event.target.value })}
          placeholder={ready ? "123" : "Loading..."}
          disabled={!ready}
          autoComplete="cc-csc"
          inputMode="numeric"
          maxLength={4}
          type="password"
        />
      </label>
    </div>
  );
}

function CreditCardAttachments(params: {
  attachmentStatusBySlotId: ReturnType<
    typeof useDocument
  >["attachmentStatusBySlotId"];
  attachments: ReturnType<typeof useDocument>["attachments"];
  canAttach: boolean;
  imageUrlBySlotId: ReturnType<typeof useAttachmentImageUrls>;
  onSelectedAttachment: (slotId: string, fileList: FileList | null) => void;
}) {
  const {
    attachmentStatusBySlotId,
    attachments,
    canAttach,
    imageUrlBySlotId,
    onSelectedAttachment,
  } = params;

  return (
    <div className="credit-card-attachments">
      {CREDIT_CARD_ATTACHMENT_SLOTS.map((slot) => {
        const storedAttachment = getCreditCardAttachmentBySlotId(
          attachments,
          slot.slotId,
        );

        return (
          <CreditCardSlotCard
            key={slot.slotId}
            canAttach={canAttach}
            imageUrl={imageUrlBySlotId[slot.slotId]}
            onSelectedFile={(fileList) => {
              onSelectedAttachment(slot.slotId, fileList);
            }}
            slot={slot}
            status={attachmentStatusBySlotId[slot.slotId]}
            storedAttachment={storedAttachment}
          />
        );
      })}
    </div>
  );
}

export function CreditCard() {
  const { blobStore, isAuthenticated, online } = useAppData();
  const { logError } = useLog();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    ready,
    setAttachment,
    setText,
    syncing,
    text,
  } = useDocument();
  const fields = useMemo(() => parseCreditCardFields(text), [text]);
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );

  useEffect(() => {
    if (ready && text.trim().length === 0) {
      setText(createEmptyCreditCardDocument());
    }
  }, [ready, setText, text]);

  async function handleSelectedAttachment(
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

    setAttachment(slotId, await readAttachmentUpload(file));
  }

  return (
    <div className="credit-card">
      <CreditCardHeader
        canAttach={canAttach}
        isAuthenticated={isAuthenticated}
        online={online}
        ready={ready}
        syncing={syncing}
      />
      <CreditCardFields
        fields={fields}
        onChange={(patch) => {
          setText(updateCreditCardFields(text, patch));
        }}
        ready={ready}
      />
      <CreditCardAttachments
        attachmentStatusBySlotId={attachmentStatusBySlotId}
        attachments={attachments}
        canAttach={canAttach}
        imageUrlBySlotId={imageUrlBySlotId}
        onSelectedAttachment={(slotId, fileList) => {
          void handleSelectedAttachment(slotId, fileList).catch((error) => {
            logError(
              "Failed to handle credit card attachment selection",
              error,
            );
          });
        }}
      />
    </div>
  );
}
