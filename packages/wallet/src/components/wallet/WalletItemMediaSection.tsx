import { useMemo } from 'react';
import type {
  WalletMediaFileOption,
  WalletMediaSide
} from '../../lib/walletData';
import { WalletMediaPickerModal } from './WalletMediaPickerModal';
import { WalletMediaSideCard } from './WalletMediaSideCard';
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
          <WalletMediaSideCard
            side="front"
            selectedFileId={frontFileId}
            media={frontMedia}
            onOpenPicker={onOpenPicker}
            onClearMedia={onClearMedia}
          />
          <WalletMediaSideCard
            side="back"
            selectedFileId={backFileId}
            media={backMedia}
            onOpenPicker={onOpenPicker}
            onClearMedia={onClearMedia}
          />
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
