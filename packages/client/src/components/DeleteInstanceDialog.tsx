import { useState } from 'react';
import { useDatabaseContext } from '@/db/hooks/useDatabase';

interface DeleteInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string | null;
  instanceName: string;
}

export function DeleteInstanceDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName
}: DeleteInstanceDialogProps) {
  const { deleteInstance } = useDatabaseContext();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!instanceId) return;

    setIsDeleting(true);
    try {
      await deleteInstance(instanceId);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to delete instance:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        data-testid="delete-instance-dialog"
      >
        <h2 id="delete-dialog-title" className="font-semibold text-lg">
          Delete Instance
        </h2>

        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete <strong>{instanceName}</strong>? This
          will permanently delete all data in this instance. This action cannot
          be undone.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border px-4 py-2 font-medium text-sm hover:bg-accent"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="cancel-delete-button"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-destructive px-4 py-2 font-medium text-destructive-foreground text-sm hover:bg-destructive/90 disabled:opacity-50"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="confirm-delete-button"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
