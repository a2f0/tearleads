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
  seedPhrase,
}: {
  readonly disclosure: RecoveryKeyDisclosureState;
  readonly seedPhrase: string | null;
}) {
  return (
    <>
      <RecoveryKeyDisplay
        onHide={disclosure.hide}
        onRequestDisclosure={disclosure.requestDisclosure}
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
