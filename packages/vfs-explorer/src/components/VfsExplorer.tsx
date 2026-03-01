import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { useCombinedRefresh } from '@tearleads/window-manager';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UNFILED_FOLDER_ID } from '../constants';
import { useVfsClipboard, VfsClipboardProvider } from '../context';
import { useCopyVfsItem, useMoveVfsItem, type VfsFolderNode } from '../hooks';
import type { DisplayItem, VfsOpenItem, VfsViewMode } from '../lib';
import { SharingPanel } from './SharingPanel';
import { VfsDetailsPanel } from './VfsDetailsPanel';
import type { DragItemData } from './VfsDraggableItem';
import { VfsDragOverlay } from './VfsDragOverlay';
import { VfsStatusBar } from './VfsStatusBar';
import { VfsTreePanel } from './VfsTreePanel';

export type { VfsOpenItem, VfsViewMode };

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
  /** Callback when upload is requested via context menu */
  onUpload?: ((folderId: string) => void) | undefined;
}

export function VfsExplorer(props: VfsExplorerProps) {
  return (
    <VfsClipboardProvider>
      <VfsExplorerInner {...props} />
    </VfsClipboardProvider>
  );
}

function VfsExplorerInner({
  className,
  compact,
  viewMode = 'table',
  refreshToken,
  selectedFolderId: controlledSelectedFolderId,
  onFolderSelect,
  onItemMoved,
  onItemOpen,
  onItemDownload,
  onUpload
}: VfsExplorerProps) {
  // component-complexity: allow
  // Rationale: drag/drop orchestration, clipboard handling, and panel layout
  // state are intentionally co-located in this transition iteration.
  const [internalSelectedFolderId, setInternalSelectedFolderId] = useState<
    string | null
  >(UNFILED_FOLDER_ID);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null
  );
  const [treePanelWidth, setTreePanelWidth] = useState(240);
  const [sharingPanelWidth, setSharingPanelWidth] = useState(320);
  const [sharingItem, setSharingItem] = useState<DisplayItem | null>(null);
  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const { combinedRefreshToken, triggerRefresh } =
    useCombinedRefresh(refreshToken);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'error' | 'info';
  } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { moveItem } = useMoveVfsItem();
  const { copyItem } = useCopyVfsItem();
  const { clipboard, clear: clearClipboard, isCut } = useVfsClipboard();

  const showStatusMessage = useCallback(
    (text: string, type: 'error' | 'info') => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      setStatusMessage({ text, type });
      statusTimerRef.current = setTimeout(() => setStatusMessage(null), 4000);
    },
    []
  );

  // Clean up status timer
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

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
    if (selectedItemIds.length !== 1) return null;
    const item = items.find((i) => i.id === selectedItemIds[0]);
    return item?.name ?? null;
  }, [selectedItemIds, items]);

  // Use controlled state if provided, otherwise use internal state
  const selectedFolderId =
    controlledSelectedFolderId !== undefined
      ? controlledSelectedFolderId
      : internalSelectedFolderId;

  // Clear item selection when folder changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - we want to clear selection when folder changes
  useEffect(() => {
    setSelectedItemIds([]);
    setSelectionAnchorId(null);
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

  const handleItemShare = useCallback((item: DisplayItem) => {
    setSharingItem(item);
  }, []);

  const handleFolderShare = useCallback((folder: VfsFolderNode) => {
    setSharingItem({
      id: folder.id,
      objectType: folder.objectType,
      name: folder.name,
      createdAt: new Date()
    });
  }, []);

  const handleCloseSharingPanel = useCallback(() => {
    setSharingItem(null);
  }, []);

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

      const draggedItems = itemData.selectedItems?.length
        ? itemData.selectedItems
        : [
            {
              id: itemData.id,
              objectType: itemData.objectType,
              name: itemData.name
            }
          ];
      const movableItems = draggedItems.filter(
        (item) => item.id !== targetFolderId
      );
      if (movableItems.length === 0) return;

      try {
        for (const item of movableItems) {
          await moveItem(item.id, targetFolderId);
        }
        if (itemData.sourceFolderId === UNFILED_FOLDER_ID) {
          showStatusMessage(
            `${movableItems.length} item${movableItems.length !== 1 ? 's' : ''} linked`,
            'info'
          );
        }
        triggerRefresh();
        onItemMoved?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to move item:', err);
        showStatusMessage(`Move failed: ${message}`, 'error');
      }
    },
    [moveItem, onItemMoved, showStatusMessage, triggerRefresh]
  );

  const handlePaste = useCallback(
    async (targetFolderId: string) => {
      if (clipboard.items.length === 0) {
        return;
      }

      // Don't allow pasting to unfiled folder
      if (targetFolderId === UNFILED_FOLDER_ID) {
        return;
      }

      try {
        const itemsToPaste = clipboard.items.filter(
          (item) => item.id !== targetFolderId
        );

        if (itemsToPaste.length === 0) {
          return;
        }

        if (isCut) {
          for (const item of itemsToPaste) {
            await moveItem(item.id, targetFolderId);
          }
        } else {
          // Copy can run in parallel because it does not remove existing links.
          await Promise.all(
            itemsToPaste.map((item) => copyItem(item.id, targetFolderId))
          );
        }

        // Clear clipboard after cut (but not after copy)
        if (isCut) {
          clearClipboard();
        }

        // Refresh the view
        triggerRefresh();
        onItemMoved?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to paste items:', err);
        showStatusMessage(`Paste failed: ${message}`, 'error');
      }
    },
    [
      clipboard.items,
      isCut,
      moveItem,
      copyItem,
      clearClipboard,
      onItemMoved,
      showStatusMessage,
      triggerRefresh
    ]
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
            refreshToken={combinedRefreshToken}
            onFolderShare={handleFolderShare}
            onPaste={handlePaste}
          />
          <VfsDetailsPanel
            folderId={selectedFolderId}
            viewMode={viewMode}
            compact={compact}
            refreshToken={combinedRefreshToken}
            selectedItemIds={selectedItemIds}
            selectionAnchorId={selectionAnchorId}
            onItemSelectionChange={(itemIds, anchorId) => {
              setSelectedItemIds(itemIds);
              setSelectionAnchorId(anchorId);
            }}
            onFolderSelect={handleFolderSelect}
            onItemOpen={onItemOpen}
            onItemDownload={onItemDownload}
            onItemsChange={setItems}
            onItemShare={handleItemShare}
            onPaste={handlePaste}
            onUpload={onUpload}
          />
          {sharingItem && (
            <SharingPanel
              item={sharingItem}
              width={sharingPanelWidth}
              onWidthChange={setSharingPanelWidth}
              onClose={handleCloseSharingPanel}
            />
          )}
        </div>
        <VfsStatusBar
          itemCount={items.length}
          selectedItemCount={selectedItemIds.length}
          selectedItemName={selectedItemName}
          message={statusMessage}
        />
      </div>
      <VfsDragOverlay activeItem={activeItem} />
    </DndContext>
  );
}
