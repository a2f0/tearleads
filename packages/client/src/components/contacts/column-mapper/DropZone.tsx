import type { ColumnMapping } from '@/hooks/useContactsImport';
import { DroppableArea } from './DroppableArea';
import type { TargetField } from './types';

interface DropZoneProps {
  field: TargetField;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
}

export function DropZone({ field, mapping, headers, onRemove }: DropZoneProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-medium text-sm">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </span>
      <DroppableArea
        fieldKey={field.key}
        mapping={mapping}
        headers={headers}
        onRemove={onRemove}
        placeholder="Drag a column here"
      />
    </div>
  );
}
