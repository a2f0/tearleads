import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { useCreateVfsFolder } from '../hooks';
import { handleDialogTabTrap } from './dialogFocusTrap';

export interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolderId?: string | null;
  onFolderCreated?: (id: string, name: string) => void;
}

export function NewFolderDialog({
  open,
  onOpenChange,
  parentFolderId,
  onFolderCreated
}: NewFolderDialogProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const [folderName, setFolderName] = useState('');
  const { createFolder, isCreating } = useCreateVfsFolder();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setFolderName('');
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Focus input after a tick to ensure it's rendered
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isCreating) {
        onOpenChange(false);
        return;
      }
      handleDialogTabTrap({
        event: e,
        containerRef: dialogRef,
        focusableSelector:
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      });
    },
    [isCreating, onOpenChange]
  );

  const handleCreate = async () => {
    if (!folderName.trim() || isCreating) return;

    try {
      const result = await createFolder(folderName, parentFolderId);
      onFolderCreated?.(result.id, result.name);
      onOpenChange(false);
    } catch (_error) {
      // Error is handled by the hook
    }
  };

  const handleCancel = () => {
    if (isCreating) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCreate();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="new-folder-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-folder-dialog-title"
        data-testid="new-folder-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="new-folder-dialog-title" className="font-semibold text-lg">
          New Folder
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              ref={inputRef}
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              disabled={isCreating}
              data-testid="new-folder-name-input"
              autoComplete="off"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
              data-testid="new-folder-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !folderName.trim()}
              data-testid="new-folder-dialog-create"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
