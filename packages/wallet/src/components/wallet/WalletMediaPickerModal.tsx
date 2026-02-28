import { Button, Input } from '@tearleads/ui';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WalletMediaFileOption } from '../../lib/walletData';
import { useWalletMediaPreviews } from './useWalletMediaPreviews';
import { WalletMediaPickerContent } from './WalletMediaPickerContent';

interface WalletMediaPickerModalProps {
  open: boolean;
  title: string;
  files: WalletMediaFileOption[];
  selectedFileId: string;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (fileId: string) => void;
}

export function WalletMediaPickerModal({
  open,
  title,
  files,
  selectedFileId,
  onOpenChange,
  onSelectFile
}: WalletMediaPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { loading, error, filteredPreviews } = useWalletMediaPreviews({
    open,
    files,
    searchQuery
  });

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-lg">{title}</h2>
            <p className="text-muted-foreground text-xs">
              Search and select from your uploaded image or PDF files.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close media picker"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search images by file name..."
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <WalletMediaPickerContent
            loading={loading}
            error={error}
            previews={filteredPreviews}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
          />
        </div>
      </div>
    </div>
  );
}
