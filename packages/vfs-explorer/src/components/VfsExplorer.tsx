import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { useCallback, useState } from 'react';
import { useMoveVfsItem } from '../hooks';
import { VfsDetailsPanel } from './VfsDetailsPanel';
import type { DragItemData } from './VfsDraggableItem';
import { VfsDragOverlay } from './VfsDragOverlay';
import { UNFILED_FOLDER_ID, VfsTreePanel } from './VfsTreePanel';

export type VfsViewMode = 'list' | 'table';

interface VfsExplorerProps {
  className?: string;
  compact?: boolean | undefined;
  viewMode?: VfsViewMode | undefined;
  refreshToken?: number | undefined;
  selectedFolderId?: string | null | undefined;
  onFolderSelect?: ((folderId: string | null) => void) | undefined;
  onItemMoved?: (() => void) | undefined;
}

export function VfsExplorer({
  className,
  compact,
  viewMode = 'list',
  refreshToken,
  selectedFolderId: controlledSelectedFolderId,
  onFolderSelect,
  onItemMoved
}: VfsExplorerProps) {
  const [internalSelectedFolderId, setInternalSelectedFolderId] = useState<
    string | null
  >(null);
  const [treePanelWidth, setTreePanelWidth] = useState(240);
  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const { moveItem } = useMoveVfsItem();

  // Use controlled state if provided, otherwise use internal state
  const selectedFolderId =
    controlledSelectedFolderId !== undefined
      ? controlledSelectedFolderId
      : internalSelectedFolderId;

  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      if (onFolderSelect) {
        onFolderSelect(folderId);
      } else {
        setInternalSelectedFolderId(folderId);
      }
    },
    [onFolderSelect]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragItemData | undefined;
    if (data) {
      setActiveItem(data);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveItem(null);

      const { active, over } = event;
      if (!over) return;

      // Extract folder ID from droppable data
      const targetFolderId = over.data.current?.['folderId'] as
        | string
        | undefined;
      if (!targetFolderId) return;

      // Don't allow dropping on unfiled folder
      if (targetFolderId === UNFILED_FOLDER_ID) return;

      // Get the item data
      const itemData = active.data.current as DragItemData | undefined;
      if (!itemData) return;

      // Don't allow dropping a folder into itself
      if (itemData.objectType === 'folder' && itemData.id === targetFolderId)
        return;

      try {
        await moveItem(itemData.id, targetFolderId);
        onItemMoved?.();
      } catch (err) {
        console.error('Failed to move item:', err);
      }
    },
    [moveItem, onItemMoved]
  );

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={`flex h-full ${className ?? ''}`}>
        <VfsTreePanel
          width={treePanelWidth}
          onWidthChange={setTreePanelWidth}
          selectedFolderId={selectedFolderId}
          onFolderSelect={handleFolderSelect}
          compact={compact}
          refreshToken={refreshToken}
        />
        <VfsDetailsPanel
          folderId={selectedFolderId}
          viewMode={viewMode}
          compact={compact}
          refreshToken={refreshToken}
        />
      </div>
      <VfsDragOverlay activeItem={activeItem} />
    </DndContext>
  );
}
