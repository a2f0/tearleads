import { Button } from '@tearleads/ui';
import { Search } from 'lucide-react';
import type {
  WalletMediaFileOption,
  WalletMediaSide
} from '../../lib/walletData';

interface WalletMediaSideCardProps {
  side: WalletMediaSide;
  selectedFileId: string;
  media: WalletMediaFileOption | null;
  onOpenPicker: (side: WalletMediaSide) => void;
  onClearMedia: (side: WalletMediaSide) => void;
}

function getSideTitle(side: WalletMediaSide): string {
  return side === 'front' ? 'Front Image' : 'Back Image';
}

export function WalletMediaSideCard({
  side,
  selectedFileId,
  media,
  onOpenPicker,
  onClearMedia
}: WalletMediaSideCardProps) {
  return (
    <div className="rounded-lg border p-3">
      <p className="font-medium text-sm">{getSideTitle(side)}</p>
      <p className="mt-1 truncate text-muted-foreground text-xs">
        {media ? media.name : 'No image linked'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenPicker(side)}
        >
          <Search className="mr-1 h-3 w-3" />
          Browse Images
        </Button>
        {selectedFileId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onClearMedia(side)}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
