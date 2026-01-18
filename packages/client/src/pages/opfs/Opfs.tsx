import { HardDrive, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RefreshButton } from '@/components/ui/refresh-button';
import { formatFileSize } from '@/lib/utils';
import { TreeNode } from './TreeNode';
import type { FileSystemEntry, StorageEstimate } from './types';

type DeleteDialogState = {
  path: string;
  name: string;
  isDirectory: boolean;
} | null;

function calculateTotalSize(entries: FileSystemEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.kind === 'file' && entry.size !== undefined) {
      return total + entry.size;
    }
    if (entry.kind === 'directory' && entry.children) {
      return total + calculateTotalSize(entry.children);
    }
    return total;
  }, 0);
}

function countFiles(entries: FileSystemEntry[]): number {
  return entries.reduce((count, entry) => {
    if (entry.kind === 'file') {
      return count + 1;
    }
    if (entry.kind === 'directory' && entry.children) {
      return count + countFiles(entry.children);
    }
    return count;
  }, 0);
}

async function readDirectory(
  handle: FileSystemDirectoryHandle
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];

  for await (const [name, childHandle] of handle.entries()) {
    if (childHandle.kind === 'file') {
      const file = await childHandle.getFile();
      entries.push({
        name,
        kind: 'file',
        size: file.size
      });
    } else {
      const children = await readDirectory(childHandle);
      entries.push({
        name,
        kind: 'directory',
        children
      });
    }
  }

  // Sort: directories first, then files, alphabetically
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

function collectAllPaths(
  entries: FileSystemEntry[],
  parentPath: string
): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const entryPath = `${parentPath}/${entry.name}`;
    if (entry.kind === 'directory') {
      paths.push(entryPath);
      if (entry.children) {
        paths.push(...collectAllPaths(entry.children, entryPath));
      }
    }
  }
  return paths;
}

export function Opfs() {
  const [entries, setEntries] = useState<FileSystemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [storageEstimate, setStorageEstimate] =
    useState<StorageEstimate | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const isMountedRef = useRef(true);

  const fetchOpfsContents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!('storage' in navigator) || !navigator.storage.getDirectory) {
        if (isMountedRef.current) {
          setSupported(false);
          setLoading(false);
        }
        return;
      }

      const root = await navigator.storage.getDirectory();
      const fetchedEntries = await readDirectory(root);

      // Fetch storage estimate
      let estimate: StorageEstimate | null = null;
      if (navigator.storage.estimate) {
        const rawEstimate = await navigator.storage.estimate();
        if (
          rawEstimate.usage !== undefined &&
          rawEstimate.quota !== undefined
        ) {
          estimate = {
            usage: rawEstimate.usage,
            quota: rawEstimate.quota
          };
        }
      }

      if (isMountedRef.current) {
        setEntries(fetchedEntries);
        setStorageEstimate(estimate);
        // Expand all directories by default
        const allPaths = collectAllPaths(fetchedEntries, '');
        setExpandedPaths(new Set(allPaths));
      }
    } catch (err) {
      console.error('Failed to read OPFS:', err);
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
    fetchOpfsContents();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOpfsContents]);

  const handleToggle = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleDeleteClick = (path: string, isDirectory: boolean) => {
    const name = path.substring(path.lastIndexOf('/') + 1);
    setDeleteDialog({ path, name, isDirectory });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;

    const { path, isDirectory } = deleteDialog;

    try {
      const root = await navigator.storage.getDirectory();
      const pathParts = path.split('/').filter(Boolean);
      const nameToDelete = pathParts.pop();

      if (!nameToDelete) return;

      // Navigate to parent directory
      let parentDir = root;
      for (const part of pathParts) {
        parentDir = await parentDir.getDirectoryHandle(part);
      }

      // Remove the entry
      await parentDir.removeEntry(nameToDelete, { recursive: isDirectory });

      // Refresh the tree
      await fetchOpfsContents();
    } catch (err) {
      console.error('Failed to delete:', err);
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const getDeleteDialogContent = () => {
    if (!deleteDialog) return { title: '', description: '' };

    if (deleteDialog.isDirectory) {
      return {
        title: 'Delete Directory',
        description: (
          <p>
            Are you sure you want to delete the directory{' '}
            <strong>{deleteDialog.name}</strong> and all its contents?
          </p>
        )
      };
    }
    return {
      title: 'Delete File',
      description: (
        <p>
          Are you sure you want to delete the file{' '}
          <strong>{deleteDialog.name}</strong>?
        </p>
      )
    };
  };

  const deleteDialogContent = getDeleteDialogContent();

  if (!supported) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
          <h1 className="font-bold text-2xl tracking-tight">OPFS Browser</h1>
        </div>
        <div className="rounded-lg border p-8 text-center">
          <HardDrive className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Origin Private File System is not supported in this browser.
          </p>
        </div>
      </div>
    );
  }

  const totalSize = calculateTotalSize(entries);
  const fileCount = countFiles(entries);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">OPFS Browser</h1>
            {(entries.length > 0 || storageEstimate) && (
              <p className="text-muted-foreground text-sm">
                {fileCount > 0 && (
                  <>
                    {fileCount} file{fileCount !== 1 ? 's' : ''} (
                    {formatFileSize(totalSize)})
                  </>
                )}
                {storageEstimate && (
                  <>
                    {fileCount > 0 && ' · '}
                    {formatFileSize(storageEstimate.usage)} /{' '}
                    {formatFileSize(storageEstimate.quota)} total capacity
                  </>
                )}
              </p>
            )}
          </div>
          <RefreshButton onClick={fetchOpfsContents} loading={loading} />
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
            Loading OPFS contents...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <HardDrive className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4">OPFS is empty.</p>
          </div>
        ) : (
          <div className="py-2">
            {entries.map((entry) => (
              <TreeNode
                key={entry.name}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                path={`/${entry.name}`}
                onToggle={handleToggle}
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
      />
    </div>
  );
}
