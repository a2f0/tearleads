import { useEffect, useId, useMemo } from "react";
import type { CreditCardDocumentFields } from "../../data/documents/documentKinds";
import { useAttachmentImageUrls } from "../../data/documents/useAttachmentImageUrls";
import { useAppData } from "../../providers/data/AppDataProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  CREDIT_CARD_ATTACHMENT_SLOTS,
  createEmptyCreditCardDocument,
  parseCreditCardFields,
  updateCreditCardFields,
} from "./creditCardDocument";

function CreditCardFields(params: {
  fields: CreditCardDocumentFields;
  inputIds: {
    cardNumber: string;
    cvvCode: string;
    expirationDate: string;
    nameOnCard: string;
  };
  onChange: (patch: Partial<CreditCardDocumentFields>) => void;
  ready: boolean;
}) {
  const { fields, inputIds, onChange, ready } = params;

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField
        inputId={inputIds.cardNumber}
        label="Card Number"
      >
        <input
          id={inputIds.cardNumber}
          aria-label="Credit card number"
          type="password"
          value={fields.cardNumber}
          onChange={(event) => onChange({ cardNumber: event.target.value })}
          placeholder={ready ? "4111 1111 1111 1111" : "Loading..."}
          disabled={!ready}
          autoComplete="cc-number"
          inputMode="numeric"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.nameOnCard}
        label="Name on Card"
      >
        <input
          id={inputIds.nameOnCard}
          aria-label="Name on card"
          value={fields.nameOnCard}
          onChange={(event) => onChange({ nameOnCard: event.target.value })}
          placeholder={ready ? "Ada Lovelace" : "Loading..."}
          disabled={!ready}
          autoComplete="cc-name"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.expirationDate}
        label="Expiration Date"
      >
        <input
          id={inputIds.expirationDate}
          aria-label="Credit card expiration date"
          type="month"
          value={fields.expirationDate}
          onChange={(event) => onChange({ expirationDate: event.target.value })}
          disabled={!ready}
          autoComplete="cc-exp"
        />
      </StructuredDocumentField>
      <StructuredDocumentField inputId={inputIds.cvvCode} label="CVV Code">
        <input
          id={inputIds.cvvCode}
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
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

const CREDIT_CARD_ATTACHMENT_COPY = {
  authenticatedOnline:
    "Card images stay bound to fixed slots on this document.",
  localOnly: "Card images save locally and sync when you're online.",
  unavailable: "Card image attachments require a local key package.",
};

export function CreditCard() {
  const { blobStore, isAuthenticated, online } = useAppData();
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
  const inputIds = {
    cardNumber: useId(),
    cvvCode: useId(),
    expirationDate: useId(),
    nameOnCard: useId(),
  };
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle credit card attachment selection",
    setAttachment,
  });

  useEffect(() => {
    if (ready && text.trim().length === 0) {
      setText(createEmptyCreditCardDocument());
    }
  }, [ready, setText, text]);

  return (
    <StructuredDocument
      attachmentCopy={CREDIT_CARD_ATTACHMENT_COPY}
      attachments={
        <DocumentAttachmentSlots
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          canAttach={canAttach}
          imageUrlBySlotId={imageUrlBySlotId}
          onSelectedAttachment={handleSelectedAttachment}
          slots={CREDIT_CARD_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <CreditCardFields
          fields={fields}
          inputIds={inputIds}
          onChange={(patch) => {
            setText(updateCreditCardFields(text, patch));
          }}
          ready={ready}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Credit Card"
    />
  );
}
