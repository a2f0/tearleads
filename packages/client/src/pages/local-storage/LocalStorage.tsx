import { Database, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { formatFileSize } from '@/lib/utils';
import { type StorageEntry, StorageRow } from './StorageRow';

function getStorageEntries(): StorageEntry[] {
  const entries: StorageEntry[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) {
      const value = localStorage.getItem(key) ?? '';
      const size = new Blob([key, value]).size;
      entries.push({ key, value, size });
    }
  }

  // Sort alphabetically by key
  entries.sort((a, b) => a.key.localeCompare(b.key));

  return entries;
}

function getTotalSize(entries: StorageEntry[]): number {
  return entries.reduce((total, entry) => total + entry.size, 0);
}

export function LocalStorage() {
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchStorageContents = useCallback(() => {
    setLoading(true);
    setError(null);

    try {
      const storageEntries = getStorageEntries();

      if (isMountedRef.current) {
        setEntries(storageEntries);
      }
    } catch (err) {
      console.error('Failed to read localStorage:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStorageContents();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStorageContents]);

  const handleDelete = (key: string) => {
    const confirmationMessage = `Are you sure you want to delete "${key}"?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      localStorage.removeItem(key);
      fetchStorageContents();
    } catch (err) {
      console.error('Failed to delete:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;

    const confirmationMessage =
      'Are you sure you want to clear ALL localStorage data? This cannot be undone.';

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      localStorage.clear();
      fetchStorageContents();
    } catch (err) {
      console.error('Failed to clear localStorage:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const totalSize = getTotalSize(entries);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            Local Storage Browser
          </h1>
          {entries.length > 0 && (
            <p className="mt-1 text-muted-foreground text-sm">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'} (
              {formatFileSize(totalSize)})
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {entries.length > 0 && (
            <Button
              variant="destructive"
              size="icon"
              onClick={handleClearAll}
              aria-label="Clear all localStorage"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <RefreshButton onClick={fetchStorageContents} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading localStorage contents...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4">localStorage is empty.</p>
          </div>
        ) : (
          <div>
            {entries.map((entry) => (
              <StorageRow
                key={entry.key}
                entry={entry}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
