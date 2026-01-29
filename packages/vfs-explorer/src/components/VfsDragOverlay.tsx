import { DragOverlay } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { cn, OBJECT_TYPE_COLORS, OBJECT_TYPE_ICONS } from '../lib';
import type { DragItemData } from './VfsDraggableItem';

interface VfsDragOverlayProps {
  activeItem: DragItemData | null;
}

export function VfsDragOverlay({ activeItem }: VfsDragOverlayProps) {
  if (!activeItem) {
    return <DragOverlay modifiers={[snapCenterToCursor]} />;
  }

  const Icon = OBJECT_TYPE_ICONS[activeItem.objectType];
  const colorClass = OBJECT_TYPE_COLORS[activeItem.objectType];

  return (
    <DragOverlay modifiers={[snapCenterToCursor]}>
      <div className="rounded-md bg-background/90 p-1.5 shadow-md">
        <Icon className={cn('h-5 w-5', colorClass)} />
      </div>
    </DragOverlay>
  );
}
