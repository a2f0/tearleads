import { handleDialogTabTrap } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PhotoAlbum } from './usePhotoAlbums';

interface RenameAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  album: PhotoAlbum | null;
  onRename: (albumId: string, newName: string) => Promise<void>;
  onAlbumRenamed?: () => void;
}

export function RenameAlbumDialog({
  open,
  onOpenChange,
  album,
  onRename,
  onAlbumRenamed
}: RenameAlbumDialogProps) {
  const [albumName, setAlbumName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && album) {
      setAlbumName(album.name);
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open, album]);

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
    if (!album || !albumName.trim() || isRenaming) return;
    if (albumName.trim() === album.name) {
      onOpenChange(false);
      return;
    }

    setIsRenaming(true);
    try {
      await onRename(album.id, albumName.trim());
      onAlbumRenamed?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to rename album:', error);
    } finally {
      setIsRenaming(false);
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

  if (!open || !album) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="rename-album-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-album-dialog-title"
        data-testid="rename-album-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="rename-album-dialog-title" className="font-semibold text-lg">
          Rename Album
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              ref={inputRef}
              type="text"
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              placeholder="Album name"
              disabled={isRenaming}
              data-testid="rename-album-name-input"
              autoComplete="off"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isRenaming}
              data-testid="rename-album-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRenaming || !albumName.trim()}
              data-testid="rename-album-dialog-save"
            >
              {isRenaming ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
