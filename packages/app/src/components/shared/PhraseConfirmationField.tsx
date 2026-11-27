import { useId } from "react";
import {
  MiniAppField,
  MiniAppInput,
  MiniAppModalHighlight,
} from "../mini-app/MiniAppLayout";

/**
 * Whether `typed` is the confirmation `phrase`. Matched case-sensitively, so
 * a phrase is written in sentence case: what a touch keyboard types by
 * default, capitalizing only the first letter.
 */
export function isPhraseConfirmed(typed: string, phrase: string): boolean {
  return typed.trim() === phrase;
}

/**
 * The input a typed confirmation asks for: the phrase is shown set apart, and
 * the user types it out so the confirmation cannot be clicked through.
 */
export function PhraseConfirmationField({
  autoFocus = false,
  describedBy,
  disabled = false,
  onChange,
  phrase,
  purpose = "to continue",
  value,
}: {
  readonly autoFocus?: boolean;
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  /** Typed verbatim by the user; in sentence case (see isPhraseConfirmed). */
  readonly phrase: string;
  /** Completes the label "Type <phrase> …". */
  readonly purpose?: string;
  readonly value: string;
}) {
  const inputId = useId();
  return (
    <MiniAppField htmlFor={inputId}>
      <span>
        Type <MiniAppModalHighlight>{phrase}</MiniAppModalHighlight> {purpose}
      </span>
      <MiniAppInput
        aria-describedby={describedBy}
        autoCapitalize="sentences"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </MiniAppField>
  );
}
