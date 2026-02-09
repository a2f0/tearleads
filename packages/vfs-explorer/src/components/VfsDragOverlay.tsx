import { DragOverlay } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { cn, OBJECT_TYPE_COLORS, OBJECT_TYPE_ICONS } from '../lib';
import type { DragItemData } from './VfsDraggableItem';

interface VfsDragOverlayProps {
  activeItem: DragItemData | null;
}

export function VfsDragOverlay({ activeItem }: VfsDragOverlayProps) {
  if (!activeItem) {
    return <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null} />;
  }

  const Icon = OBJECT_TYPE_ICONS[activeItem.objectType];
  const colorClass = OBJECT_TYPE_COLORS[activeItem.objectType];
  const selectedCount = activeItem.selectedItems?.length ?? 1;

  return (
    <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
      <div className="inline-flex max-w-64 items-center gap-2 rounded-md border bg-background px-2 py-1.5 shadow-md">
        <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
        <span className="truncate text-sm">
          {selectedCount > 1
            ? `${selectedCount} items`
            : activeItem.name}
        </span>
      </div>
    </DragOverlay>
  );
}
