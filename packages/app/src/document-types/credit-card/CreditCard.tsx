import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  CREDIT_CARD_ATTACHMENT_SLOTS,
  type CreditCardDocumentFields,
  readCreditCardFields,
} from "./creditCardDocument";

type CreditCardStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

const CREDIT_CARD_REDACTED_NUMBER = "**** **** ****";
const CREDIT_CARD_REDACTED_CVV = "***";

function formatMaskedCardNumber(cardNumber: string | null | undefined): string {
  const digits = (cardNumber ?? "").replaceAll(/\D/gu, "");
  if (digits.length === 0) {
    return "None";
  }

  return `${CREDIT_CARD_REDACTED_NUMBER} ${digits.slice(-4)}`;
}

function formatMaskedCvv(cvvCode: string | null | undefined): string {
  return (cvvCode ?? "").trim().length > 0 ? CREDIT_CARD_REDACTED_CVV : "None";
}

export function CreditCardFields(params: {
  disabled?: boolean | undefined;
  fields: CreditCardDocumentFields;
  inputIds: {
    cardNumber: string;
    cvvCode: string;
    expirationDate: string;
    nameOnCard: string;
  };
  isEditing: boolean;
  onChange: (patch: Partial<CreditCardDocumentFields>) => void;
  ready: boolean;
}) {
  const {
    disabled = false,
    fields,
    inputIds,
    isEditing,
    onChange,
    ready,
  } = params;

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={[
          {
            displayValue: formatMaskedCardNumber(fields.cardNumber),
            label: "Card Number",
            value: fields.cardNumber,
          },
          { label: "Name on Card", value: fields.nameOnCard },
          { label: "Expiration Date", value: fields.expirationDate },
          {
            displayValue: formatMaskedCvv(fields.cvvCode),
            label: "CVV Code",
            value: fields.cvvCode,
          },
        ]}
      />
    );
  }

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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          autoComplete="cc-csc"
          inputMode="numeric"
          maxLength={4}
          type="password"
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

function CreditCardDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: CreditCardDocumentFields;
  inputIds: {
    cardNumber: string;
    cvvCode: string;
    expirationDate: string;
    nameOnCard: string;
  };
  isEditing: boolean;
  ready: boolean;
  setEditing: (editing: boolean) => void;
  setStructuredFields: CreditCardStructuredFieldSetter;
}) {
  return (
    <>
      <StructuredDocumentEditActions
        disabled={!params.ready || !params.canWrite}
        isEditing={params.isEditing}
        onToggleEditing={() => params.setEditing(!params.isEditing)}
      />
      <CreditCardFields
        disabled={!params.ready || !params.canWrite}
        fields={params.fields}
        inputIds={params.inputIds}
        isEditing={params.isEditing && params.canWrite}
        onChange={(patch) => {
          if (params.canWrite) {
            params.setStructuredFields("credit_card", patch);
          }
        }}
        ready={params.ready}
      />
    </>
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

interface CreditCardProps {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}

export function CreditCard(params: CreditCardProps) {
  const { auth, infra, state } = useTearleadsRuntime();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    setAttachment,
    setStructuredFields,
    structuredFields,
    syncing,
  } = useDocument();
  const fields = useMemo(
    () => readCreditCardFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
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
    infra.blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle credit card attachment selection",
    setAttachment,
  });
  const blobPicker = useBlobPickAttachment({
    blobStore: infra.blobStore,
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
          canAttach={canAttach && isEditing && canWrite}
          imageUrlBySlotId={imageUrlBySlotId}
          onClearAttachment={removeAttachment}
          onSelectedAttachment={handleSelectedAttachment}
          slots={CREDIT_CARD_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <CreditCardDocumentFieldsPane
          canWrite={canWrite}
          fields={fields}
          inputIds={inputIds}
          isEditing={isEditing}
          ready={ready}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
        />
      }
      isAuthenticated={auth.isAuthenticated}
      online={state.online}
      ready={ready}
      syncing={syncing}
      title="Credit Card"
    />
  );
}
