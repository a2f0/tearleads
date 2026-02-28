import { Loader2 } from 'lucide-react';
import type { WalletMediaPreview } from './useWalletMediaPreviews';
import { WalletMediaPickerGridItem } from './WalletMediaPickerGridItem';

interface WalletMediaPickerContentProps {
  loading: boolean;
  error: string | null;
  previews: WalletMediaPreview[];
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
}

export function WalletMediaPickerContent({
  loading,
  error,
  previews,
  selectedFileId,
  onSelectFile
}: WalletMediaPickerContentProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading image previews...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (previews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No matching images found.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {previews.map((file) => (
        <WalletMediaPickerGridItem
          key={file.id}
          file={file}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
