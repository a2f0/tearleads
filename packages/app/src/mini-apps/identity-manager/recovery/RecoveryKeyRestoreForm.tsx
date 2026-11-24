import type { FormEvent } from "react";
import { RecoveryKeyScan } from "../../../components/identity/recovery-key/RecoveryKeyScan";
import { SavedPassphraseButton } from "../../../components/identity/SavedPassphraseButton";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import type { RecoveryKeyBusyState } from "../actions/useRecoveryKeyRestore";

export function RecoveryKeyRestoreForm({
  busy,
  canRestore,
  identityTransitionInFlight,
  localKeyringLocked,
  onRestore,
  restorePassphrase,
  setRestorePassphrase,
}: {
  readonly busy: RecoveryKeyBusyState;
  readonly canRestore: boolean;
  readonly identityTransitionInFlight: boolean;
  readonly localKeyringLocked: boolean;
  readonly onRestore: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly restorePassphrase: string;
  readonly setRestorePassphrase: (passphrase: string) => void;
}) {
  return (
    <form
      className="identity-manager-recovery-key-form"
      onSubmit={(event) => {
        void onRestore(event);
      }}
    >
      <MiniAppField>
        <span>Restore passphrase</span>
        <MiniAppTextarea
          autoComplete="off"
          className="identity-manager-recovery-key-textarea"
          disabled={busy !== null || !canRestore}
          rows={3}
          spellCheck={false}
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.currentTarget.value)}
        />
      </MiniAppField>
      {localKeyringLocked && (
        <MiniAppStatus>
          Unlock the local keychain to restore a recovery key.
        </MiniAppStatus>
      )}
      {identityTransitionInFlight && (
        <MiniAppStatus>
          Wait for the current identity change to finish.
        </MiniAppStatus>
      )}
      <RecoveryKeyScan
        disabled={busy !== null || !canRestore}
        label="Scan QR Code"
        onScan={setRestorePassphrase}
      />
      <SavedPassphraseButton
        disabled={busy !== null || !canRestore}
        onPick={setRestorePassphrase}
      />
      {restorePassphrase && canRestore && (
        <MiniAppStatus>
          Choose Restore from Passphrase to restore this identity and log in.
        </MiniAppStatus>
      )}
      <MiniAppToolbar>
        <MiniAppButton disabled={busy !== null || !canRestore} type="submit">
          {busy === "restore" ? "Restoring..." : "Restore from Passphrase"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}
