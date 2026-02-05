import { useCallback, useState } from 'react';
import type { EmailFolder } from '../../types/folder.js';

interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: EmailFolder | null;
  onDelete: (folderId: string) => Promise<void>;
  onFolderDeleted: (folderId: string) => void;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folder,
  onDelete,
  onFolderDeleted
}: DeleteFolderDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!folder) return;

    setIsDeleting(true);
    setError(null);

    try {
      await onDelete(folder.id);
      onFolderDeleted(folder.id);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to delete folder:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
    } finally {
      setIsDeleting(false);
    }
  }, [folder, onDelete, onFolderDeleted, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [onOpenChange]
  );

  if (!open || !folder) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="delete-folder-dialog"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-full max-w-sm rounded-lg border bg-background p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-folder-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-folder-title" className="mb-2 font-semibold text-lg">
          Delete Folder
        </h2>
        <p className="mb-4 text-muted-foreground text-sm">
          Are you sure you want to delete "{folder.name}"? This action cannot be
          undone.
        </p>
        {error && <p className="mb-3 text-destructive text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md bg-destructive px-3 py-1.5 text-destructive-foreground text-sm hover:bg-destructive/90 disabled:opacity-50"
            disabled={isDeleting}
            data-testid="delete-folder-confirm"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
