import type { ColumnMapping } from '@/hooks/useContactsImport';
import { DroppableArea } from './DroppableArea';

interface DropZoneSmallProps {
  fieldKey: keyof ColumnMapping;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
  placeholder: string;
}

export function DropZoneSmall({
  fieldKey,
  mapping,
  headers,
  onRemove,
  placeholder
}: DropZoneSmallProps) {
  return (
    <DroppableArea
      fieldKey={fieldKey}
      mapping={mapping}
      headers={headers}
      onRemove={onRemove}
      placeholder={placeholder}
      truncateText
    />
  );
}
