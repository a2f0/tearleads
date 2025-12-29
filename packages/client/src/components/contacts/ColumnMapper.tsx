import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDraggable,
  useDroppable
} from '@dnd-kit/core';
import { GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ColumnMapping, ParsedCSV } from '@/hooks/useContactsImport';

interface ColumnMapperProps {
  data: ParsedCSV;
  onImport: (mapping: ColumnMapping) => void;
  onCancel: () => void;
  importing: boolean;
}

interface TargetField {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
}

const TARGET_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'birthday', label: 'Birthday', required: false }
];

function DraggableColumn({
  index,
  header,
  disabled
}: {
  index: number;
  header: string;
  disabled: boolean;
}) {
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

function DropZone({
  field,
  mapping,
  headers,
  onRemove
}: {
  field: TargetField;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
}) {
  const mappedIndex = mapping[field.key];
  const { isOver, setNodeRef } = useDroppable({
    id: `target-${field.key}`
  });

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-medium text-sm">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </span>
      <div
        ref={setNodeRef}
        className={`flex min-h-[40px] flex-1 items-center rounded-md border-2 border-dashed px-3 ${
          isOver
            ? 'border-primary bg-primary/10'
            : mappedIndex !== null
              ? 'border-muted-foreground/30 border-solid bg-muted'
              : 'border-muted-foreground/30'
        }`}
      >
        {mappedIndex !== null ? (
          <div className="flex w-full items-center justify-between">
            <span className="text-sm">{headers[mappedIndex]}</span>
            <button
              type="button"
              onClick={() => onRemove(field.key)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">
            Drag a column here
          </span>
        )}
      </div>
    </div>
  );
}

function ColumnChip({ header }: { header: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="truncate">{header}</span>
    </div>
  );
}

export function ColumnMapper({
  data,
  onImport,
  onCancel,
  importing
}: ColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping>({
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    birthday: null
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  // Get which column indices are already mapped
  const mappedIndices = new Set(
    Object.values(mapping).filter((v): v is number => v !== null)
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);

    const { active, over } = event;
    if (!over) return;

    const targetId = over.id as string;
    if (!targetId.startsWith('target-')) return;

    const fieldKey = targetId.replace('target-', '') as keyof ColumnMapping;
    const columnIndex = (active.data.current as { index: number }).index;

    setMapping((prev) => ({
      ...prev,
      [fieldKey]: columnIndex
    }));
  };

  const handleRemoveMapping = (key: keyof ColumnMapping) => {
    setMapping((prev) => ({
      ...prev,
      [key]: null
    }));
  };

  const handleImport = () => {
    onImport(mapping);
  };

  const canImport = mapping.firstName !== null;

  // Get active column data for overlay
  const activeColumnIndex = activeId
    ? Number.parseInt(activeId.replace('column-', ''), 10)
    : null;
  const activeHeader =
    activeColumnIndex !== null ? data.headers[activeColumnIndex] : null;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6">
        <div>
          <h3 className="mb-2 font-medium">CSV Columns</h3>
          <p className="mb-3 text-muted-foreground text-sm">
            Drag columns to map them to contact fields
          </p>
          <div className="flex flex-wrap gap-2">
            {data.headers.map((header, index) => (
              <DraggableColumn
                key={header}
                index={index}
                header={header}
                disabled={mappedIndices.has(index)}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-medium">Contact Fields</h3>
          <div className="space-y-3">
            {TARGET_FIELDS.map((field) => (
              <DropZone
                key={field.key}
                field={field}
                mapping={mapping}
                headers={data.headers}
                onRemove={handleRemoveMapping}
              />
            ))}
          </div>
        </div>

        {data.rows.length > 0 &&
          (() => {
            const mappedFields = TARGET_FIELDS.filter(
              (f) => mapping[f.key] !== null
            );
            return (
              <div>
                <h3 className="mb-2 font-medium">Preview (first 3 rows)</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {mappedFields.map((field) => (
                          <th
                            key={field.key}
                            className="px-3 py-2 text-left font-medium"
                          >
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.slice(0, 3).map((row, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are static, never reordered
                        <tr key={index} className="border-t">
                          {mappedFields.map((field) => (
                            <td key={field.key} className="px-3 py-2">
                              {mapping[field.key] !== null
                                ? row[mapping[field.key] as number] || '-'
                                : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-muted-foreground text-sm">
                  {data.rows.length} total rows
                </p>
              </div>
            );
          })()}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport || importing}>
            {importing ? 'Importing...' : `Import ${data.rows.length} Contacts`}
          </Button>
        </div>
      </div>

      <DragOverlay>
        {activeHeader ? <ColumnChip header={activeHeader} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
