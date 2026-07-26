import { useCallback, useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  CREDIT_CARD_CVV_REVEAL_LABEL,
  CREDIT_CARD_NUMBER_REVEAL_LABEL,
  CreditCardSecretActions,
  CreditCardSecretField,
  CreditCardTextField,
  formatMaskedCardNumber,
  formatMaskedCvv,
  hasCreditCardValue,
  useCreditCardReveal,
} from "./CreditCardFieldRows";
import {
  CREDIT_CARD_ATTACHMENT_SLOTS,
  type CreditCardDocumentFields,
  readCreditCardFields,
} from "./creditCardDocument";

type CreditCardStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

interface CreditCardInputIds {
  cardNumber: string;
  cvvCode: string;
  expirationDate: string;
  issuer: string;
  nameOnCard: string;
}

function CreditCardReadFields(params: { fields: CreditCardDocumentFields }) {
  const { fields } = params;
  const {
    isCardNumberRevealed,
    isCvvCodeRevealed,
    toggleCardNumber,
    toggleCvvCode,
  } = useCreditCardReveal();

  return (
    <StructuredDocumentReadFields
      fields={[
        { label: "Issuer", value: fields.issuer },
        {
          // Nothing to unmask or copy when the field is empty, so the controls
          // are dropped rather than shown as buttons that do nothing.
          action: hasCreditCardValue(fields.cardNumber) ? (
            <CreditCardSecretActions
              isRevealed={isCardNumberRevealed}
              label={CREDIT_CARD_NUMBER_REVEAL_LABEL}
              onToggle={toggleCardNumber}
              value={fields.cardNumber}
            />
          ) : undefined,
          displayValue: isCardNumberRevealed
            ? undefined
            : formatMaskedCardNumber(fields.cardNumber),
          label: "Card Number",
          value: fields.cardNumber,
        },
        { label: "Name on Card", value: fields.nameOnCard },
        { label: "Expiration Date", value: fields.expirationDate },
        {
          action: hasCreditCardValue(fields.cvvCode) ? (
            <CreditCardSecretActions
              isRevealed={isCvvCodeRevealed}
              label={CREDIT_CARD_CVV_REVEAL_LABEL}
              onToggle={toggleCvvCode}
              value={fields.cvvCode}
            />
          ) : undefined,
          displayValue: isCvvCodeRevealed
            ? undefined
            : formatMaskedCvv(fields.cvvCode),
          label: "CVV Code",
          value: fields.cvvCode,
        },
      ]}
    />
  );
}

function CreditCardEditFields(params: {
  disabled: boolean;
  fields: CreditCardDocumentFields;
  inputIds: CreditCardInputIds;
  onChange: (patch: Partial<CreditCardDocumentFields>) => void;
  ready: boolean;
}) {
  const { disabled, fields, inputIds, onChange, ready } = params;
  const {
    isCardNumberRevealed,
    isCvvCodeRevealed,
    toggleCardNumber,
    toggleCvvCode,
  } = useCreditCardReveal();

  return (
    <StructuredDocumentFields>
      <CreditCardTextField
        disabled={disabled}
        inputId={inputIds.issuer}
        inputLabel="Credit card issuer"
        label="Issuer"
        onChange={(issuer) => onChange({ issuer })}
        placeholder="Bank of Example"
        ready={ready}
        value={fields.issuer}
      />
      <CreditCardSecretField
        autoComplete="cc-number"
        disabled={disabled}
        inputId={inputIds.cardNumber}
        inputLabel="Credit card number"
        isRevealed={isCardNumberRevealed}
        label="Card Number"
        onChange={(cardNumber) => onChange({ cardNumber })}
        onToggle={toggleCardNumber}
        placeholder="4111 1111 1111 1111"
        ready={ready}
        revealLabel={CREDIT_CARD_NUMBER_REVEAL_LABEL}
        value={fields.cardNumber}
      />
      <CreditCardTextField
        autoComplete="cc-name"
        disabled={disabled}
        inputId={inputIds.nameOnCard}
        inputLabel="Name on card"
        label="Name on Card"
        onChange={(nameOnCard) => onChange({ nameOnCard })}
        placeholder="Ada Lovelace"
        ready={ready}
        value={fields.nameOnCard}
      />
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
      <CreditCardSecretField
        autoComplete="cc-csc"
        disabled={disabled}
        inputId={inputIds.cvvCode}
        inputLabel="Credit card CVV code"
        isRevealed={isCvvCodeRevealed}
        label="CVV Code"
        maxLength={4}
        onChange={(cvvCode) => onChange({ cvvCode })}
        onToggle={toggleCvvCode}
        placeholder="123"
        ready={ready}
        revealLabel={CREDIT_CARD_CVV_REVEAL_LABEL}
        value={fields.cvvCode}
      />
    </StructuredDocumentFields>
  );
}

export function CreditCardFields(params: {
  disabled?: boolean | undefined;
  fields: CreditCardDocumentFields;
  inputIds: CreditCardInputIds;
  isEditing: boolean;
  onChange: (patch: Partial<CreditCardDocumentFields>) => void;
  ready: boolean;
}) {
  if (!params.isEditing) {
    return <CreditCardReadFields fields={params.fields} />;
  }

  return (
    <CreditCardEditFields
      disabled={params.disabled ?? false}
      fields={params.fields}
      inputIds={params.inputIds}
      onChange={params.onChange}
      ready={params.ready}
    />
  );
}

export function CreditCardDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: CreditCardDocumentFields;
  inputIds: CreditCardInputIds;
  isEditing: boolean;
  onToggleEditing: () => void;
  ready: boolean;
  setStructuredFields: CreditCardStructuredFieldSetter;
}) {
  useStructuredDocumentEditAction({
    disabled: !params.ready || !params.canWrite,
    id: "credit-card-toggle-edit",
    isEditing: params.isEditing,
    onToggleEditing: params.onToggleEditing,
  });

  return (
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
  );
}

const CREDIT_CARD_ATTACHMENT_SLOT_IDS = CREDIT_CARD_ATTACHMENT_SLOTS.map(
  (slot) => slot.slotId,
);

interface CreditCardProps {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}

export function CreditCard(params: CreditCardProps) {
  const { infra } = useTearleadsRuntime();
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
  } = useDocument();
  const fields = useMemo(
    () => readCreditCardFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  // Kept reference-stable so the toolbar action it feeds does not re-register
  // on every render.
  const toggleEditing = useCallback(
    () => setIsEditing((editing) => !editing),
    [setIsEditing],
  );
  const inputIds = {
    cardNumber: useId(),
    cvvCode: useId(),
    expirationDate: useId(),
    issuer: useId(),
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
      attachments={
        <DocumentAttachmentSlots
          attachmentStorageKeyBySlotId={attachmentStorageKeyBySlotId}
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
      fields={
        <CreditCardDocumentFieldsPane
          canWrite={canWrite}
          fields={fields}
          inputIds={inputIds}
          isEditing={isEditing}
          onToggleEditing={toggleEditing}
          ready={ready}
          setStructuredFields={setStructuredFields}
        />
      }
    />
  );
}
