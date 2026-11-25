import type { DocumentRow } from "@tearleads/client-sdk";
import {
  MiniAppField,
  MiniAppSelect,
} from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "./DocumentRowDetail";
import {
  emptyRowLogCells,
  getRowLogFieldIssue,
  isRowLogEntryComplete,
  type RowLogColumn,
  type RowLogDefinition,
  type RowLogField,
  rowLogCell,
} from "./rowLogModel";
import { TrackerInputField, TrackerRowActions } from "./TrackerFormControls";
import { TrackerQuickAdd } from "./TrackerQuickAdd";
import { TrackerReadCard } from "./TrackerReadCard";
import {
  type ReadTrackerRowCell,
  readTrackerRowCell,
  type TrackerRow,
  trackerDetailFields,
  trackerRowMetadata,
} from "./trackerRows";
import { TRACKER_ABSENT_VALUE } from "./trackerValues";
import type { AddTrackerRow } from "./useSavedTrackerRows";

/** A row in the log: shared row metadata and its cells by field key. */
export interface RowLogEntry extends TrackerRow {
  readonly cells: Readonly<Record<string, string>>;
}

/** Fold the store's generic rows into log entries, through the edit overlay. */
export function toRowLogEntries(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadTrackerRowCell,
  fields: ReadonlyArray<RowLogField>,
): RowLogEntry[] {
  return rows.map((row) => ({
    ...trackerRowMetadata(row),
    cells: Object.fromEntries(
      fields.map((field) => [
        field.key,
        readTrackerRowCell(row, readCell, field.key),
      ]),
    ),
  }));
}

/** Each cell's value and its last verified writer, for a row's details. */
export function rowLogDetailFields(
  definition: RowLogDefinition,
  entry: RowLogEntry,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  return trackerDetailFields(
    entry,
    definition.fields.map((field) => ({
      field: field.key,
      label: field.label,
      value: (row: RowLogEntry) => rowLogCell(row.cells, field.key),
    })),
    resolveRowWriter,
  );
}

const INPUT_TYPES = {
  date: "date",
  "datetime-local": "datetime-local",
  decimal: "text",
  text: "text",
} as const;

function RowLogFieldControl(params: {
  ariaLabel: string;
  disabled: boolean;
  field: RowLogField;
  onChange: (value: string) => void;
  value: string;
}) {
  const { ariaLabel, disabled, field, onChange, value } = params;
  if (field.input === "select") {
    return (
      <MiniAppField className="tracker-entry-field">
        <span>{field.label}</span>
        <MiniAppSelect
          aria-label={ariaLabel}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </MiniAppSelect>
      </MiniAppField>
    );
  }

  return (
    <TrackerInputField
      aria-invalid={getRowLogFieldIssue(field, value) ? "true" : undefined}
      aria-label={ariaLabel}
      autoComplete="off"
      disabled={disabled}
      inputMode={field.input === "decimal" ? "decimal" : undefined}
      label={field.label}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder}
      type={INPUT_TYPES[field.input]}
      value={value}
    />
  );
}

/** One saved row being edited: every cell, plus Save and Remove. */
export function RowLogEditRow(params: {
  controlsDisabled: boolean;
  definition: RowLogDefinition;
  entry: RowLogEntry;
  index: number;
  onRemove: (id: string) => void;
  onSave: () => void;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  const { controlsDisabled, definition, entry, index } = params;
  const name = `${definition.entryLabel} ${index + 1}`;
  return (
    <div className="row-log-entry tracker-edit-row">
      {definition.fields.map((field) => (
        <RowLogFieldControl
          key={field.key}
          ariaLabel={`${name} ${field.label.toLowerCase()}`}
          disabled={controlsDisabled}
          field={field}
          onChange={(value) => params.onUpdate(entry.id, field.key, value)}
          value={rowLogCell(entry.cells, field.key)}
        />
      ))}
      <TrackerRowActions
        disabled={controlsDisabled}
        onRemove={() => params.onRemove(entry.id)}
        onSave={params.onSave}
        removeAriaLabel={`Remove ${name.toLowerCase()}`}
        saveAriaLabel={`Save ${name.toLowerCase()}`}
      />
    </div>
  );
}

/** The form that adds a row, seeded by the definition from earlier rows. */
export function RowLogQuickAdd(params: {
  controlsDisabled: boolean;
  definition: RowLogDefinition;
  entries: ReadonlyArray<RowLogEntry>;
  onAddRow: AddTrackerRow<Record<string, string>>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { controlsDisabled, definition } = params;
  const emptyCells = emptyRowLogCells(definition.fields);
  return (
    <TrackerQuickAdd<Record<string, string>>
      addLabel={definition.addLabel}
      className="row-log-entry"
      controlsDisabled={controlsDisabled}
      createEntry={() => ({
        ...emptyCells,
        ...definition.createEntry(params.entries.map((entry) => entry.cells)),
      })}
      emptyEntry={emptyCells}
      isValid={(cells) => isRowLogEntryComplete(definition.fields, cells)}
      onAddEntry={params.onAddRow}
      onPendingChange={params.onPendingChange}
      renderFields={(cells, onChange) =>
        definition.fields.map((field) => (
          <RowLogFieldControl
            key={field.key}
            ariaLabel={`New ${definition.entryLabel.toLowerCase()} ${field.label.toLowerCase()}`}
            disabled={controlsDisabled}
            field={field}
            onChange={(value) => onChange(field.key, value)}
            value={rowLogCell(cells, field.key)}
          />
        ))
      }
      saveLabel={definition.saveLabel}
    />
  );
}

/** A saved row while the document is being edited, reopened by its Edit. */
export function RowLogSavedCard(params: {
  currentAuthorId: string | null;
  definition: RowLogDefinition;
  entry: RowLogEntry;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { definition, entry, index } = params;
  const name = `${definition.entryLabel} ${index + 1}`;
  // The card shows the columns a phone fold leads with.
  const primaryColumns: ReadonlyArray<RowLogColumn> = definition.columns.filter(
    (column) => column.fold === "primary",
  );
  return (
    <TrackerReadCard
      actionsAriaLabel={`${name} actions`}
      cells={primaryColumns.map((column) => ({
        label: column.header,
        text: column.text(entry.cells) || TRACKER_ABSENT_VALUE,
      }))}
      className={
        primaryColumns.length === 2 ? "tracker-read-row--two-cells" : undefined
      }
      currentAuthorId={params.currentAuthorId}
      detailFields={rowLogDetailFields(
        definition,
        entry,
        params.resolveRowWriter,
      )}
      detailLabel="Details"
      detailTitle={name}
      directAriaLabel={`${name} details`}
      index={index}
      onEnterEdit={params.onEnterEdit}
      resolveRowWriter={params.resolveRowWriter}
      row={entry}
    />
  );
}
