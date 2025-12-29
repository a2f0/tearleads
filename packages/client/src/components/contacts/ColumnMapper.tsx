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

// Basic contact fields
const BASIC_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'birthday', label: 'Birthday', required: false }
];

// Email field groups (label + value pairs)
interface FieldGroup {
  name: string;
  labelKey: keyof ColumnMapping;
  valueKey: keyof ColumnMapping;
}

const EMAIL_FIELDS: FieldGroup[] = [
  { name: 'Email 1', labelKey: 'email1Label', valueKey: 'email1Value' },
  { name: 'Email 2', labelKey: 'email2Label', valueKey: 'email2Value' }
];

const PHONE_FIELDS: FieldGroup[] = [
  { name: 'Phone 1', labelKey: 'phone1Label', valueKey: 'phone1Value' },
  { name: 'Phone 2', labelKey: 'phone2Label', valueKey: 'phone2Value' },
  { name: 'Phone 3', labelKey: 'phone3Label', valueKey: 'phone3Value' }
];

// All fields for preview purposes
const ALL_PREVIEW_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'email1Label', label: 'Email 1 Label', required: false },
  { key: 'email1Value', label: 'Email 1', required: false },
  { key: 'email2Label', label: 'Email 2 Label', required: false },
  { key: 'email2Value', label: 'Email 2', required: false },
  { key: 'phone1Label', label: 'Phone 1 Label', required: false },
  { key: 'phone1Value', label: 'Phone 1', required: false },
  { key: 'phone2Label', label: 'Phone 2 Label', required: false },
  { key: 'phone2Value', label: 'Phone 2', required: false },
  { key: 'phone3Label', label: 'Phone 3 Label', required: false },
  { key: 'phone3Value', label: 'Phone 3', required: false },
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

function DropZoneSmall({
  fieldKey,
  mapping,
  headers,
  onRemove,
  placeholder
}: {
  fieldKey: keyof ColumnMapping;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
  placeholder: string;
}) {
  const mappedIndex = mapping[fieldKey];
  const { isOver, setNodeRef } = useDroppable({
    id: `target-${fieldKey}`
  });

  return (
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
          <span className="truncate text-sm">{headers[mappedIndex]}</span>
          <button
            type="button"
            onClick={() => onRemove(fieldKey)}
            className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
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

function FieldGroupRow({
  group,
  mapping,
  headers,
  onRemove
}: {
  group: FieldGroup;
  mapping: ColumnMapping;
  headers: string[];
  onRemove: (key: keyof ColumnMapping) => void;
}) {
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
    email1Label: null,
    email1Value: null,
    email2Label: null,
    email2Value: null,
    phone1Label: null,
    phone1Value: null,
    phone2Label: null,
    phone2Value: null,
    phone3Label: null,
    phone3Value: null,
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
            {BASIC_FIELDS.map((field) => (
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

        <div>
          <h3 className="mb-2 font-medium">Email</h3>
          <div className="mb-2 flex items-center gap-3">
            <span className="w-20 shrink-0" />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <span className="text-muted-foreground text-xs">Label</span>
              <span className="text-muted-foreground text-xs">Value</span>
            </div>
          </div>
          <div className="space-y-2">
            {EMAIL_FIELDS.map((group) => (
              <FieldGroupRow
                key={group.name}
                group={group}
                mapping={mapping}
                headers={data.headers}
                onRemove={handleRemoveMapping}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-medium">Phone</h3>
          <div className="mb-2 flex items-center gap-3">
            <span className="w-20 shrink-0" />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <span className="text-muted-foreground text-xs">Label</span>
              <span className="text-muted-foreground text-xs">Value</span>
            </div>
          </div>
          <div className="space-y-2">
            {PHONE_FIELDS.map((group) => (
              <FieldGroupRow
                key={group.name}
                group={group}
                mapping={mapping}
                headers={data.headers}
                onRemove={handleRemoveMapping}
              />
            ))}
          </div>
        </div>

        {data.rows.length > 0 &&
          (() => {
            const mappedFields = ALL_PREVIEW_FIELDS.filter(
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
