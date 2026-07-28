import { type FormEvent, useState } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../components/mini-app/MiniAppLayout";
import {
  createSeedPhraseFileName,
  downloadSeedPhraseFile,
  parseSeedPhraseFileText,
} from "../../identity/seedPhraseBackup";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useFileSaver } from "../../providers/file-saver/FileSaverProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../../providers/logging/LogProvider";

type RecoveryKeyBusyState = "restore" | null;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Operation failed.";
}

function RecoveryKeyDisplay({
  onDownload,
  seedPhrase,
}: {
  readonly onDownload: () => void;
  readonly seedPhrase: string | null;
}) {
  if (!seedPhrase) {
    return <MiniAppStatus>No recovery key is available.</MiniAppStatus>;
  }

  return (
    <div className="identity-manager-recovery-key-form">
      <MiniAppField>
        <span>Passphrase</span>
        <MiniAppTextarea
          className="identity-manager-recovery-key-textarea"
          readOnly
          rows={3}
          spellCheck={false}
          value={seedPhrase}
        />
      </MiniAppField>
      <MiniAppToolbar wrap>
        <MiniAppClipboardButton label="Copy recovery key" value={seedPhrase} />
        <MiniAppButton onClick={onDownload}>
          Download Recovery Key
        </MiniAppButton>
      </MiniAppToolbar>
    </div>
  );
}

function RecoveryKeyRestoreForm({
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
      <MiniAppToolbar>
        <MiniAppButton disabled={busy !== null || !canRestore} type="submit">
          {busy === "restore" ? "Restoring..." : "Restore from Passphrase"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}

export function IdentityManagerRecoveryKeySection() {
  const { seedPhrase, signingFingerprint, restoreSeedPhrase } = useIdentity();
  const { login } = useCryptoSession();
  const fileSaver = useFileSaver();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [busy, setBusy] = useState<RecoveryKeyBusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const canRestore = !localKeyringLock.isLocked;

  const downloadRecoveryKey = async () => {
    setError(null);
    setStatus(null);
    try {
      if (!seedPhrase) {
        throw new Error("No recovery key is available for this identity.");
      }

      await downloadSeedPhraseFile(fileSaver, {
        fileName: createSeedPhraseFileName({ signingFingerprint }),
        seedPhrase,
      });
      setStatus("Recovery key downloaded.");
      log("Recovery key backup created");
    } catch (operationError: unknown) {
      logError("Failed to back up recovery key", operationError);
      setError(readErrorMessage(operationError));
    }
  };

  const restoreRecoveryKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passphrase = parseSeedPhraseFileText(restorePassphrase).replace(
      /\s+/g,
      " ",
    );
    if (!passphrase) {
      setError("Enter the recovery key passphrase.");
      setStatus(null);
      return;
    }
    if (!canRestore) {
      setError("Unlock the local keychain to restore a recovery key.");
      setStatus(null);
      return;
    }

    setBusy("restore");
    setError(null);
    setStatus(null);
    try {
      await restoreSeedPhrase(passphrase);
      await login();
      setRestorePassphrase("");
      setStatus("Recovery key restored.");
      log("Recovery key restored");
    } catch (operationError: unknown) {
      logError("Failed to restore recovery key", operationError);
      setError(readErrorMessage(operationError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Recovery Key</h2>
      </MiniAppSectionHeading>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {status && <MiniAppStatus>{status}</MiniAppStatus>}
      <RecoveryKeyDisplay
        onDownload={downloadRecoveryKey}
        seedPhrase={seedPhrase}
      />
      <RecoveryKeyRestoreForm
        busy={busy}
        canRestore={canRestore}
        localKeyringLocked={localKeyringLock.isLocked}
        onRestore={restoreRecoveryKey}
        restorePassphrase={restorePassphrase}
        setRestorePassphrase={setRestorePassphrase}
      />
    </MiniAppSection>
  );
}
