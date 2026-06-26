import { type FormEvent, useEffect, useId, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "./MiniAppLayout";
import "./DestroyKeyPackageConfirmationDialog.css";

export const DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE = "confirm delete";

interface DestroyKeyPackageConfirmationDialogProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DestroyKeyPackageConfirmationDialog({
  isOpen,
  onCancel,
  onConfirm,
}: DestroyKeyPackageConfirmationDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputId = useId();
  const titleId = useId();
  const warningId = useId();
  const confirmed =
    confirmationText.trim() === DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE;

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
      className="destroy-key-package-confirmation-dialog-backdrop"
      role="presentation"
    >
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={warningId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>Destroy key package</h2>
          <p
            className="destroy-key-package-confirmation-warning"
            id={warningId}
          >
            This is a non-recoverable operation. The local private keys and
            persisted key package for this pane will be permanently destroyed.
          </p>
          <MiniAppField htmlFor={inputId}>
            <span>
              Type{" "}
              <span className="destroy-key-package-confirmation-phrase">
                {DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE}
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
              Destroy Key Package
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
