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
import { PhraseConfirmationDialog } from "../../components/shared/PhraseConfirmationDialog";
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

/**
 * Exporting the recovery key exports every private key derived from it, so both
 * export paths are gated behind this typed acknowledgement.
 */
export const RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE = "i understand";

type RecoveryKeyExport = "copy" | "download";

interface RecoveryKeyExportCopy {
  readonly confirmLabel: string;
  readonly failureLog: string;
  readonly successLog: string;
  readonly successStatus: string;
  readonly title: string;
  readonly warning: string;
}

const RECOVERY_KEY_EXPORTS: Record<RecoveryKeyExport, RecoveryKeyExportCopy> = {
  copy: {
    confirmLabel: "Copy to Clipboard",
    failureLog: "Failed to copy recovery key",
    successLog: "Recovery key copied to clipboard",
    successStatus: "Recovery key copied to clipboard.",
    title: "Copy recovery key",
    warning:
      "Your recovery key derives the private encryption keys for this identity. Anyone who reads it can decrypt your data and impersonate you, and the clipboard is readable by other apps and may sync to your other devices.",
  },
  download: {
    confirmLabel: "Download File",
    failureLog: "Failed to back up recovery key",
    successLog: "Recovery key backup created",
    successStatus: "Recovery key downloaded.",
    title: "Download recovery key",
    warning:
      "Your recovery key derives the private encryption keys for this identity. Anyone who opens the downloaded file can decrypt your data and impersonate you, so move it to encrypted storage and remove the plaintext copy.",
  },
};

interface RecoveryKeyFeedback {
  readonly setError: (message: string | null) => void;
  readonly setStatus: (message: string | null) => void;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Operation failed.";
}

function RecoveryKeyDisplay({
  onRequestExport,
  seedPhrase,
}: {
  readonly onRequestExport: (recoveryKeyExport: RecoveryKeyExport) => void;
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
        <MiniAppClipboardButton
          label="Copy recovery key"
          // Suppress the button's own click-to-copy — the copy runs once the
          // acknowledgement is typed. `value` still drives its disabled state,
          // and the copy is reported through the section's status line.
          onClick={(event) => {
            event.preventDefault();
            onRequestExport("copy");
          }}
          value={seedPhrase}
        />
        <MiniAppButton onClick={() => onRequestExport("download")}>
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

function RecoveryKeyExportDialog({
  onCancel,
  onConfirm,
  pendingExport,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pendingExport: RecoveryKeyExport | null;
}) {
  if (!pendingExport) {
    // Unmounting resets the dialog, so a cancelled attempt never leaves its
    // typed acknowledgement behind for the next export.
    return null;
  }

  const exportCopy = RECOVERY_KEY_EXPORTS[pendingExport];
  return (
    <PhraseConfirmationDialog
      confirmLabel={exportCopy.confirmLabel}
      isOpen
      onCancel={onCancel}
      onConfirm={onConfirm}
      phrase={RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE}
      title={exportCopy.title}
      warning={exportCopy.warning}
    />
  );
}

function useRecoveryKeyExport(feedback: RecoveryKeyFeedback) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const fileSaver = useFileSaver();
  const { log, logError } = useLog();
  const [pendingExport, setPendingExport] = useState<RecoveryKeyExport | null>(
    null,
  );

  const copyRecoveryKey = async (recoveryKey: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      throw new Error("The clipboard is unavailable on this device.");
    }

    await navigator.clipboard.writeText(recoveryKey);
  };

  const downloadRecoveryKey = async (recoveryKey: string) => {
    await downloadSeedPhraseFile(fileSaver, {
      fileName: createSeedPhraseFileName({ signingFingerprint }),
      seedPhrase: recoveryKey,
    });
  };

  const runExport = async (acknowledged: RecoveryKeyExport) => {
    const exportCopy = RECOVERY_KEY_EXPORTS[acknowledged];
    feedback.setError(null);
    feedback.setStatus(null);
    try {
      if (!seedPhrase) {
        throw new Error("No recovery key is available for this identity.");
      }

      await (acknowledged === "copy"
        ? copyRecoveryKey(seedPhrase)
        : downloadRecoveryKey(seedPhrase));
      feedback.setStatus(exportCopy.successStatus);
      log(exportCopy.successLog);
    } catch (operationError: unknown) {
      logError(exportCopy.failureLog, operationError);
      feedback.setError(readErrorMessage(operationError));
    }
  };

  return {
    cancelExport: () => setPendingExport(null),
    confirmExport: () => {
      const acknowledged = pendingExport;
      setPendingExport(null);
      if (acknowledged) {
        void runExport(acknowledged);
      }
    },
    pendingExport,
    requestExport: setPendingExport,
  };
}

function useRecoveryKeyRestore(feedback: RecoveryKeyFeedback) {
  const { restoreSeedPhrase } = useIdentity();
  const { login } = useCryptoSession();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [busy, setBusy] = useState<RecoveryKeyBusyState>(null);
  const canRestore = !localKeyringLock.isLocked;

  const restoreRecoveryKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passphrase = parseSeedPhraseFileText(restorePassphrase).replace(
      /\s+/g,
      " ",
    );
    if (!passphrase) {
      feedback.setError("Enter the recovery key passphrase.");
      feedback.setStatus(null);
      return;
    }
    if (!canRestore) {
      feedback.setError("Unlock the local keychain to restore a recovery key.");
      feedback.setStatus(null);
      return;
    }

    setBusy("restore");
    feedback.setError(null);
    feedback.setStatus(null);
    try {
      await restoreSeedPhrase(passphrase);
      await login();
      setRestorePassphrase("");
      feedback.setStatus("Recovery key restored.");
      log("Recovery key restored");
    } catch (operationError: unknown) {
      logError("Failed to restore recovery key", operationError);
      feedback.setError(readErrorMessage(operationError));
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    canRestore,
    restorePassphrase,
    restoreRecoveryKey,
    setRestorePassphrase,
  };
}

export function IdentityManagerRecoveryKeySection() {
  const { seedPhrase } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const feedback: RecoveryKeyFeedback = { setError, setStatus };
  const recoveryKeyExport = useRecoveryKeyExport(feedback);
  const restore = useRecoveryKeyRestore(feedback);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Recovery Key</h2>
      </MiniAppSectionHeading>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {status && <MiniAppStatus>{status}</MiniAppStatus>}
      <RecoveryKeyDisplay
        onRequestExport={recoveryKeyExport.requestExport}
        seedPhrase={seedPhrase}
      />
      <RecoveryKeyRestoreForm
        busy={restore.busy}
        canRestore={restore.canRestore}
        localKeyringLocked={localKeyringLock.isLocked}
        onRestore={restore.restoreRecoveryKey}
        restorePassphrase={restore.restorePassphrase}
        setRestorePassphrase={restore.setRestorePassphrase}
      />
      <RecoveryKeyExportDialog
        onCancel={recoveryKeyExport.cancelExport}
        onConfirm={recoveryKeyExport.confirmExport}
        pendingExport={recoveryKeyExport.pendingExport}
      />
    </MiniAppSection>
  );
}
