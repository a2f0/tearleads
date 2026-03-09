import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailFolder } from '../../types/folder.js';

interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: EmailFolder | null;
  onRename: (folderId: string, newName: string) => Promise<void>;
  onFolderRenamed: () => void;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folder,
  onRename,
  onFolderRenamed
}: RenameFolderDialogProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setError(null);
      // Focus and select input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, folder]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName || !folder) return;
      if (trimmedName === folder.name) {
        onOpenChange(false);
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        await onRename(folder.id, trimmedName);
        onFolderRenamed();
        onOpenChange(false);
      } catch (err) {
        console.error('Failed to rename folder:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to rename folder'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [name, folder, onRename, onFolderRenamed, onOpenChange]
  );

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
      data-testid="rename-folder-dialog"
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
        aria-labelledby="rename-folder-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="rename-folder-title" className="mb-4 font-semibold text-lg">
          Rename Folder
        </h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isSubmitting}
            data-testid="rename-folder-input"
          />
          {error && <p className="mb-3 text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              disabled={
                isSubmitting || !name.trim() || name.trim() === folder.name
              }
              data-testid="rename-folder-submit"
            >
              {isSubmitting ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
