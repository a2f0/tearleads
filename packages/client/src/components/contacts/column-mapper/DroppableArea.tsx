import { useDroppable } from '@dnd-kit/core';
import { X } from 'lucide-react';
import type { ColumnMapping } from '@/hooks/useContactsImport';

interface DroppableAreaProps {
  fieldKey: keyof ColumnMapping;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
  placeholder: string;
  truncateText?: boolean;
}

export function DroppableArea({
  fieldKey,
  mapping,
  headers,
  onRemove,
  placeholder,
  truncateText = false
}: DroppableAreaProps) {
  const mappedIndex = mapping[fieldKey];
  const { isOver, setNodeRef } = useDroppable({
    id: `target-${fieldKey}`
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-10 flex-1 items-center rounded-md border-2 border-dashed px-3 ${
        isOver
          ? 'border-primary bg-primary/10'
          : mappedIndex !== null
            ? 'border-muted-foreground/30 border-solid bg-muted'
            : 'border-muted-foreground/30'
      }`}
    >
      {mappedIndex !== null ? (
        <div className="flex w-full items-center justify-between">
          <span className={`text-sm ${truncateText ? 'truncate' : ''}`}>
            {headers[mappedIndex]}
          </span>
          <button
            type="button"
            onClick={() => onRemove(fieldKey)}
            className={`text-muted-foreground hover:text-foreground ${truncateText ? 'ml-1 shrink-0' : ''}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">{placeholder}</span>
      )}
    </div>
  );
}
