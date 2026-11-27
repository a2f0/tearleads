import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
  useModalEscapeAndFocusRestore,
} from "../mini-app/MiniAppLayout";
import {
  isPhraseConfirmed,
  PhraseConfirmationField,
} from "./PhraseConfirmationField";

interface PhraseConfirmationDialogProps {
  readonly busy?: boolean;
  readonly error?: string | null;
  /** Label of the submit button, enabled only once `phrase` is typed. */
  readonly confirmLabel: string;
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /**
   * Typed verbatim by the user to unlock the action. Matched case-sensitively,
   * so written in sentence case (see isPhraseConfirmed).
   */
  readonly phrase: string;
  readonly title: string;
  readonly warning: ReactNode;
}

function PhraseConfirmationDialogContent({
  busy = false,
  error,
  confirmLabel,
  onCancel,
  onConfirm,
  phrase,
  title,
  warning,
}: Omit<PhraseConfirmationDialogProps, "isOpen">) {
  const [confirmationText, setConfirmationText] = useState("");
  const titleId = useId();
  const warningId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = isPhraseConfirmed(confirmationText, phrase);
  const handleEscape = useCallback(() => {
    if (!busy) {
      onCancel();
    }
  }, [busy, onCancel]);

  useModalEscapeAndFocusRestore(handleEscape, inputRef);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || busy) {
      return;
    }

    onConfirm();
  };

  return (
    <MiniAppModalBackdrop layer="raised" role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={warningId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>{title}</h2>
          <MiniAppStatus id={warningId} tone="error">
            {warning}
          </MiniAppStatus>
          <PhraseConfirmationField
            describedBy={error ? `${warningId} ${errorId}` : warningId}
            disabled={busy}
            inputRef={inputRef}
            onChange={setConfirmationText}
            phrase={phrase}
            value={confirmationText}
          />
          {error && (
            <MiniAppStatus id={errorId} role="alert" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              Cancel
            </MiniAppButton>
            <MiniAppButton
              disabled={!confirmed}
              loading={busy}
              type="submit"
              variant="danger"
            >
              {confirmLabel}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

/**
 * Modal that gates an irreversible or dangerous action behind a phrase the user
 * has to type out, so the confirmation cannot be clicked through reflexively.
 */
export function PhraseConfirmationDialog({
  isOpen,
  ...props
}: PhraseConfirmationDialogProps) {
  if (!isOpen) {
    return null;
  }

  return <PhraseConfirmationDialogContent {...props} />;
}
