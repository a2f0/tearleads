import {
  ChevronDown,
  ChevronRight,
  FileIcon,
  FolderIcon,
  FolderOpen
} from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { DeleteButton } from './DeleteButton';
import type { FileSystemEntry } from './types';

interface TreeNodeProps {
  entry: FileSystemEntry;
  depth: number;
  expandedPaths: Set<string>;
  path: string;
  onToggle: (path: string) => void;
  onDelete: (path: string, isDirectory: boolean) => void;
}

export function TreeNode({
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
              <FolderOpen className="h-4 w-4 shrink-0 text-chart-5" />
            ) : (
              <FolderIcon className="h-4 w-4 shrink-0 text-chart-5" />
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
