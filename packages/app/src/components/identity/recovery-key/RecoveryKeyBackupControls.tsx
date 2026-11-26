import type { ReactNode } from "react";
import { RecoveryKeyDisclosureDialog } from "./RecoveryKeyDisclosureDialog";
import { RecoveryKeyDisplay } from "./RecoveryKeyDisplay";
import type { RecoveryKeyDisclosureState } from "./useRecoveryKeyDisclosure";
import "./RecoveryKeyBackup.css";

/**
 * The recovery key's backup actions (view, QR code, print, download, save, copy)
 * and the typed acknowledgement each one asks for before the key leaves its
 * hidden state.
 */
export function RecoveryKeyBackupControls({
  disclosure,
  feedback,
  placeholder,
  seedPhrase,
}: {
  readonly disclosure: RecoveryKeyDisclosureState;
  /** The last action's outcome, at the head of what the menu reveals. */
  readonly feedback?: ReactNode;
  /** Stands where the passphrase and its QR code show, while neither does. */
  readonly placeholder?: ReactNode;
  readonly seedPhrase: string | null;
}) {
  return (
    <>
      <RecoveryKeyDisplay
        feedback={feedback}
        onHide={disclosure.hide}
        onRequestDisclosure={disclosure.requestDisclosure}
        placeholder={placeholder}
        qrRevealed={disclosure.qrRevealed}
        revealed={disclosure.revealed}
        seedPhrase={seedPhrase}
      />
      <RecoveryKeyDisclosureDialog
        onCancel={disclosure.cancelDisclosure}
        onConfirm={disclosure.confirmDisclosure}
        pendingDisclosure={disclosure.pendingDisclosure}
      />
    </>
  );
}
