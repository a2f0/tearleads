import { type FormEvent, useRef, useState } from "react";
import { parseSeedPhraseFileText } from "../../../identity/seedPhraseBackup";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";

export type RecoveryKeyBusyState = "restore" | null;

export interface RecoveryKeyFeedback {
  readonly setError: (message: string | null) => void;
  readonly setStatus: (message: string | null) => void;
}

export function useRecoveryKeyRestore(feedback: RecoveryKeyFeedback) {
  const { restoreSeedPhrase, identityTransitionInFlight, signingFingerprint } =
    useIdentity();
  const { login } = useCryptoSession();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [busy, setBusy] = useState<RecoveryKeyBusyState>(null);
  const [inputIdentity, setInputIdentity] = useState(signingFingerprint);
  const canRestore = !localKeyringLock.isLocked && !identityTransitionInFlight;
  const restoringRef = useRef(false);
  if (
    inputIdentity !== signingFingerprint ||
    (localKeyringLock.isLocked && restorePassphrase !== "")
  ) {
    setInputIdentity(signingFingerprint);
    setRestorePassphrase("");
  }

  const restoreRecoveryKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (restoringRef.current || identityTransitionInFlight) return;

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

    restoringRef.current = true;
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
      feedback.setError(unknownErrorMessage(operationError));
    } finally {
      restoringRef.current = false;
      setBusy(null);
    }
  };

  return {
    busy,
    canRestore,
    identityTransitionInFlight,
    restorePassphrase,
    restoreRecoveryKey,
    setRestorePassphrase,
  };
}
