import { type FormEvent, useId, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { PhraseConfirmationDialog } from "../../../components/shared/PhraseConfirmationDialog";
import {
  createSeedPhraseFileName,
  downloadSeedPhraseFile,
  parseSeedPhraseFileText,
} from "../../../identity/seedPhraseBackup";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useFileSaver } from "../../../providers/file-saver/FileSaverProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../../../providers/logging/LogProvider";

type RecoveryKeyBusyState = "restore" | null;
type RecoveryKeyTabId = "backup" | "recovery";

const RECOVERY_KEY_TABS: ReadonlyArray<MiniAppTabDescriptor<RecoveryKeyTabId>> =
  [
    { id: "backup", label: "Backup" },
    { id: "recovery", label: "Recovery" },
  ];

/**
 * Disclosing the recovery key discloses every private key derived from it, so
 * every path that surfaces it — on screen, on the clipboard, or in a file — is
 * gated behind this typed acknowledgement.
 */
export const RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE = "i understand";

type RecoveryKeyDisclosure = "copy" | "download" | "reveal";

interface RecoveryKeyDisclosureCopy {
  readonly confirmLabel: string;
  readonly failureLog: string;
  readonly successLog: string;
  readonly successStatus: string;
  readonly title: string;
  readonly warning: string;
}

const RECOVERY_KEY_DISCLOSURES: Record<
  RecoveryKeyDisclosure,
  RecoveryKeyDisclosureCopy
> = {
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
  reveal: {
    confirmLabel: "Show Passphrase",
    failureLog: "Failed to reveal recovery key",
    successLog: "Recovery key revealed",
    successStatus: "Recovery key revealed.",
    title: "Reveal recovery key",
    warning:
      "Your recovery key derives the private encryption keys for this identity. Anyone who can see your screen — including a screen share or recording — can copy it and impersonate you.",
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
  onHide,
  onRequestDisclosure,
  revealed,
  seedPhrase,
}: {
  readonly onHide: () => void;
  readonly onRequestDisclosure: (disclosure: RecoveryKeyDisclosure) => void;
  readonly revealed: boolean;
  readonly seedPhrase: string | null;
}) {
  if (!seedPhrase) {
    return <MiniAppStatus>No recovery key is available.</MiniAppStatus>;
  }

  return (
    <div className="identity-manager-recovery-key-form">
      {revealed ? (
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
      ) : (
        <MiniAppStatus>
          The passphrase is hidden. Reveal it to read it on screen.
        </MiniAppStatus>
      )}
      <MiniAppToolbar wrap>
        <MiniAppClipboardButton
          label="Copy recovery key"
          // Suppress the button's own click-to-copy — the copy runs once the
          // acknowledgement is typed. `value` still drives its disabled state,
          // and the copy is reported through the section's status line.
          onClick={(event) => {
            event.preventDefault();
            onRequestDisclosure("copy");
          }}
          value={seedPhrase}
        />
        <MiniAppButton onClick={() => onRequestDisclosure("download")}>
          Download Recovery Key
        </MiniAppButton>
        {revealed ? (
          <MiniAppButton onClick={onHide}>Hide Recovery Key</MiniAppButton>
        ) : (
          <MiniAppButton onClick={() => onRequestDisclosure("reveal")}>
            Reveal Recovery Key
          </MiniAppButton>
        )}
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

function RecoveryKeyDisclosureDialog({
  onCancel,
  onConfirm,
  pendingDisclosure,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pendingDisclosure: RecoveryKeyDisclosure | null;
}) {
  if (!pendingDisclosure) {
    // Unmounting resets the dialog, so a cancelled attempt never leaves its
    // typed acknowledgement behind for the next disclosure.
    return null;
  }

  const disclosureCopy = RECOVERY_KEY_DISCLOSURES[pendingDisclosure];
  return (
    <PhraseConfirmationDialog
      // The dialog does not trap focus, so the toolbar behind it can still
      // switch which disclosure is pending. Keying by kind remounts the dialog
      // on that switch, so an acknowledgement typed for one disclosure can
      // never be spent on another.
      key={pendingDisclosure}
      confirmLabel={disclosureCopy.confirmLabel}
      isOpen
      onCancel={onCancel}
      onConfirm={onConfirm}
      phrase={RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE}
      title={disclosureCopy.title}
      warning={disclosureCopy.warning}
    />
  );
}

function useRecoveryKeyDisclosure(feedback: RecoveryKeyFeedback) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const fileSaver = useFileSaver();
  const { log, logError } = useLog();
  const [pendingDisclosure, setPendingDisclosure] =
    useState<RecoveryKeyDisclosure | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [authorizedIdentity, setAuthorizedIdentity] =
    useState(signingFingerprint);
  // Read by in-flight disclosures on completion, which need the identity as it
  // is *then* rather than the one captured in their closure.
  const currentIdentityRef = useRef(signingFingerprint);

  if (authorizedIdentity !== signingFingerprint) {
    // Switching identities swaps the key underneath a mounted section, so every
    // acknowledgement it earned is spent. Discarding during render rather than
    // in an effect revokes it in the same commit, before the incoming phrase
    // could reach the screen; discarding on *any* change — rather than
    // comparing against the identity that was authorized — is what stops an
    // A → B → A round trip from silently re-granting A's reveal.
    setAuthorizedIdentity(signingFingerprint);
    currentIdentityRef.current = signingFingerprint;
    setPendingDisclosure(null);
    setRevealed(false);
    // The status and error lines describe the outgoing identity's key, so they
    // must not linger and read as if they applied to the incoming one.
    feedback.setError(null);
    feedback.setStatus(null);
  }

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

  // A copy or download can still be in flight when the identity changes. It
  // exported the key captured when it was acknowledged, so it is still worth
  // logging — but the status line describes whatever identity is on screen now,
  // and must never claim a key that was never touched.
  const reportIfCurrent = (requestedFor: string | null, report: () => void) => {
    if (currentIdentityRef.current === requestedFor) {
      report();
    }
  };

  const runDisclosure = async (acknowledged: RecoveryKeyDisclosure) => {
    const disclosureCopy = RECOVERY_KEY_DISCLOSURES[acknowledged];
    const requestedFor = signingFingerprint;
    feedback.setError(null);
    feedback.setStatus(null);
    try {
      if (!seedPhrase) {
        throw new Error("No recovery key is available for this identity.");
      }

      if (acknowledged === "copy") {
        await copyRecoveryKey(seedPhrase);
      } else if (acknowledged === "download") {
        await downloadRecoveryKey(seedPhrase);
      } else {
        // Reveal has no await ahead of it, so it cannot land on a swapped
        // identity the way an export can.
        setRevealed(true);
      }
      log(disclosureCopy.successLog);
      reportIfCurrent(requestedFor, () =>
        feedback.setStatus(disclosureCopy.successStatus),
      );
    } catch (operationError: unknown) {
      logError(disclosureCopy.failureLog, operationError);
      reportIfCurrent(requestedFor, () =>
        feedback.setError(readErrorMessage(operationError)),
      );
    }
  };

  return {
    cancelDisclosure: () => setPendingDisclosure(null),
    confirmDisclosure: () => {
      const acknowledged = pendingDisclosure;
      setPendingDisclosure(null);
      if (acknowledged) {
        void runDisclosure(acknowledged);
      }
    },
    hide: () => {
      setRevealed(false);
      // Leaving "Recovery key revealed." up would describe a key that is no
      // longer on screen.
      feedback.setStatus(null);
    },
    pendingDisclosure,
    requestDisclosure: setPendingDisclosure,
    revealed,
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
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<RecoveryKeyTabId>("backup");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const feedback: RecoveryKeyFeedback = { setError, setStatus };
  const disclosure = useRecoveryKeyDisclosure(feedback);
  const restore = useRecoveryKeyRestore(feedback);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Recovery Key</h2>
      </MiniAppSectionHeading>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {status && <MiniAppStatus>{status}</MiniAppStatus>}
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label="Recovery key sections"
        onSelect={setActiveTab}
        tabs={RECOVERY_KEY_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {activeTab === "backup" ? (
          <>
            <RecoveryKeyDisplay
              onHide={disclosure.hide}
              onRequestDisclosure={disclosure.requestDisclosure}
              revealed={disclosure.revealed}
              seedPhrase={seedPhrase}
            />
            <RecoveryKeyDisclosureDialog
              onCancel={disclosure.cancelDisclosure}
              onConfirm={disclosure.confirmDisclosure}
              pendingDisclosure={disclosure.pendingDisclosure}
            />
          </>
        ) : (
          <RecoveryKeyRestoreForm
            busy={restore.busy}
            canRestore={restore.canRestore}
            localKeyringLocked={localKeyringLock.isLocked}
            onRestore={restore.restoreRecoveryKey}
            restorePassphrase={restore.restorePassphrase}
            setRestorePassphrase={restore.setRestorePassphrase}
          />
        )}
      </MiniAppTabPanel>
    </MiniAppSection>
  );
}
