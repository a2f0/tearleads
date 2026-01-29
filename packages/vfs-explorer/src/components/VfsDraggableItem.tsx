import { useDraggable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import type { VfsObjectType } from '../hooks';

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
}

export function VfsDraggableItem({
  item,
  children,
  className = '',
  asTableRow = false
}: VfsDraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item-${item.id}`,
    data: item
  });

  const combinedClassName = `${className} ${isDragging ? 'opacity-50' : ''}`;

  if (asTableRow) {
    return (
      <tr
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={combinedClassName}
        style={{ cursor: 'grab' }}
      >
        {children}
      </tr>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={combinedClassName}
      style={{ cursor: 'grab' }}
    >
      {children}
    </div>
  );
}
