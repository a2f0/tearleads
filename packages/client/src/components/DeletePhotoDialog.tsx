import { useState } from 'react';

interface DeletePhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoName: string;
  onDelete: () => Promise<void>;
}

export function DeletePhotoDialog({
  open,
  onOpenChange,
  photoName,
  onDelete
}: DeletePhotoDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to delete photo:', err);
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
        aria-labelledby="delete-photo-dialog-title"
        data-testid="delete-photo-dialog"
      >
        <h2 id="delete-photo-dialog-title" className="font-semibold text-lg">
          Delete Photo
        </h2>

        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete <strong>{photoName}</strong>? This
          action cannot be undone.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border px-4 py-2 font-medium text-sm hover:bg-accent"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="cancel-delete-photo-button"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-destructive px-4 py-2 font-medium text-destructive-foreground text-sm hover:bg-destructive/90 disabled:opacity-50"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="confirm-delete-photo-button"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
