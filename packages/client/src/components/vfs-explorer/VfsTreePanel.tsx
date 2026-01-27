import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface VfsFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  children?: VfsFolderNode[];
  childCount: number;
}

interface VfsTreePanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  compact?: boolean | undefined;
}

export function VfsTreePanel({
  width,
  onWidthChange,
  selectedFolderId,
  onFolderSelect,
  compact: _compact
}: VfsTreePanelProps) {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set()
  );
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Mock data for now - will be replaced with useVfsFolders hook
  const folders: VfsFolderNode[] = [
    {
      id: 'root-1',
      name: 'My Documents',
      parentId: null,
      childCount: 2,
      children: [
        { id: 'folder-1', name: 'Work', parentId: 'root-1', childCount: 0 },
        {
          id: 'folder-2',
          name: 'Personal',
          parentId: 'root-1',
          childCount: 1,
          children: [
            {
              id: 'folder-3',
              name: 'Photos',
              parentId: 'folder-2',
              childCount: 0
            }
          ]
        }
      ]
    },
    {
      id: 'root-2',
      name: 'Shared With Me',
      parentId: null,
      childCount: 0
    }
  ];

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = e.clientX - startX.current;
        const newWidth = Math.max(
          150,
          Math.min(400, startWidth.current + delta)
        );
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onWidthChange]
  );

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const renderFolder = (folder: VfsFolderNode, depth: number) => {
    const isSelected = folder.id === selectedFolderId;
    const isExpanded = expandedFolderIds.has(folder.id);
    const hasChildren =
      folder.childCount > 0 || (folder.children && folder.children.length > 0);
    const FolderIcon = isExpanded ? FolderOpen : Folder;

    return (
      <div key={folder.id}>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
            isSelected
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onFolderSelect(folder.id)}
          onDoubleClick={() => toggleExpand(folder.id)}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: span with role=button used to avoid nested button elements */}
          <span
            role="button"
            tabIndex={0}
            className="flex h-4 w-4 shrink-0 items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(folder.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                toggleExpand(folder.id);
              }
            }}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )
            ) : null}
          </span>
          <FolderIcon className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
          <span className="truncate">{folder.name}</span>
        </button>
        {isExpanded && folder.children && folder.children.length > 0 && (
          <div>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
    >
      <div className="flex items-center border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Folders
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {folders.map((folder) => renderFolder(folder, 0))}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for panel width */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
