import { handleDialogTabTrap } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePhotoAlbums } from './usePhotoAlbums';

interface NewAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAlbumCreated?: (id: string, name: string) => void;
}

export function NewAlbumDialog({
  open,
  onOpenChange,
  onAlbumCreated
}: NewAlbumDialogProps) {
  const [albumName, setAlbumName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { createAlbum } = usePhotoAlbums();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setAlbumName('');
      previousActiveElement.current = document.activeElement as HTMLElement;
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
    if (!albumName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const id = await createAlbum(albumName.trim());
      onAlbumCreated?.(id, albumName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create album:', error);
    } finally {
      setIsCreating(false);
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
        data-testid="new-album-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-album-dialog-title"
        data-testid="new-album-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="new-album-dialog-title" className="font-semibold text-lg">
          New Album
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              ref={inputRef}
              type="text"
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              placeholder="Album name"
              disabled={isCreating}
              data-testid="new-album-name-input"
              autoComplete="off"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
              data-testid="new-album-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !albumName.trim()}
              data-testid="new-album-dialog-create"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
