import { useState } from "react";
import { DocumentSecretActions } from "../shared/DocumentSecretActions";
import { StructuredDocumentField } from "../shared/StructuredDocument";

const CREDIT_CARD_REDACTED_NUMBER = "**** **** ****";
const CREDIT_CARD_REDACTED_CVV = "***";
export const CREDIT_CARD_NUMBER_REVEAL_LABEL = "credit card number";
export const CREDIT_CARD_CVV_REVEAL_LABEL = "credit card CVV code";

export function formatMaskedCardNumber(
  cardNumber: string | null | undefined,
): string {
  const digits = (cardNumber ?? "").replaceAll(/\D/gu, "");
  if (digits.length === 0) {
    return "None";
  }

  return `${CREDIT_CARD_REDACTED_NUMBER} ${digits.slice(-4)}`;
}

export function formatMaskedCvv(cvvCode: string | null | undefined): string {
  return hasCreditCardValue(cvvCode) ? CREDIT_CARD_REDACTED_CVV : "None";
}

export function hasCreditCardValue(value: string | null | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

// Read mode owns its reveal state, so leaving edit mode re-masks the values
// rather than carrying a reveal across the switch.
export function useCreditCardReveal() {
  const [isCardNumberRevealed, setIsCardNumberRevealed] = useState(false);
  const [isCvvCodeRevealed, setIsCvvCodeRevealed] = useState(false);

  return {
    isCardNumberRevealed,
    isCvvCodeRevealed,
    toggleCardNumber: () => setIsCardNumberRevealed((revealed) => !revealed),
    toggleCvvCode: () => setIsCvvCodeRevealed((revealed) => !revealed),
  };
}

/**
 * A sensitive credit card row: the number and the CVV.
 *
 * Both carry the reveal/copy pair. Each row's reveal state is owned by the
 * caller; this component renders that choice.
 */
export function CreditCardSecretField(params: {
  autoComplete: string;
  disabled: boolean;
  inputId: string;
  inputLabel: string;
  isRevealed: boolean;
  label: string;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
  onToggle: () => void;
  placeholder: string;
  ready: boolean;
  revealLabel: string;
  value: string;
}) {
  return (
    <StructuredDocumentField
      action={
        <DocumentSecretActions
          disabled={params.disabled}
          isRevealed={params.isRevealed}
          label={params.revealLabel}
          onToggle={params.onToggle}
          value={params.value}
        />
      }
      inputId={params.inputId}
      label={params.label}
    >
      <input
        id={params.inputId}
        aria-label={params.inputLabel}
        type={params.isRevealed ? "text" : "password"}
        value={params.value}
        onChange={(event) => params.onChange(event.target.value)}
        placeholder={params.ready ? params.placeholder : "Loading..."}
        disabled={params.disabled}
        autoComplete={params.autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        inputMode="numeric"
        spellCheck={false}
        {...(params.maxLength === undefined
          ? {}
          : { maxLength: params.maxLength })}
      />
    </StructuredDocumentField>
  );
}

/**
 * A plain, unmasked credit card text row.
 *
 * The issuer and the name on the card are the two fields with nothing to hide:
 * no reveal toggle, no masked display, just a labelled input. Sharing one
 * component keeps them from drifting apart and keeps the edit form's field list
 * readable next to the masked rows, which each carry their own controls.
 */
export function CreditCardTextField(params: {
  autoComplete?: string | undefined;
  disabled: boolean;
  inputId: string;
  inputLabel: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  ready: boolean;
  value: string;
}) {
  return (
    <StructuredDocumentField inputId={params.inputId} label={params.label}>
      <input
        id={params.inputId}
        aria-label={params.inputLabel}
        value={params.value}
        onChange={(event) => params.onChange(event.target.value)}
        placeholder={params.ready ? params.placeholder : "Loading..."}
        disabled={params.disabled}
        {...(params.autoComplete === undefined
          ? {}
          : { autoComplete: params.autoComplete })}
      />
    </StructuredDocumentField>
  );
}
