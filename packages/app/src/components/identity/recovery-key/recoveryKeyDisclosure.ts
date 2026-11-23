/**
 * Disclosing the recovery key discloses every private key derived from it, so
 * every path that surfaces it — on screen, on the clipboard, in a file, on
 * paper, or in a password manager — is gated behind this typed acknowledgement.
 */
export const RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE = "i understand";

export type RecoveryKeyDisclosure =
  | "copy"
  | "download"
  | "keychain"
  | "print"
  | "reveal"
  | "qr";

interface RecoveryKeyDisclosureCopy {
  readonly confirmLabel: string;
  readonly failureLog: string;
  /** What the log records; without one, it records the status shown. */
  readonly successLog?: string;
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
  keychain: {
    confirmLabel: "Continue to Password Manager",
    failureLog: "Failed to offer the recovery key to the password manager",
    // The status, which the log also records, is what the password manager
    // reports instead; see useRecoveryKeyExport.
    successStatus: "Offered to save the recovery key to your password manager.",
    title: "Save recovery key to password manager",
    warning:
      "Your recovery key derives the private encryption keys for this identity. Your password manager keeps it, may sync it to your other devices and the account it is signed in to, and may offer it to fill other password fields in this app or offer to replace it with what you type there. Anyone who can open your saved passwords can decrypt your data and impersonate you.",
  },
  print: {
    confirmLabel: "Print",
    failureLog: "Failed to print recovery key",
    successLog: "Recovery key sent to print",
    successStatus: "Recovery key sent to print.",
    title: "Print recovery key",
    warning:
      "Your recovery key derives the private encryption keys for this identity. Anyone who reads the printed page can decrypt your data and impersonate you, so collect it from the printer right away and store it somewhere safe.",
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
