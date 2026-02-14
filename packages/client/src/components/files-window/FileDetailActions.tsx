import { Download, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FileDetailActionsProps {
  actionLoading: 'download' | 'share' | null;
  canShare: boolean;
  onDownload: () => void;
  onShare: () => void;
}

export function FileDetailActions({
  actionLoading,
  canShare,
  onDownload,
  onShare
}: FileDetailActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onDownload}
        disabled={actionLoading !== null}
        data-testid="window-file-download"
      >
        {actionLoading === 'download' ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Download className="mr-1 h-3 w-3" />
        )}
        Download
      </Button>
      {canShare && (
        <Button
          variant="outline"
          size="sm"
          onClick={onShare}
          disabled={actionLoading !== null}
          data-testid="window-file-share"
        >
          {actionLoading === 'share' ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Share2 className="mr-1 h-3 w-3" />
          )}
          Share
        </Button>
      )}
    </div>
  );
}
