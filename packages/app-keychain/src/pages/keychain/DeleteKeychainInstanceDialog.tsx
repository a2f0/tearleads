import { ConfirmDialog } from '@tearleads/ui';

interface DeleteKeychainInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  onDelete: () => Promise<void>;
}

export function DeleteKeychainInstanceDialog({
  open,
  onOpenChange,
  instanceName,
  onDelete
}: DeleteKeychainInstanceDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Instance"
      description={
        <p>
          Are you sure you want to delete <strong>{instanceName}</strong>? This
          will permanently remove all keys for this instance.
        </p>
      }
      confirmLabel="Delete"
      confirmingLabel="Deleting..."
      onConfirm={onDelete}
    />
  );
}
