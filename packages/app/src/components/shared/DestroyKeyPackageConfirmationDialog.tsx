import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

export const DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE = "confirm delete";

interface DestroyKeyPackageConfirmationDialogProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DestroyKeyPackageConfirmationDialog({
  isOpen,
  onCancel,
  onConfirm,
}: DestroyKeyPackageConfirmationDialogProps) {
  return (
    <PhraseConfirmationDialog
      confirmLabel="Destroy Key Package"
      isOpen={isOpen}
      onCancel={onCancel}
      onConfirm={onConfirm}
      phrase={DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE}
      title="Destroy key package"
      warning="This is a non-recoverable operation. The local private keys and persisted key package for this pane will be permanently destroyed."
    />
  );
}
