import { Button } from '@tearleads/ui';
import { Search } from 'lucide-react';
import { useMemo } from 'react';
import type {
  WalletMediaFileOption,
  WalletMediaSide
} from '../../lib/walletData';
import { WalletMediaPickerModal } from './WalletMediaPickerModal';
import { getPickerTitle } from './walletItemFormUtils';

interface WalletItemMediaSectionProps {
  frontFileId: string;
  backFileId: string;
  mediaFiles: WalletMediaFileOption[];
  pickerSide: WalletMediaSide | null;
  onOpenPicker: (side: WalletMediaSide) => void;
  onClearMedia: (side: WalletMediaSide) => void;
  onSelectMedia: (fileId: string) => void;
  onPickerClose: () => void;
}

export function WalletItemMediaSection({
  frontFileId,
  backFileId,
  mediaFiles,
  pickerSide,
  onOpenPicker,
  onClearMedia,
  onSelectMedia,
  onPickerClose
}: WalletItemMediaSectionProps) {
  const frontMedia = useMemo(
    () => mediaFiles.find((file) => file.id === frontFileId) ?? null,
    [mediaFiles, frontFileId]
  );
  const backMedia = useMemo(
    () => mediaFiles.find((file) => file.id === backFileId) ?? null,
    [mediaFiles, backFileId]
  );

  return (
    <>
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Card Images</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Search and attach front/back images visually from thumbnails.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="font-medium text-sm">Front Image</p>
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {frontMedia ? frontMedia.name : 'No image linked'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenPicker('front')}
              >
                <Search className="mr-1 h-3 w-3" />
                Browse Images
              </Button>
              {frontFileId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onClearMedia('front')}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="font-medium text-sm">Back Image</p>
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {backMedia ? backMedia.name : 'No image linked'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenPicker('back')}
              >
                <Search className="mr-1 h-3 w-3" />
                Browse Images
              </Button>
              {backFileId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onClearMedia('back')}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <WalletMediaPickerModal
        open={pickerSide !== null}
        title={getPickerTitle(pickerSide)}
        files={mediaFiles}
        selectedFileId={
          pickerSide === 'front'
            ? frontFileId
            : pickerSide === 'back'
              ? backFileId
              : ''
        }
        onOpenChange={(open) => {
          if (!open) {
            onPickerClose();
          }
        }}
        onSelectFile={onSelectMedia}
      />
    </>
  );
}
