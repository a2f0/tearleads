import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { useRenameVfsFolder, type VfsFolderNode } from '../hooks';
import { handleDialogTabTrap } from './dialogFocusTrap';

interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: VfsFolderNode | null;
  onFolderRenamed?: (id: string, newName: string) => void;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folder,
  onFolderRenamed
}: RenameFolderDialogProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const [folderName, setFolderName] = useState('');
  const { renameFolder, isRenaming } = useRenameVfsFolder();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && folder) {
      setFolderName(folder.name);
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open, folder]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isRenaming) {
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
    [isRenaming, onOpenChange]
  );

  const handleRename = async () => {
    if (!folderName.trim() || isRenaming || !folder) return;

    try {
      await renameFolder(folder.id, folderName);
      onFolderRenamed?.(folder.id, folderName.trim());
      onOpenChange(false);
    } catch (_error) {
      // Error is handled by the hook
    }
  };

  const handleCancel = () => {
    if (isRenaming) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleRename();
  };

  if (!open || !folder) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="rename-folder-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-folder-dialog-title"
        data-testid="rename-folder-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="rename-folder-dialog-title" className="font-semibold text-lg">
          Rename Folder
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              ref={inputRef}
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              disabled={isRenaming}
              data-testid="rename-folder-name-input"
              autoComplete="off"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isRenaming}
              data-testid="rename-folder-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRenaming || !folderName.trim()}
              data-testid="rename-folder-dialog-save"
            >
              {isRenaming ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
