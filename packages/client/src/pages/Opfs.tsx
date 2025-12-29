import {
  ChevronDown,
  ChevronRight,
  FileIcon,
  FolderIcon,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/utils';

interface FileSystemEntry {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileSystemEntry[];
}

interface TreeNodeProps {
  entry: FileSystemEntry;
  depth: number;
  expandedPaths: Set<string>;
  path: string;
  onToggle: (path: string) => void;
  onDelete: (path: string, isDirectory: boolean) => void;
}

interface DeleteButtonProps {
  onClick: () => void;
}

function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100"
      onClick={onClick}
      title="Delete"
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}

function TreeNode({
  entry,
  depth,
  expandedPaths,
  path,
  onToggle,
  onDelete
}: TreeNodeProps) {
  const isExpanded = expandedPaths.has(path);
  const isDirectory = entry.kind === 'directory';
  const hasChildren = entry.children && entry.children.length > 0;
  const paddingLeft = `${depth * 16 + 8}px`;

  if (isDirectory) {
    return (
      <div>
        <div
          className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent"
          style={{ paddingLeft }}
        >
          <button
            type="button"
            className="flex flex-1 cursor-pointer items-center gap-2 text-left"
            onClick={() => onToggle(path)}
            aria-expanded={hasChildren ? isExpanded : undefined}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-4" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className="truncate text-sm">{entry.name}</span>
          </button>
          <DeleteButton onClick={() => onDelete(path, true)} />
        </div>
        {isExpanded && entry.children && (
          <div>
            {entry.children.map((child) => (
              <TreeNode
                key={`${path}/${child.name}`}
                entry={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                path={`${path}/${child.name}`}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent"
      style={{ paddingLeft }}
    >
      <span className="w-4" />
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm">{entry.name}</span>
      {entry.size !== undefined && (
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">
          {formatFileSize(entry.size)}
        </span>
      )}
      <DeleteButton onClick={() => onDelete(path, false)} />
    </div>
  );
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
  const isMountedRef = useRef(true);

  const fetchOpfsContents = async () => {
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

      if (isMountedRef.current) {
        setEntries(fetchedEntries);
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
  };

  useEffect(() => {
    isMountedRef.current = true;

    const loadContents = async () => {
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

        if (isMountedRef.current) {
          setEntries(fetchedEntries);
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
    };

    loadContents();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const handleDelete = async (path: string, isDirectory: boolean) => {
    const entryName = path.substring(path.lastIndexOf('/') + 1);
    const confirmationMessage = isDirectory
      ? `Are you sure you want to delete the directory "${entryName}" and all its contents?`
      : `Are you sure you want to delete the file "${entryName}"?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

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
    }
  };

  if (!supported) {
    return (
      <div className="space-y-6">
        <h1 className="font-bold text-2xl tracking-tight">OPFS Browser</h1>
        <div className="rounded-lg border p-8 text-center">
          <HardDrive className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Origin Private File System is not supported in this browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">OPFS Browser</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOpfsContents}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
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
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
