import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useCallback, useId, useMemo, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
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
  nameOnCard: string;
}

const CREDIT_CARD_REDACTED_NUMBER = "**** **** ****";
const CREDIT_CARD_REDACTED_CVV = "***";
const CREDIT_CARD_NUMBER_REVEAL_LABEL = "credit card number";
const CREDIT_CARD_CVV_REVEAL_LABEL = "credit card CVV code";

function formatMaskedCardNumber(cardNumber: string | null | undefined): string {
  const digits = (cardNumber ?? "").replaceAll(/\D/gu, "");
  if (digits.length === 0) {
    return "None";
  }

  return `${CREDIT_CARD_REDACTED_NUMBER} ${digits.slice(-4)}`;
}

function formatMaskedCvv(cvvCode: string | null | undefined): string {
  return hasCreditCardValue(cvvCode) ? CREDIT_CARD_REDACTED_CVV : "None";
}

function hasCreditCardValue(value: string | null | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

function CreditCardRevealButton(params: {
  disabled?: boolean | undefined;
  isRevealed: boolean;
  label: string;
  onToggle: () => void;
}) {
  const action = `${params.isRevealed ? "Hide" : "Show"} ${params.label}`;

  return (
    <MiniAppButton
      aria-label={action}
      aria-pressed={params.isRevealed}
      className="mini-app-icon-button"
      disabled={params.disabled ?? false}
      onClick={params.onToggle}
      title={action}
      variant="ghost"
    >
      {params.isRevealed ? (
        <EyeSlashIcon aria-hidden size={16} />
      ) : (
        <EyeIcon aria-hidden size={16} />
      )}
    </MiniAppButton>
  );
}

// Each mode owns its own reveal state, so leaving edit mode re-masks the
// values rather than carrying a reveal across the switch.
function useCreditCardReveal() {
  const [isCardNumberRevealed, setIsCardNumberRevealed] = useState(false);
  const [isCvvCodeRevealed, setIsCvvCodeRevealed] = useState(false);

  return {
    isCardNumberRevealed,
    isCvvCodeRevealed,
    toggleCardNumber: () => setIsCardNumberRevealed((revealed) => !revealed),
    toggleCvvCode: () => setIsCvvCodeRevealed((revealed) => !revealed),
  };
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
        {
          // Nothing to unmask when the field is empty, so the toggle is
          // dropped rather than shown as a control that does nothing.
          action: hasCreditCardValue(fields.cardNumber) ? (
            <CreditCardRevealButton
              isRevealed={isCardNumberRevealed}
              label={CREDIT_CARD_NUMBER_REVEAL_LABEL}
              onToggle={toggleCardNumber}
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
            <CreditCardRevealButton
              isRevealed={isCvvCodeRevealed}
              label={CREDIT_CARD_CVV_REVEAL_LABEL}
              onToggle={toggleCvvCode}
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
      <StructuredDocumentField
        action={
          <CreditCardRevealButton
            disabled={disabled}
            isRevealed={isCardNumberRevealed}
            label={CREDIT_CARD_NUMBER_REVEAL_LABEL}
            onToggle={toggleCardNumber}
          />
        }
        inputId={inputIds.cardNumber}
        label="Card Number"
      >
        <input
          id={inputIds.cardNumber}
          aria-label="Credit card number"
          type={isCardNumberRevealed ? "text" : "password"}
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
      <StructuredDocumentField
        action={
          <CreditCardRevealButton
            disabled={disabled}
            isRevealed={isCvvCodeRevealed}
            label={CREDIT_CARD_CVV_REVEAL_LABEL}
            onToggle={toggleCvvCode}
          />
        }
        inputId={inputIds.cvvCode}
        label="CVV Code"
      >
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
          type={isCvvCodeRevealed ? "text" : "password"}
        />
      </StructuredDocumentField>
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
      ready={ready}
      syncing={syncing}
      title="Credit Card"
    />
  );
}
