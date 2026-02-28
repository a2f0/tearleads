import { FileImage, FileText } from 'lucide-react';
import type { WalletMediaPreview } from './useWalletMediaPreviews';

interface WalletMediaPickerGridItemProps {
  file: WalletMediaPreview;
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
}

export function WalletMediaPickerGridItem({
  file,
  selectedFileId,
  onSelectFile
}: WalletMediaPickerGridItemProps) {
  const isSelected = selectedFileId === file.id;
  const showImage = Boolean(file.objectUrl);

  return (
    <button
      type="button"
      onClick={() => onSelectFile(file.id)}
      className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-all hover:ring-2 hover:ring-primary/60 ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
    >
      <div className="relative aspect-square bg-muted">
        {showImage ? (
          <img
            src={file.objectUrl ?? ''}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        ) : file.mimeType === 'application/pdf' ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <FileText className="h-10 w-10" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <FileImage className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="space-y-1 border-t bg-background px-2 py-2">
        <p className="truncate text-sm">{file.name}</p>
        <p className="text-muted-foreground text-xs">
          {file.mimeType === 'application/pdf' ? 'PDF' : 'Image'}
        </p>
      </div>
    </button>
  );
}
