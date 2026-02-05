import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailFolder } from '../../types/folder.js';

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
  onFolderCreated: () => void;
  createFolder: (
    name: string,
    parentId?: string | null
  ) => Promise<EmailFolder>;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId,
  onFolderCreated,
  createFolder
}: CreateFolderDialogProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
      // Focus input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) return;

      setIsSubmitting(true);
      setError(null);

      try {
        await createFolder(trimmedName, parentId);
        onFolderCreated();
        onOpenChange(false);
      } catch (err) {
        console.error('Failed to create folder:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to create folder'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [name, parentId, createFolder, onFolderCreated, onOpenChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [onOpenChange]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="create-folder-dialog"
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
        aria-labelledby="create-folder-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="create-folder-title" className="mb-4 font-semibold text-lg">
          {parentId ? 'Create Subfolder' : 'Create Folder'}
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
            data-testid="create-folder-input"
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
              disabled={isSubmitting || !name.trim()}
              data-testid="create-folder-submit"
            >
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
