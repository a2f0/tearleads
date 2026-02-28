import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletMediaFileOption } from '../../lib/walletData';
import { useWalletRuntime } from '../../runtime';

export interface WalletMediaPreview extends WalletMediaFileOption {
  objectUrl: string | null;
}

interface UseWalletMediaPreviewsArgs {
  open: boolean;
  files: WalletMediaFileOption[];
  searchQuery: string;
}

function revokePreviewUrls(previews: WalletMediaPreview[]): void {
  for (const preview of previews) {
    if (preview.objectUrl) {
      URL.revokeObjectURL(preview.objectUrl);
    }
  }
}

export function useWalletMediaPreviews({
  open,
  files,
  searchQuery
}: UseWalletMediaPreviewsArgs) {
  const { isUnlocked, currentInstanceId, loadMediaPreview } =
    useWalletRuntime();
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

  return {
    loading,
    error,
    filteredPreviews
  };
}
