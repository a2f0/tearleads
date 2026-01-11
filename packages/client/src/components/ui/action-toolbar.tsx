import { Download, Loader2, Share2, Trash2 } from 'lucide-react';
import { Button } from './button';

export type ActionType = 'download' | 'share' | 'delete';

interface ActionToolbarProps {
  onDownload?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  loadingAction?: ActionType | null;
  canShare?: boolean;
  disabled?: boolean;
}

export function ActionToolbar({
  onDownload,
  onShare,
  onDelete,
  loadingAction = null,
  canShare = true,
  disabled = false
}: ActionToolbarProps) {
  const isDisabled = disabled || loadingAction !== null;

  return (
    <div className="flex gap-1">
      {onDownload && (
        <Button
          variant="outline"
          size="icon"
          onClick={onDownload}
          disabled={isDisabled}
          aria-label="Download"
          title="Download"
          data-testid="download-button"
        >
          {loadingAction === 'download' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
        </Button>
      )}
      {onShare && canShare && (
        <Button
          variant="outline"
          size="icon"
          onClick={onShare}
          disabled={isDisabled}
          aria-label="Share"
          title="Share"
          data-testid="share-button"
        >
          {loadingAction === 'share' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Share2 />
          )}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="outline"
          size="icon"
          onClick={onDelete}
          disabled={isDisabled}
          aria-label="Delete"
          title="Delete"
          data-testid="delete-button"
        >
          {loadingAction === 'delete' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Trash2 />
          )}
        </Button>
      )}
    </div>
  );
}
