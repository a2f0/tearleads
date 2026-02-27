import { Button, Input } from '@tearleads/ui';
import { FileImage, FileText, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletMediaFileOption } from '../../lib/walletData';
import { useWalletRuntime } from '../../runtime';

interface WalletMediaPreview extends WalletMediaFileOption {
  objectUrl: string | null;
}

interface WalletMediaPickerModalProps {
  open: boolean;
  title: string;
  files: WalletMediaFileOption[];
  selectedFileId: string;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (fileId: string) => void;
}

function revokePreviewUrls(previews: WalletMediaPreview[]): void {
  for (const preview of previews) {
    if (preview.objectUrl) {
      URL.revokeObjectURL(preview.objectUrl);
    }
  }
}

export function WalletMediaPickerModal({
  open,
  title,
  files,
  selectedFileId,
  onOpenChange,
  onSelectFile
}: WalletMediaPickerModalProps) {
  const { isUnlocked, currentInstanceId, loadMediaPreview } =
    useWalletRuntime();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<WalletMediaPreview[]>([]);
  const previewsRef = useRef<WalletMediaPreview[]>([]);

  const replacePreviews = useCallback((next: WalletMediaPreview[]) => {
    revokePreviewUrls(previewsRef.current);
    previewsRef.current = next;
    setPreviews(next);
  }, []);

  useEffect(() => {
    return () => {
      revokePreviewUrls(previewsRef.current);
      previewsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setError(null);
      setLoading(false);
      replacePreviews([]);
      return;
    }

    if (!isUnlocked) {
      setError('Unlock the database to browse images.');
      replacePreviews([]);
      return;
    }

    let cancelled = false;

    const loadPreviews = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const loadedPreviews = await Promise.all(
          files.map(async (file) => {
            try {
              const objectUrl = await loadMediaPreview(file, currentInstanceId);
              return { ...file, objectUrl };
            } catch {
              return { ...file, objectUrl: null };
            }
          })
        );

        if (cancelled) {
          revokePreviewUrls(loadedPreviews);
          return;
        }

        replacePreviews(loadedPreviews);
      } catch (loadError) {
        if (!cancelled) {
          const message =
            loadError instanceof Error ? loadError.message : String(loadError);
          setError(message);
          replacePreviews([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [
    currentInstanceId,
    files,
    isUnlocked,
    loadMediaPreview,
    open,
    replacePreviews
  ]);

  const filteredPreviews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return previews;
    }

    return previews.filter((preview) =>
      preview.name.toLowerCase().includes(query)
    );
  }, [previews, searchQuery]);

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
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading image previews...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
              {error}
            </div>
          )}

          {!loading && !error && filteredPreviews.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No matching images found.
            </div>
          )}

          {!loading && !error && filteredPreviews.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredPreviews.map((file) => {
                const isSelected = selectedFileId === file.id;
                const showImage = Boolean(file.objectUrl);
                return (
                  <button
                    key={file.id}
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
