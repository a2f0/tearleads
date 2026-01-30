import { useDraggable } from '@dnd-kit/core';
import type { MouseEvent, ReactNode } from 'react';
import type { VfsObjectType } from '../hooks';
import { cn } from '../lib';

export interface DragItemData {
  id: string;
  objectType: VfsObjectType;
  name: string;
}

interface VfsDraggableItemProps {
  item: DragItemData;
  children: ReactNode;
  className?: string;
  /** Render as table row instead of div */
  asTableRow?: boolean;
  /** Whether this item is currently selected */
  isSelected?: boolean;
  /** Click handler for selection */
  onClick?: (e: MouseEvent) => void;
  /** Double-click handler for opening */
  onDoubleClick?: (e: MouseEvent) => void;
  /** Context menu handler */
  onContextMenu?: (e: MouseEvent) => void;
}

export function VfsDraggableItem({
  item,
  children,
  className = '',
  asTableRow = false,
  isSelected = false,
  onClick,
  onDoubleClick,
  onContextMenu
}: VfsDraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item-${item.id}`,
    data: item,
    disabled: !isSelected
  });

  const combinedClassName = cn(
    className,
    isDragging && 'opacity-0',
    isSelected
      ? 'bg-accent text-accent-foreground hover:bg-accent/70'
      : 'hover:bg-accent/50'
  );

  const cursorStyle = 'default';

  if (asTableRow) {
    return (
      <tr
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={combinedClassName}
        style={{ cursor: cursorStyle }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {children}
      </tr>
    );
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit provides accessibility via attributes */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation is a separate enhancement */
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={combinedClassName}
      style={{ cursor: cursorStyle }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}
