import type { FileSaver } from "@tearleads/client-sdk";
import { useLayoutEffect, useRef, useState } from "react";
import type { PasswordKeychain } from "../../../host/PasswordKeychain";
import {
  identityKeychainEntry,
  KEYCHAIN_SAVE_STATUS,
  usePasswordKeychain,
} from "../../../identity/identityKeychain";
import {
  createSeedPhraseFileName,
  downloadSeedPhraseFile,
} from "../../../identity/seedPhraseBackup";
import { useRecoveryKeyPrivacy } from "../../../identity/useRecoveryKeyPrivacy";
import { useFileSaver } from "../../../providers/file-saver/FileSaverProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";
import {
  RECOVERY_KEY_DISCLOSURES,
  type RecoveryKeyDisclosure,
} from "./recoveryKeyDisclosure";
import type { RecoveryKeyFeedback } from "./useRecoveryKeyRestore";

async function copyRecoveryKey(recoveryKey: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("The clipboard is unavailable on this device.");
  }

  await navigator.clipboard.writeText(recoveryKey);
}

function downloadRecoveryKey(
  fileSaver: FileSaver,
  signingFingerprint: string | null,
  recoveryKey: string,
) {
  return downloadSeedPhraseFile(fileSaver, {
    fileName: createSeedPhraseFileName({ signingFingerprint }),
    seedPhrase: recoveryKey,
  });
}

/** Offers the key to the password manager; returns the status to show. */
async function saveRecoveryKeyToKeychain(
  keychain: PasswordKeychain | null,
  signingFingerprint: string | null,
  recoveryKey: string,
) {
  if (!keychain || !signingFingerprint) {
    throw new Error("This device has no password manager to save to.");
  }
  const outcome = await keychain.save(
    identityKeychainEntry(signingFingerprint, recoveryKey),
  );
  return KEYCHAIN_SAVE_STATUS[outcome];
}

export function useRecoveryKeyDisclosure(
  feedback: RecoveryKeyFeedback,
  active: boolean,
) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const fileSaver = useFileSaver();
  const keychain = usePasswordKeychain();
  const { log, logError } = useLog();
  const [pendingDisclosure, setPendingDisclosure] =
    useState<RecoveryKeyDisclosure | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [qrRevealed, setQrRevealed] = useState(false);
  const [authorizedIdentity, setAuthorizedIdentity] =
    useState(signingFingerprint);
  // Read by in-flight disclosures on completion, which need the identity as it
  // is *then* rather than the one captured in their closure.
  const currentIdentityRef = useRef(signingFingerprint);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  const hide = () => {
    setRevealed(false);
    setQrRevealed(false);
    if (revealed || qrRevealed) feedback.setStatus(null);
  };
  useRecoveryKeyPrivacy(() => {
    hide();
    setPendingDisclosure(null);
  });

  if (
    authorizedIdentity !== signingFingerprint ||
    (!seedPhrase && (revealed || qrRevealed || pendingDisclosure !== null))
  ) {
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
    setQrRevealed(false);
    // The status and error lines describe the outgoing identity's key, so they
    // must not linger and read as if they applied to the incoming one.
    if (active) {
      feedback.setError(null);
      feedback.setStatus(null);
    }
  }

  // A copy or download can still be in flight when the identity changes. It
  // exported the key captured when it was acknowledged, so it is still worth
  // logging — but the status line describes whatever identity is on screen now,
  // and must never claim a key that was never touched.
  const reportIfCurrent = (requestedFor: string | null, report: () => void) => {
    if (activeRef.current && currentIdentityRef.current === requestedFor) {
      report();
    }
  };

  const runDisclosure = async (acknowledged: RecoveryKeyDisclosure) => {
    const disclosureCopy = RECOVERY_KEY_DISCLOSURES[acknowledged];
    let successStatus = disclosureCopy.successStatus;
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
        await downloadRecoveryKey(fileSaver, signingFingerprint, seedPhrase);
      } else if (acknowledged === "keychain") {
        // The password manager reports whether it kept the key, where it can.
        successStatus = await saveRecoveryKeyToKeychain(
          keychain,
          signingFingerprint,
          seedPhrase,
        );
      } else if (acknowledged === "qr") {
        setQrRevealed(true);
      } else {
        // Reveal has no await ahead of it, so it cannot land on a swapped
        // identity the way an export can.
        setRevealed(true);
      }
      log(disclosureCopy.successLog);
      reportIfCurrent(requestedFor, () => feedback.setStatus(successStatus));
    } catch (operationError: unknown) {
      logError(disclosureCopy.failureLog, operationError);
      reportIfCurrent(requestedFor, () =>
        feedback.setError(unknownErrorMessage(operationError)),
      );
    }
  };

  return {
    canSaveToKeychain: keychain !== null,
    cancelDisclosure: () => setPendingDisclosure(null),
    confirmDisclosure: () => {
      const acknowledged = pendingDisclosure;
      setPendingDisclosure(null);
      if (acknowledged) {
        void runDisclosure(acknowledged);
      }
    },
    hide,
    qrRevealed,
    pendingDisclosure,
    requestDisclosure: setPendingDisclosure,
    revealed,
  };
}
