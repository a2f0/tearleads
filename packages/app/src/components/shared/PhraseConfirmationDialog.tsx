import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../mini-app/MiniAppLayout";
import "./PhraseConfirmationDialog.css";
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
  /** Typed verbatim by the user to unlock the action. Matched case-sensitively. */
  readonly phrase: string;
  readonly title: string;
  readonly warning: ReactNode;
}

/**
 * Modal that gates an irreversible or dangerous action behind a phrase the user
 * has to type out, so the confirmation cannot be clicked through reflexively.
 */
export function PhraseConfirmationDialog({
  busy = false,
  error,
  confirmLabel,
  isOpen,
  onCancel,
  onConfirm,
  phrase,
  title,
  warning,
}: PhraseConfirmationDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const titleId = useId();
  const warningId = useId();
  const errorId = useId();
  const confirmed = isPhraseConfirmed(confirmationText, phrase);

  useEffect(() => {
    if (!isOpen) {
      setConfirmationText("");
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

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
          <p className="phrase-confirmation-dialog-warning" id={warningId}>
            {warning}
          </p>
          <PhraseConfirmationField
            autoFocus
            describedBy={error ? `${warningId} ${errorId}` : warningId}
            disabled={busy}
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
            <MiniAppButton disabled={!confirmed || busy} type="submit">
              {confirmLabel}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
