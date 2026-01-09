import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent
} from '@dnd-kit/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ColumnMapping, ParsedCSV } from '@/hooks/useContactsImport';
import { ColumnChip } from './ColumnChip';
import {
  ALL_PREVIEW_FIELDS,
  BASIC_FIELDS,
  EMAIL_FIELDS,
  GOOGLE_CONTACTS_HEADER_MAP,
  INITIAL_COLUMN_MAPPING,
  PHONE_FIELDS
} from './constants';
import { DraggableColumn } from './DraggableColumn';
import { DropZone } from './DropZone';
import { FieldGroupRow } from './FieldGroupRow';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isColumnKey(value: string): value is keyof ColumnMapping {
  return Object.hasOwn(INITIAL_COLUMN_MAPPING, value);
}

function getDragIndex(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const index = value['index'];
  return typeof index === 'number' && Number.isFinite(index) ? index : null;
}

/**
 * Auto-detect and map CSV columns based on header names.
 * Supports Google Contacts CSV export format.
 */
function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping = { ...INITIAL_COLUMN_MAPPING };

  headers.forEach((header, index) => {
    const fieldKey = GOOGLE_CONTACTS_HEADER_MAP[header];
    if (fieldKey) {
      mapping[fieldKey] = index;
    }
  });

  return mapping;
}

interface ColumnMapperProps {
  data: ParsedCSV;
  onImport: (mapping: ColumnMapping) => void;
  onCancel: () => void;
  importing: boolean;
}

export function ColumnMapper({
  data,
  onImport,
  onCancel,
  importing
}: ColumnMapperProps) {
  // Auto-map columns on initial render based on header names (Google Contacts format)
  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    autoMapColumns(data.headers)
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  // Get which column indices are already mapped
  const mappedIndices = new Set(
    Object.values(mapping).filter((v): v is number => v !== null)
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);

    const { active, over } = event;
    if (!over) return;

    const targetId = String(over.id);
    if (!targetId.startsWith('target-')) return;

    const fieldKey = targetId.replace('target-', '');
    if (!isColumnKey(fieldKey)) return;
    const columnIndex = getDragIndex(active.data.current);
    if (columnIndex === null) return;

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
                          {mappedFields.map((field) => {
                            const mappedIndex = mapping[field.key];
                            return (
                              <td key={field.key} className="px-3 py-2">
                                {mappedIndex === null
                                  ? '-'
                                  : row[mappedIndex] || '-'}
                              </td>
                            );
                          })}
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
