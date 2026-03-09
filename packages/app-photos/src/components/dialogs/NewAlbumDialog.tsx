import { useEffect, useRef, useState } from 'react';
import { usePhotosUIContext } from '../../context';

export interface NewAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAlbumCreated?: (id: string, name: string) => void;
}

export function NewAlbumDialog({
  open,
  onOpenChange,
  onAlbumCreated
}: NewAlbumDialogProps) {
  const { ui, createAlbum, logError } = usePhotosUIContext();
  const {
    Button,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
  } = ui;

  const [albumName, setAlbumName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setAlbumName('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleCreate = async () => {
    if (!albumName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const id = await createAlbum(albumName.trim());
      onAlbumCreated?.(id, albumName.trim());
      onOpenChange(false);
    } catch (error) {
      logError(
        'Failed to create album',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleCreate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-album-dialog">
        <DialogHeader>
          <DialogTitle id="new-album-dialog-title">New Album</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
