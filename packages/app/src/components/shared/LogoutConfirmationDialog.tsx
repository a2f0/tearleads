import { type FormEvent, useId, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "./MiniAppLayout";
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

export function LogoutConfirmationDialog({
  busy,
  isOpen,
  onCancel,
  onConfirm,
}: LogoutConfirmationDialogProps) {
  // Default to keeping local data so the destructive path is always an explicit
  // opt-out, never the accidental default.
  const [keepLocalData, setKeepLocalData] = useState(true);
  const checkboxId = useId();
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    onConfirm({ keepLocalData });
  };

  return (
    <MiniAppModalBackdrop
      className="logout-confirmation-dialog-backdrop"
      role="presentation"
    >
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>Log out</h2>
          <p>Log out of this session?</p>
          <label className="logout-confirmation-keep-data" htmlFor={checkboxId}>
            <input
              id={checkboxId}
              checked={keepLocalData}
              className="logout-confirmation-checkbox"
              disabled={busy}
              type="checkbox"
              onChange={(event) => setKeepLocalData(event.target.checked)}
            />
            <span>Keep local data on this device</span>
          </label>
          {!keepLocalData && (
            <p className="logout-confirmation-warning">
              This device's local database and stored files will be permanently
              destroyed.
            </p>
          )}
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              Cancel
            </MiniAppButton>
            <MiniAppButton disabled={busy} type="submit">
              {busy ? "Logging out..." : "Log Out"}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
