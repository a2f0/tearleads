import { useRef, useState } from "react";
import {
  createSeedPhraseFileName,
  downloadSeedPhraseFile,
} from "../../../identity/seedPhraseBackup";
import { useFileSaver } from "../../../providers/file-saver/FileSaverProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";
import {
  RECOVERY_KEY_DISCLOSURES,
  type RecoveryKeyDisclosure,
} from "./RecoveryKeyDisclosureDialog";
import type { RecoveryKeyFeedback } from "./useRecoveryKeyRestore";

export function useRecoveryKeyDisclosure(feedback: RecoveryKeyFeedback) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const fileSaver = useFileSaver();
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
      } else if (acknowledged === "qr") {
        setQrRevealed(true);
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
    hide: () => {
      setRevealed(false);
      setQrRevealed(false);
      // Leaving "Recovery key revealed." up would describe a key that is no
      // longer on screen.
      if (revealed || qrRevealed) feedback.setStatus(null);
    },
    qrRevealed,
    pendingDisclosure,
    requestDisclosure: setPendingDisclosure,
    revealed,
  };
}
