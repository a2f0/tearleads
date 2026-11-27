import { type FormEvent, useCallback, useId, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppCheckbox,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
  useModalEscapeAndFocusRestore,
} from "../mini-app/MiniAppLayout";
import type { LogoutOptions } from "./useLogoutConfirmation";
import "./LogoutConfirmationDialog.css";

interface LogoutConfirmationDialogProps {
  readonly isOpen: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  /**
   * Confirm logout. `keepLocalData` is the checkbox state: when `false` the
   * session's SQLite database and OPFS blob store are destroyed.
   */
  readonly onConfirm: (input: LogoutOptions) => void;
}

function LogoutConfirmationDialogContent({
  busy,
  onCancel,
  onConfirm,
}: Omit<LogoutConfirmationDialogProps, "isOpen">) {
  // Default to keeping local data so the destructive path is always an explicit
  // opt-out, never the accidental default.
  const [keepLocalData, setKeepLocalData] = useState(true);
  const checkboxId = useId();
  const titleId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const handleEscape = useCallback(() => {
    if (!busy) {
      onCancel();
    }
  }, [busy, onCancel]);

  useModalEscapeAndFocusRestore(handleEscape, cancelButtonRef);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    onConfirm({ keepLocalData });
  };

  return (
    <MiniAppModalBackdrop layer="raised" role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>Log out</h2>
          <p>Log out of this session?</p>
          <label
            className="mini-app-checkbox-label logout-confirmation-keep-data"
            htmlFor={checkboxId}
          >
            <MiniAppCheckbox
              id={checkboxId}
              checked={keepLocalData}
              disabled={busy}
              onChange={(event) => setKeepLocalData(event.target.checked)}
            />
            <span>Keep local data on this device</span>
          </label>
          {!keepLocalData && (
            <MiniAppStatus tone="error">
              This device's local database and stored files will be permanently
              destroyed.
            </MiniAppStatus>
          )}
          <MiniAppActions>
            <MiniAppButton
              disabled={busy}
              onClick={onCancel}
              ref={cancelButtonRef}
              type="button"
            >
              Cancel
            </MiniAppButton>
            <MiniAppButton
              loading={busy}
              type="submit"
              variant={keepLocalData ? "default" : "danger"}
            >
              {busy ? "Logging out..." : "Log Out"}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

export function LogoutConfirmationDialog({
  isOpen,
  ...props
}: LogoutConfirmationDialogProps) {
  if (!isOpen) {
    return null;
  }

  return <LogoutConfirmationDialogContent {...props} />;
}
