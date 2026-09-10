import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

export const DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE = "confirm delete";

interface DestroyKeyPackageConfirmationDialogProps {
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DestroyKeyPackageConfirmationDialog({
  busy = false,
  error = null,
  isOpen,
  onCancel,
  onConfirm,
}: DestroyKeyPackageConfirmationDialogProps) {
  return (
    <PhraseConfirmationDialog
      busy={busy}
      error={error}
      confirmLabel={busy ? "Deleting local data..." : "Destroy Key Package"}
      isOpen={isOpen}
      onCancel={onCancel}
      onConfirm={onConfirm}
      phrase={DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE}
      title="Destroy key package"
      warning="This is a non-recoverable operation. This identity's local private keys, saved key package, database, and stored files will be permanently deleted. Other identities and data on the server will remain."
    />
  );
}
