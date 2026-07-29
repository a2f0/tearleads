import { useCallback, useId } from "react";
import {
  MiniAppInput,
  MiniAppSelect,
} from "../../components/mini-app/MiniAppLayout";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  type RowWriterResolver,
  useDocumentRowWriters,
} from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import { usePendingTrackerEntry } from "../shared/usePendingTrackerEntry";
import {
  type AddTrackerRow,
  useSavedTrackerRows,
} from "../shared/useSavedTrackerRows";
import {
  type UpdateEntry,
  WeightEntryEditRow,
  type WeightField,
} from "./WeightEditRow";
import { WeightQuickAdd, type WeightQuickEntry } from "./WeightQuickAdd";
import { WeightEntryReadRow } from "./WeightReadRow";
import {
  toWeightUnit,
  WEIGHT_DOCUMENT_KIND,
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
  WEIGHT_TRACKER_NAME_FIELD,
  WEIGHT_UNIT_FIELD,
  WEIGHT_UNITS,
  type WeightUnit,
} from "./weightDocumentDefinition";
import {
  readTrackerNameField,
  readTrackerUnitField,
  toWeightEntryRows,
  type WeightEntryRow,
} from "./weightEntries";
import "./Weight.css";

function WeightReadFields(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entryPending: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  onAddEntry: AddTrackerRow<WeightQuickEntry>;
  onEnterEdit?: (() => void) | undefined;
  onPendingChange: (pending: boolean) => void;
  resolveRowWriter?: RowWriterResolver | undefined;
  unit: WeightUnit;
}) {
  // `unit` here is the tracker's default for new entries; each row renders its
  // own recorded unit.
  const {
    currentAuthorId,
    controlsDisabled,
    entryPending,
    entries,
    onAddEntry,
    onEnterEdit,
    onPendingChange,
    resolveRowWriter,
    unit,
  } = params;

  return (
    <div className="tracker-document-fields">
      <section className="weight-entry-list tracker-entry-list">
        <strong>Entries</strong>
        {onEnterEdit ? (
          <WeightQuickAdd
            controlsDisabled={controlsDisabled}
            onAddEntry={onAddEntry}
            onPendingChange={onPendingChange}
            unit={unit}
          />
        ) : null}
        {entries.length === 0 && !entryPending ? (
          <div className="tracker-empty-state">No entries</div>
        ) : (
          entries.map((entry, index) => (
            <WeightEntryReadRow
              key={entry.id}
              currentAuthorId={currentAuthorId}
              entry={entry}
              index={index}
              onEnterEdit={entryPending ? undefined : onEnterEdit}
              previous={entries[index - 1]}
              resolveRowWriter={resolveRowWriter}
            />
          ))
        )}
        <div className="weight-entry-list-footer tracker-entry-list-footer">
          {entries.length} entries
        </div>
      </section>
    </div>
  );
}

function WeightEditFields(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entryPending: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  onAddEntry: AddTrackerRow<WeightQuickEntry>;
  onChangeUnit: (unit: WeightUnit) => void;
  onRemoveEntry: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  onUpdateEntry: UpdateEntry;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
  unit: WeightUnit;
  unitInputId: string;
}) {
  const {
    currentAuthorId,
    controlsDisabled,
    entryPending,
    entries,
    onAddEntry,
    onChangeUnit,
    onRemoveEntry,
    onRenameTracker,
    onPendingChange,
    onUpdateEntry,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
    unit,
    unitInputId,
  } = params;
  const { saveAddedRow, savedRowIds, setRowSaved } = useSavedTrackerRows();

  return (
    <div className="tracker-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField
          inputId={trackerNameInputId}
          label="Tracker Name"
        >
          <MiniAppInput
            id={trackerNameInputId}
            aria-label="Weight tracker name"
            value={trackerName}
            onChange={(event) => onRenameTracker(event.target.value)}
            placeholder={ready ? "Morning weigh-ins" : "Loading..."}
            disabled={controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
        {/* Seeds new entries only. Each entry keeps the unit it was recorded
            in, so changing this never restates the weights already logged. */}
        <StructuredDocumentField inputId={unitInputId} label="New Entry Unit">
          <MiniAppSelect
            id={unitInputId}
            aria-label="New entry unit"
            value={unit}
            onChange={(event) => onChangeUnit(toWeightUnit(event.target.value))}
            disabled={controlsDisabled}
          >
            {WEIGHT_UNITS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </MiniAppSelect>
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <section className="weight-entry-list tracker-entry-list">
        <strong>Entries</strong>
        <WeightQuickAdd
          controlsDisabled={controlsDisabled}
          onAddEntry={(entry) => {
            const addedRow = onAddEntry(entry);
            void saveAddedRow(addedRow);
            return addedRow;
          }}
          onPendingChange={onPendingChange}
          unit={unit}
        />
        {entries.length === 0 && !entryPending ? (
          <div className="tracker-empty-state">No entries</div>
        ) : null}
        <WeightEditRows
          currentAuthorId={currentAuthorId}
          controlsDisabled={controlsDisabled}
          entries={entries}
          onRemoveEntry={onRemoveEntry}
          onUpdateEntry={onUpdateEntry}
          resolveRowWriter={resolveRowWriter}
          savedRowIds={savedRowIds}
          setRowSaved={setRowSaved}
        />
        <div className="weight-entry-list-footer tracker-entry-list-footer">
          {entries.length} entries
        </div>
      </section>
    </div>
  );
}

function WeightEditRows(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  onRemoveEntry: (id: string) => void;
  onUpdateEntry: UpdateEntry;
  resolveRowWriter?: RowWriterResolver | undefined;
  savedRowIds: ReadonlySet<string>;
  setRowSaved: (id: string, saved: boolean) => void;
}) {
  return params.entries.map((entry, index) =>
    params.savedRowIds.has(entry.id) ? (
      <WeightEntryReadRow
        key={entry.id}
        currentAuthorId={params.currentAuthorId}
        entry={entry}
        index={index}
        onEnterEdit={() => params.setRowSaved(entry.id, false)}
        previous={params.entries[index - 1]}
        resolveRowWriter={params.resolveRowWriter}
      />
    ) : (
      <WeightEntryEditRow
        key={entry.id}
        controlsDisabled={params.controlsDisabled}
        entry={entry}
        index={index}
        onRemoveEntry={params.onRemoveEntry}
        onSaveEntry={(id) => params.setRowSaved(id, true)}
        onUpdateEntry={params.onUpdateEntry}
      />
    ),
  );
}

export function WeightFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  entries: ReadonlyArray<WeightEntryRow>;
  isEditing?: boolean | undefined;
  onAddEntry: AddTrackerRow<WeightQuickEntry>;
  onChangeUnit: (unit: WeightUnit) => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveEntry: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateEntry: UpdateEntry;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
  unit: WeightUnit;
  unitInputId: string;
}) {
  const {
    currentAuthorId = null,
    disabled = false,
    entries,
    isEditing = true,
    onAddEntry,
    onChangeUnit,
    onEnterEdit,
    onRemoveEntry,
    onRenameTracker,
    onToggleEditing,
    onUpdateEntry,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
    unit,
    unitInputId,
  } = params;
  const controlsDisabled = disabled || !ready;
  const {
    entryPending: newEntryPending,
    onPendingChange,
    toggleEditing,
  } = usePendingTrackerEntry(onToggleEditing);
  useStructuredDocumentEditAction({
    disabled: controlsDisabled || newEntryPending,
    editingLabel: "Save",
    id: "weight-toggle-edit",
    isEditing,
    onToggleEditing: toggleEditing,
  });

  if (!isEditing) {
    return (
      <WeightReadFields
        currentAuthorId={currentAuthorId}
        controlsDisabled={controlsDisabled}
        entryPending={newEntryPending}
        entries={entries}
        onAddEntry={onAddEntry}
        onEnterEdit={onEnterEdit}
        onPendingChange={onPendingChange}
        resolveRowWriter={resolveRowWriter}
        unit={unit}
      />
    );
  }

  return (
    <WeightEditFields
      currentAuthorId={currentAuthorId}
      controlsDisabled={controlsDisabled}
      entryPending={newEntryPending}
      entries={entries}
      onAddEntry={onAddEntry}
      onChangeUnit={onChangeUnit}
      onRemoveEntry={onRemoveEntry}
      onRenameTracker={onRenameTracker}
      onPendingChange={onPendingChange}
      onUpdateEntry={onUpdateEntry}
      ready={ready}
      resolveRowWriter={resolveRowWriter}
      trackerName={trackerName}
      trackerNameInputId={trackerNameInputId}
      unit={unit}
      unitInputId={unitInputId}
    />
  );
}

export function Weight(params: { initialEditing?: boolean | undefined }) {
  const {
    addRow,
    canWrite,
    currentAuthorId,
    ready,
    removeRow,
    rows,
    setStructuredFields,
    structuredFields,
    updateRowFields,
  } = useDocument();
  const trackerNameInputId = useId();
  const unitInputId = useId();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  // Kept reference-stable so the toolbar action it feeds does not re-register
  // on every render.
  const toggleEditing = useCallback(
    () => setIsEditing((editing) => !editing),
    [setIsEditing],
  );
  const { clearRow, readCell, stageCell } = useDocumentRowEditing(rows);
  const resolveRowWriter = useDocumentRowWriters(rows.length > 0);

  const trackerName = readTrackerNameField(structuredFields);
  const unit = readTrackerUnitField(structuredFields);
  const entries = toWeightEntryRows(rows, readCell, unit);

  function handleUpdateEntry(id: string, field: WeightField, value: string) {
    stageCell(id, field, value);
    if (canWrite) {
      void updateRowFields(id, { [field]: value });
    }
  }

  return (
    <StructuredDocument
      fields={
        <WeightFields
          currentAuthorId={currentAuthorId}
          disabled={!ready || !canWrite}
          entries={entries}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          // The read-row "Edit" action switches the whole tracker into edit
          // mode; only offer it when the viewer can actually write.
          onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
          onAddEntry={(entry) => {
            if (canWrite) {
              return addRow({
                [WEIGHT_MEASUREMENT_FIELD]: entry.weight,
                [WEIGHT_UNIT_FIELD]: unit,
                [WEIGHT_MEASURED_AT_FIELD]: entry.measuredAt,
                [WEIGHT_NOTES_FIELD]: entry.notes,
              });
            }
            return Promise.resolve(null);
          }}
          onChangeUnit={(nextUnit) => {
            if (canWrite) {
              void setStructuredFields(WEIGHT_DOCUMENT_KIND, {
                [WEIGHT_UNIT_FIELD]: nextUnit,
              });
            }
          }}
          onRemoveEntry={(id) => {
            if (canWrite) {
              void removeRow(id);
            }
            clearRow(id);
          }}
          onRenameTracker={(value) => {
            if (canWrite) {
              void setStructuredFields(WEIGHT_DOCUMENT_KIND, {
                [WEIGHT_TRACKER_NAME_FIELD]: value,
              });
            }
          }}
          onToggleEditing={toggleEditing}
          onUpdateEntry={handleUpdateEntry}
          ready={ready}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
          unit={unit}
          unitInputId={unitInputId}
        />
      }
    />
  );
}
