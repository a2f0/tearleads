import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNFILED_FOLDER_ID } from '../constants';
import { useMoveVfsItem } from '../hooks';
import { type DisplayItem, VfsDetailsPanel } from './VfsDetailsPanel';
import type { DragItemData } from './VfsDraggableItem';
import { VfsDragOverlay } from './VfsDragOverlay';
import { VfsStatusBar } from './VfsStatusBar';
import { VfsTreePanel } from './VfsTreePanel';

export type VfsViewMode = 'list' | 'table';

/** Item data passed to onItemOpen callback */
export type VfsOpenItem = DisplayItem;

interface VfsExplorerProps {
  className?: string;
  compact?: boolean | undefined;
  viewMode?: VfsViewMode | undefined;
  refreshToken?: number | undefined;
  selectedFolderId?: string | null | undefined;
  onFolderSelect?: ((folderId: string | null) => void) | undefined;
  onItemMoved?: (() => void) | undefined;
  /** Callback when a non-folder item is double-clicked */
  onItemOpen?: ((item: VfsOpenItem) => void) | undefined;
  /** Callback when download is requested via context menu */
  onItemDownload?: ((item: VfsOpenItem) => void) | undefined;
}

export function VfsExplorer({
  className,
  compact,
  viewMode = 'table',
  refreshToken,
  selectedFolderId: controlledSelectedFolderId,
  onFolderSelect,
  onItemMoved,
  onItemOpen,
  onItemDownload
}: VfsExplorerProps) {
  const [internalSelectedFolderId, setInternalSelectedFolderId] = useState<
    string | null
  >(UNFILED_FOLDER_ID);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [treePanelWidth, setTreePanelWidth] = useState(240);
  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const { moveItem } = useMoveVfsItem();

  // Configure pointer sensor with distance constraint to allow double-clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  // Get selected item name for status bar
  const selectedItemName = useMemo(() => {
    if (!selectedItemId) return null;
    const item = items.find((i) => i.id === selectedItemId);
    return item?.name ?? null;
  }, [selectedItemId, items]);

  // Use controlled state if provided, otherwise use internal state
  const selectedFolderId =
    controlledSelectedFolderId !== undefined
      ? controlledSelectedFolderId
      : internalSelectedFolderId;

  // Clear item selection when folder changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - we want to clear selection when folder changes
  useEffect(() => {
    setSelectedItemId(null);
  }, [selectedFolderId]);

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
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={`flex h-full flex-col ${className ?? ''}`}>
        <div className="flex min-h-0 flex-1">
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
            selectedItemId={selectedItemId}
            onItemSelect={setSelectedItemId}
            onFolderSelect={handleFolderSelect}
            onItemOpen={onItemOpen}
            onItemDownload={onItemDownload}
            onItemsChange={setItems}
          />
        </div>
        <VfsStatusBar
          itemCount={items.length}
          selectedItemName={selectedItemName}
        />
      </div>
      <VfsDragOverlay activeItem={activeItem} />
    </DndContext>
  );
}
