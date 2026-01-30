import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';

interface DraggableColumnProps {
  index: number;
  header: string;
  disabled: boolean;
}

export function DraggableColumn({
  index,
  header,
  disabled
}: DraggableColumnProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `column-${index}`,
    data: { index, header },
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm ${
        isDragging ? 'opacity-50' : ''
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="truncate">{header}</span>
    </div>
  );
}
