import { type ReactNode, useCallback } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  RowLogEditRow,
  type RowLogEntry,
  RowLogQuickAdd,
  RowLogSavedCard,
  rowLogDetailFields,
  toRowLogEntries,
} from "./RowLogControls";
import type { RowLogColumn, RowLogDefinition } from "./rowLogModel";
import { TrackerDocument } from "./TrackerDocument";
import { TrackerIndexTable } from "./TrackerIndexTable";
import type { TrackerReadColumn } from "./TrackerReadTable";
import {
  type TrackerIndexRow,
  trackerOrdinalColumn,
  trackerUpdatedColumn,
} from "./trackerIndexColumns";
import {
  compareTrackerNumbers,
  compareTrackerText,
  TRACKER_ABSENT_VALUE,
} from "./trackerValues";
import type { useTrackerDocument } from "./useTrackerDocument";
import "./RowLogDocument.css";

type RowLogTracker = ReturnType<typeof useTrackerDocument>;
type RowLogIndexRow = TrackerIndexRow<RowLogEntry>;

function compareColumn(
  column: RowLogColumn,
): ((left: RowLogIndexRow, right: RowLogIndexRow) => number) | undefined {
  const { sort } = column;
  if (!sort) return undefined;
  const compare =
    sort.by === "number" ? compareTrackerNumbers : compareTrackerText;
  return (left, right) =>
    compare(sort.value(left.entry.cells), sort.value(right.entry.cells));
}

function toTrackerColumn(
  column: RowLogColumn,
): TrackerReadColumn<RowLogIndexRow> {
  return {
    cell: (row) => {
      const text = column.text(row.entry.cells);
      return {
        text: text.length > 0 ? text : TRACKER_ABSENT_VALUE,
        unranked: text.length === 0,
        ...(text.length > 0 ? { title: text } : {}),
      };
    },
    compare: compareColumn(column),
    fold: column.fold,
    header: column.header,
    hideable: column.hideable,
    id: column.id,
    monospace: column.monospace,
    muted: column.muted,
    width: column.width,
  };
}

function buildRowLogRows(
  entries: ReadonlyArray<RowLogEntry>,
): RowLogIndexRow[] {
  return entries.map((entry, index) => ({ entry, index }));
}

function RowLogReadTable(params: {
  currentAuthorId: string | null;
  definition: RowLogDefinition;
  entries: ReadonlyArray<RowLogEntry>;
  onEnterEdit?: ((id: string) => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { definition } = params;
  const getColumns = useCallback(
    (context: {
      currentAuthorId: string | null;
      resolveRowWriter?: RowWriterResolver | undefined;
    }) => [
      trackerOrdinalColumn<RowLogEntry>(`${definition.entryLabel} order`),
      ...definition.columns.map(toTrackerColumn),
      trackerUpdatedColumn<RowLogEntry>(context),
    ],
    [definition],
  );
  const detailFields = useCallback(
    (entry: RowLogEntry, resolveRowWriter?: RowWriterResolver | undefined) =>
      rowLogDetailFields(definition, entry, resolveRowWriter),
    [definition],
  );
  const name = (row: RowLogIndexRow) =>
    `${definition.entryLabel} ${row.index + 1}`;

  return (
    <TrackerIndexTable
      actionsAriaLabel={(row) => `${name(row)} actions`}
      ariaLabel={definition.listLabel}
      buildRows={buildRowLogRows}
      columnStorageKey={`${definition.storageKey}:hidden-columns:v1`}
      columnWidthsStorageKey={`${definition.storageKey}:column-widths`}
      currentAuthorId={params.currentAuthorId}
      detailFields={detailFields}
      detailLabel="Details"
      detailTitle={name}
      directAriaLabel={(row) => `${name(row)} details`}
      emptyLabel={definition.emptyLabel}
      entries={params.entries}
      getColumns={getColumns}
      onEnterEdit={params.onEnterEdit}
      resolveRowWriter={params.resolveRowWriter}
      sortMenuLabel={`Sort ${definition.listLabel.toLowerCase()}`}
    />
  );
}

/**
 * A structured document whose body is its own fields plus a dated row log,
 * sharing one edit mode: the tracker shell's, so a row can be targeted for
 * editing from the read table.
 */
export function RowLogDocument(params: {
  definition: RowLogDefinition;
  editActionId: string;
  /** The document's own fields in read mode, shown above the log. */
  readSummary: ReactNode;
  /** The document's own fields in edit mode, shown above the log. */
  renderEditFields: (controlsDisabled: boolean) => ReactNode;
  tracker: RowLogTracker;
}) {
  const { definition, tracker } = params;
  const entries = toRowLogEntries(
    tracker.rows,
    tracker.readCell,
    definition.fields,
  );

  return (
    <TrackerDocument
      currentAuthorId={tracker.currentAuthorId}
      disabled={!tracker.ready || !tracker.canWrite}
      editActionId={params.editActionId}
      editingRowId={tracker.editingRowId}
      emptyLabel={definition.emptyLabel}
      isEditing={tracker.isEditing && tracker.canWrite}
      listLabel={definition.listLabel}
      onAddRow={(cells: Readonly<Record<string, string>>) =>
        tracker.addRow(cells)
      }
      onEnterEdit={tracker.enterRowEdit}
      onToggleEditing={tracker.toggleEditing}
      readSummary={params.readSummary}
      ready={tracker.ready}
      renderEditFields={params.renderEditFields}
      renderEditRow={(entry, index, context) => (
        <RowLogEditRow
          controlsDisabled={context.controlsDisabled}
          definition={definition}
          entry={entry}
          index={index}
          onRemove={tracker.removeRow}
          onSave={context.onSave}
          onUpdate={tracker.updateRow}
        />
      )}
      renderQuickAdd={(context) => (
        <RowLogQuickAdd
          controlsDisabled={context.controlsDisabled}
          definition={definition}
          entries={entries}
          onAddRow={context.onAddRow}
          onPendingChange={context.onPendingChange}
        />
      )}
      renderReadRow={(entry, index, _rows, context) => (
        <RowLogSavedCard
          currentAuthorId={context.currentAuthorId}
          definition={definition}
          entry={entry}
          index={index}
          onEnterEdit={context.onEnterEdit}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      renderReadTable={(context) => (
        <RowLogReadTable
          currentAuthorId={context.currentAuthorId}
          definition={definition}
          entries={entries}
          onEnterEdit={context.onEnterEdit}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      resolveRowWriter={tracker.resolveRowWriter}
      rows={entries}
    />
  );
}
