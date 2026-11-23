import { useLayoutEffect, useRef, useState } from "react";
import type { PasswordKeychain } from "../../../host/PasswordKeychain";
import {
  identityKeychainEntry,
  KEYCHAIN_SAVE_STATUS,
  usePasswordKeychain,
} from "../../../identity/identityKeychain";
import {
  discardRecoveryKeyPrint,
  printRecoveryKey,
} from "../../../identity/recoveryKeyPrint";
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

/** Where a recovery-key action reports its outcome: one status, one error. */
export interface RecoveryKeyFeedback {
  readonly setError: (message: string | null) => void;
  readonly setStatus: (message: string | null) => void;
}

async function copyRecoveryKey(recoveryKey: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("The clipboard is unavailable on this device.");
  }

  await navigator.clipboard.writeText(recoveryKey);
}

/** Offers the key to the password manager; returns the status to show. */
async function saveRecoveryKeyToKeychain(
  keychain: PasswordKeychain | null,
  signingFingerprint: string | null,
  recoveryKey: string,
) {
  if (!keychain) {
    throw new Error("This device has no password manager to save to.");
  }
  // The entry is named after the identity, so there must be one.
  if (!signingFingerprint) {
    throw new Error("No identity is loaded to save a recovery key for.");
  }
  const outcome = await keychain.save(
    identityKeychainEntry(signingFingerprint, recoveryKey),
  );
  return KEYCHAIN_SAVE_STATUS[outcome];
}

/**
 * Sends the key off the screen: to the clipboard, a file, the printer, or the
 * password manager. The export resolves to the status to show, which a
 * password manager sets from what it reports.
 */
function useRecoveryKeyExport() {
  const fileSaver = useFileSaver();
  const keychain = usePasswordKeychain();
  return async (
    kind: Exclude<RecoveryKeyDisclosure, "reveal" | "qr">,
    seedPhrase: string,
    signingFingerprint: string | null,
  ): Promise<string> => {
    switch (kind) {
      case "copy":
        await copyRecoveryKey(seedPhrase);
        break;
      case "download":
        await downloadSeedPhraseFile(fileSaver, {
          fileName: createSeedPhraseFileName({ signingFingerprint }),
          seedPhrase,
        });
        break;
      case "keychain":
        return saveRecoveryKeyToKeychain(
          keychain,
          signingFingerprint,
          seedPhrase,
        );
      case "print":
        // Synchronous, so the print dialog opens inside the confirming click.
        printRecoveryKey({ seedPhrase, signingFingerprint });
        break;
      default:
        return kind satisfies never;
    }
    return RECOVERY_KEY_DISCLOSURES[kind].successStatus;
  };
}

export function useRecoveryKeyDisclosure(
  feedback: RecoveryKeyFeedback,
  active: boolean,
) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const exportRecoveryKey = useRecoveryKeyExport();
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
  // A sheet still waiting on its print dialog holds this identity's key, so it
  // goes when the identity changes or the section unmounts.
  useLayoutEffect(() => discardRecoveryKeyPrint, [signingFingerprint]);

  /** Hides the passphrase, the QR code, or (by default) both. */
  const hide = (shown: "reveal" | "qr" | "all" = "all") => {
    const hidesKey = shown !== "qr";
    const hidesQr = shown !== "reveal";
    if (shown === "all") discardRecoveryKeyPrint();
    if (hidesKey) setRevealed(false);
    if (hidesQr) setQrRevealed(false);
    // The status line reports the last disclosure, so it must not keep
    // claiming a key that is back off screen.
    if ((hidesKey && revealed) || (hidesQr && qrRevealed)) {
      feedback.setStatus(null);
    }
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

      if (acknowledged === "qr") {
        setQrRevealed(true);
      } else if (acknowledged === "reveal") {
        // Reveal has no await ahead of it, so it cannot land on a swapped
        // identity the way an export can.
        setRevealed(true);
      } else {
        successStatus = await exportRecoveryKey(
          acknowledged,
          seedPhrase,
          signingFingerprint,
        );
      }
      log(disclosureCopy.successLog ?? successStatus);
      reportIfCurrent(requestedFor, () => feedback.setStatus(successStatus));
    } catch (operationError: unknown) {
      logError(disclosureCopy.failureLog, operationError);
      reportIfCurrent(requestedFor, () =>
        feedback.setError(unknownErrorMessage(operationError)),
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
    hide,
    qrRevealed,
    pendingDisclosure,
    requestDisclosure: setPendingDisclosure,
    revealed,
  };
}

export type RecoveryKeyDisclosureState = ReturnType<
  typeof useRecoveryKeyDisclosure
>;
