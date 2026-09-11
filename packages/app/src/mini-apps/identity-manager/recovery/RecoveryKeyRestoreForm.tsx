import type { FormEvent } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { RecoveryKeyScanControl } from "./RecoveryKeyScanControl";
import type { RecoveryKeyBusyState } from "./useRecoveryKeyRestore";

export function RecoveryKeyRestoreForm({
  busy,
  canRestore,
  localKeyringLocked,
  onRestore,
  restorePassphrase,
  setRestorePassphrase,
}: {
  readonly busy: RecoveryKeyBusyState;
  readonly canRestore: boolean;
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
      <RecoveryKeyScanControl
        disabled={busy !== null || !canRestore}
        onScan={setRestorePassphrase}
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
