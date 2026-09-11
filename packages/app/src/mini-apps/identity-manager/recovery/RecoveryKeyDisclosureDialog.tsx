import { PhraseConfirmationDialog } from "../../../components/shared/PhraseConfirmationDialog";

import {
  RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE,
  RECOVERY_KEY_DISCLOSURES,
  type RecoveryKeyDisclosure,
} from "../actions/recoveryKeyDisclosure";

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
