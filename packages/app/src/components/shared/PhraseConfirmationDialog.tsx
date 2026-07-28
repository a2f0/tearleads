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
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../mini-app/MiniAppLayout";
import "./PhraseConfirmationDialog.css";

interface PhraseConfirmationDialogProps {
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
  confirmLabel,
  isOpen,
  onCancel,
  onConfirm,
  phrase,
  title,
  warning,
}: PhraseConfirmationDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputId = useId();
  const titleId = useId();
  const warningId = useId();
  const confirmed = confirmationText.trim() === phrase;

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
    if (!confirmed) {
      return;
    }

    onConfirm();
  };

  return (
    <MiniAppModalBackdrop
      className="phrase-confirmation-dialog-backdrop"
      role="presentation"
    >
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
          <MiniAppField htmlFor={inputId}>
            <span>
              Type{" "}
              <span className="phrase-confirmation-dialog-phrase">
                {phrase}
              </span>{" "}
              to continue
            </span>
            <MiniAppInput
              autoComplete="off"
              autoFocus
              id={inputId}
              aria-describedby={warningId}
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton onClick={onCancel} type="button">
              Cancel
            </MiniAppButton>
            <MiniAppButton disabled={!confirmed} type="submit">
              {confirmLabel}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
