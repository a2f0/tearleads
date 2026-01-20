import { Database, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SETTING_STORAGE_KEYS } from '@/db/user-settings';
import { formatFileSize } from '@/lib/utils';
import { type StorageEntry, StorageRow } from './StorageRow';

type DeleteDialogState = { type: 'item'; key: string } | { type: 'all' } | null;

const PROTECTED_KEYS = new Set([
  ...Object.values(SETTING_STORAGE_KEYS),
  'desktop-icon-positions',
  'audio-visualizer-style',
  'rapid_last_loaded_model',
  'window-state-preserve'
]);
const PROTECTED_PREFIXES = ['window-dimensions:'];

function isProtectedKey(key: string): boolean {
  return (
    PROTECTED_KEYS.has(key) ||
    PROTECTED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

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
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
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

  const handleDeleteClick = (key: string) => {
    setDeleteDialog({ type: 'item', key });
  };

  const handleClearAllClick = () => {
    if (entries.length === 0) return;
    setDeleteDialog({ type: 'all' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const currentDialog = deleteDialog;
    const entriesSnapshot = entries;

    try {
      if (currentDialog.type === 'item') {
        localStorage.removeItem(currentDialog.key);
        setEntries((prev) =>
          prev.filter((entry) => entry.key !== currentDialog.key)
        );
      } else {
        for (const entry of entriesSnapshot) {
          if (!isProtectedKey(entry.key)) {
            localStorage.removeItem(entry.key);
          }
        }
        setEntries(
          entriesSnapshot.filter((entry) => isProtectedKey(entry.key))
        );
      }
    } catch (err) {
      console.error('Failed to delete:', err);
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const getDeleteDialogContent = () => {
    if (!deleteDialog) return { title: '', description: '' };

    if (deleteDialog.type === 'item') {
      return {
        title: 'Delete Item',
        description: (
          <p>
            Are you sure you want to delete <strong>{deleteDialog.key}</strong>?
          </p>
        )
      };
    }
    return {
      title: 'Clear All',
      description: (
        <p>
          Are you sure you want to clear localStorage data? App preferences and
          window layouts will be preserved to keep Rapid running.
        </p>
      )
    };
  };

  const totalSize = getTotalSize(entries);
  const deleteDialogContent = getDeleteDialogContent();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
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
                onClick={handleClearAllClick}
                aria-label="Clear all localStorage"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <RefreshButton onClick={fetchStorageContents} loading={loading} />
          </div>
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
                onDelete={handleDeleteClick}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteDialog}
        onOpenChange={(open) => {
          if (!open) setDeleteDialog(null);
        }}
        title={deleteDialogContent.title}
        description={deleteDialogContent.description}
        confirmLabel="Delete"
        confirmingLabel="Deleting..."
        onConfirm={handleConfirmDelete}
        closeOnConfirmStart
      />
    </div>
  );
}
