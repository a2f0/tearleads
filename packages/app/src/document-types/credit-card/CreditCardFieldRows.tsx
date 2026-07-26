import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
} from "../../components/mini-app/MiniAppLayout";
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

/**
 * The trailing controls for a masked field: reveal it, or copy it.
 *
 * Copy is the more useful of the two while the value is masked — the input is a
 * password field, so selecting the text by hand means revealing it first, in
 * front of whoever is looking at the screen. It therefore copies the stored
 * value rather than the mask, and stays available whether or not the field is
 * revealed. The clipboard sits after the eye, at the row's trailing edge, where
 * every other surface in the app puts a copy button.
 */
export function CreditCardSecretActions(params: {
  disabled?: boolean | undefined;
  isRevealed: boolean;
  label: string;
  onToggle: () => void;
  value: string | null | undefined;
}) {
  return (
    <>
      <CreditCardRevealButton
        disabled={params.disabled ?? false}
        isRevealed={params.isRevealed}
        label={params.label}
        onToggle={params.onToggle}
      />
      {/* Empty stays disabled rather than hidden: the button reserves its slot
          so the eye does not shift sideways as a value is typed in. Ghost, so
          the pair reads as two glyphs on one row rather than a bare eye beside a
          framed button. */}
      <MiniAppClipboardButton
        disabled={params.disabled ?? false}
        label={`Copy ${params.label}`}
        value={params.value}
        variant="ghost"
      />
    </>
  );
}

// Each mode owns its own reveal state, so leaving edit mode re-masks the
// values rather than carrying a reveal across the switch.
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
 * A masked credit card row: the number and the CVV.
 *
 * Both hide their value behind a password input, both carry the reveal/copy
 * pair, and both keep their own reveal state. Sharing one component is what
 * keeps the two from drifting apart — a change to how a secret is masked or
 * copied should not have to be made twice.
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
        <CreditCardSecretActions
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
        inputMode="numeric"
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
