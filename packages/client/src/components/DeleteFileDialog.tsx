import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface DeleteFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  onDelete: () => Promise<void>;
}

export function DeleteFileDialog({
  open,
  onOpenChange,
  fileName,
  onDelete
}: DeleteFileDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to delete file:', err);
      toast.error('Failed to delete file. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleCancel}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-file-dialog-title"
        data-testid="delete-file-dialog"
      >
        <h2 id="delete-file-dialog-title" className="font-semibold text-lg">
          Delete File
        </h2>

        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete <strong>{fileName}</strong>? This
          action cannot be undone.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="cancel-delete-file-button"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="confirm-delete-file-button"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
