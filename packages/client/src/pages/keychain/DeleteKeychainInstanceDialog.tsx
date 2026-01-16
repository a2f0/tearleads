import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
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
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="delete-instance-backdrop"
      />
      <div
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-keychain-instance-title"
        data-testid="delete-keychain-instance-dialog"
      >
        <h2
          id="delete-keychain-instance-title"
          className="font-semibold text-lg"
        >
          Delete Instance
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete <strong>{instanceName}</strong>? This
          will permanently remove all keys for this instance.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="cancel-delete-instance"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="confirm-delete-instance"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
