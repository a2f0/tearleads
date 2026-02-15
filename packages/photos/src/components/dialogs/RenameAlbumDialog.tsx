import { useEffect, useRef, useState } from 'react';
import { type PhotoAlbum, usePhotosUIContext } from '../../context';

export interface RenameAlbumDialogProps {
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
  const { ui, logError } = usePhotosUIContext();
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
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && album) {
      setAlbumName(album.name);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, album]);

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
      logError(
        'Failed to rename album',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleRename();
  };

  if (!album) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rename-album-dialog">
        <DialogHeader>
          <DialogTitle id="rename-album-dialog-title">Rename Album</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
