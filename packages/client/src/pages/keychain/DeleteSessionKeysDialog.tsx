import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface DeleteSessionKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  onDelete: () => Promise<void>;
}

export function DeleteSessionKeysDialog({
  open,
  onOpenChange,
  instanceName,
  onDelete
}: DeleteSessionKeysDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Session Keys"
      description={
        <>
          <p>
            Are you sure you want to delete session keys for{' '}
            <strong>{instanceName}</strong>?
          </p>
          <p className="mt-2">
            This will end your session and require re-entering your password.
          </p>
        </>
      }
      confirmLabel="Delete"
      confirmingLabel="Deleting..."
      onConfirm={onDelete}
    />
  );
}
