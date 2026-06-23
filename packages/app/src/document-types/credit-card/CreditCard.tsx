import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  CREDIT_CARD_ATTACHMENT_SLOTS,
  type CreditCardDocumentFields,
  readCreditCardFields,
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

const CREDIT_CARD_ATTACHMENT_SLOT_IDS = CREDIT_CARD_ATTACHMENT_SLOTS.map(
  (slot) => slot.slotId,
);

export function CreditCard(params: {
  containerId: string | null;
  localId: string;
}) {
  const { auth, infra, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { blobStore } = infra;
  const { online } = state;
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    ready,
    setAttachment,
    setStructuredFields,
    structuredFields,
    syncing,
  } = useDocument();
  const fields = useMemo(
    () => readCreditCardFields(structuredFields),
    [structuredFields],
  );
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
  const blobPicker = useBlobPickAttachment({
    blobStore,
    containerId: params.containerId,
    errorMessage: "Failed to handle credit card blob attachment selection",
    localId: params.localId,
    setAttachment,
    slotIds: CREDIT_CARD_ATTACHMENT_SLOT_IDS,
  });

  return (
    <StructuredDocument
      attachmentCopy={CREDIT_CARD_ATTACHMENT_COPY}
      attachments={
        <DocumentAttachmentSlots
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          blobPicker={blobPicker}
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
            setStructuredFields("credit_card", patch);
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
