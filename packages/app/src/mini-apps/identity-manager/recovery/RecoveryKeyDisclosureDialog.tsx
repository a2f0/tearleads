import { PhraseConfirmationDialog } from "../../../components/shared/PhraseConfirmationDialog";

/**
 * Disclosing the recovery key discloses every private key derived from it, so
 * every path that surfaces it — on screen, on the clipboard, or in a file — is
 * gated behind this typed acknowledgement.
 */
export const RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE = "i understand";

export type RecoveryKeyDisclosure = "copy" | "download" | "reveal" | "qr";

interface RecoveryKeyDisclosureCopy {
  readonly confirmLabel: string;
  readonly failureLog: string;
  readonly successLog: string;
  readonly successStatus: string;
  readonly title: string;
  readonly warning: string;
}

export const RECOVERY_KEY_DISCLOSURES: Record<
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
  qr: {
    confirmLabel: "Show QR Code",
    failureLog: "Failed to reveal recovery QR code",
    successLog: "Recovery QR code revealed",
    successStatus: "Recovery QR code revealed.",
    title: "Reveal recovery QR code",
    warning:
      "This QR code contains your recovery key. Anyone who scans it or captures your screen can decrypt your data and impersonate you. Only show it to a device you trust.",
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

export function RecoveryKeyDisclosureDialog({
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
