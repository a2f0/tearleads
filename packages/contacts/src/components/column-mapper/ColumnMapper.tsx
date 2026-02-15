import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent
} from '@dnd-kit/core';
import { isRecord } from '@tearleads/shared';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { useMemo, useState } from 'react';
import { useContactsContext, useContactsUI } from '../../context';
import type { ColumnMapping, ParsedCSV } from '../../hooks/useContactsImport';
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
  const { Button } = useContactsUI();
  const { t } = useContactsContext();
  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    autoMapColumns(data.headers)
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const headerItems = useMemo(() => {
    const counts = new Map<string, number>();
    return data.headers.map((header, index) => {
      const count = counts.get(header) ?? 0;
      counts.set(header, count + 1);
      return {
        id: `${header}-${count}`,
        header,
        index
      };
    });
  }, [data.headers]);

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

  const activeColumnIndex = activeId
    ? Number.parseInt(activeId.replace('column-', ''), 10)
    : null;
  const activeHeader =
    activeColumnIndex !== null ? data.headers[activeColumnIndex] : null;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6">
        <div>
          <h3 className="mb-2 font-medium">{t('csvColumns')}</h3>
          <p className="mb-3 text-muted-foreground text-sm">
            {t('dragColumnHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            {headerItems.map((item) => (
              <DraggableColumn
                key={item.id}
                index={item.index}
                header={item.header}
                disabled={mappedIndices.has(item.index)}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-medium">{t('contactFields')}</h3>
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
          <h3 className="mb-2 font-medium">{t('email')}</h3>
          <div className="mb-2 flex items-center gap-3">
            <span className="w-20 shrink-0" />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <span className="text-muted-foreground text-xs">
                {t('label')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('value')}
              </span>
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
          <h3 className="mb-2 font-medium">{t('phone')}</h3>
          <div className="mb-2 flex items-center gap-3">
            <span className="w-20 shrink-0" />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <span className="text-muted-foreground text-xs">
                {t('label')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('value')}
              </span>
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
                <h3 className="mb-2 font-medium">{t('previewFirstRows')}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className={`${WINDOW_TABLE_TYPOGRAPHY.table} text-sm`}>
                    <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                      <tr>
                        {mappedFields.map((field) => (
                          <th
                            key={field.key}
                            className={WINDOW_TABLE_TYPOGRAPHY.headerCell}
                          >
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.slice(0, 3).map((row, index) => (
                        <WindowTableRow
                          key={`${index}-${row.join('|')}`}
                          className="cursor-default border-t border-b-0 hover:bg-transparent"
                        >
                          {mappedFields.map((field) => {
                            const mappedIndex = mapping[field.key];
                            return (
                              <td
                                key={field.key}
                                className={WINDOW_TABLE_TYPOGRAPHY.cell}
                              >
                                {mappedIndex === null
                                  ? '-'
                                  : row[mappedIndex] || '-'}
                              </td>
                            );
                          })}
                        </WindowTableRow>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-muted-foreground text-sm">
                  {t('totalRows').replace(
                    '{{count}}',
                    String(data.rows.length)
                  )}
                </p>
              </div>
            );
          })()}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={importing}>
            {t('cancel')}
          </Button>
          <Button onClick={handleImport} disabled={!canImport || importing}>
            {importing
              ? t('importing').replace('{{progress}}', '...')
              : t('importContacts').replace(
                  '{{count}}',
                  String(data.rows.length)
                )}
          </Button>
        </div>
      </div>

      <DragOverlay>
        {activeHeader ? <ColumnChip header={activeHeader} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
