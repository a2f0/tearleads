import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../../context';

interface ShareDeleteConfirmationProps {
  targetName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ShareDeleteConfirmation({
  targetName,
  onConfirm,
  onCancel
}: ShareDeleteConfirmationProps) {
  const {
    ui: { Button }
  } = useVfsExplorerContext();
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  }, [onConfirm]);

  return (
    <div
      className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2"
      data-testid="share-delete-confirmation"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          Remove access for &ldquo;{targetName}&rdquo;?
        </div>
        <div className="text-xs text-muted-foreground">
          They will no longer be able to view this item.
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
            data-testid="confirm-delete-share"
          >
            {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
