import type { ColumnMapping } from '@/hooks/useContactsImport';
import { DropZoneSmall } from './DropZoneSmall';
import type { FieldGroup } from './types';

interface FieldGroupRowProps {
  group: FieldGroup;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
}

export function FieldGroupRow({
  group,
  mapping,
  headers,
  onRemove
}: FieldGroupRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 font-medium text-sm">{group.name}</span>
      <div className="grid flex-1 grid-cols-2 gap-2">
        <DropZoneSmall
          fieldKey={group.labelKey}
          mapping={mapping}
          headers={headers}
          onRemove={onRemove}
          placeholder="Label"
        />
        <DropZoneSmall
          fieldKey={group.valueKey}
          mapping={mapping}
          headers={headers}
          onRemove={onRemove}
          placeholder="Value"
        />
      </div>
    </div>
  );
}
