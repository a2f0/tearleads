import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useCallback, useId } from "react";
import {
  MiniAppButton,
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
import { TrackerSaveAction } from "../shared/TrackerFormControls";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
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
  entries: ReadonlyArray<WeightEntryRow>;
  onAddEntry: (entry?: WeightQuickEntry) => void;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  unit: WeightUnit;
}) {
  // `unit` here is the tracker's default for new entries; each row renders its
  // own recorded unit.
  const {
    currentAuthorId,
    controlsDisabled,
    entries,
    onAddEntry,
    onEnterEdit,
    resolveRowWriter,
    unit,
  } = params;

  return (
    <div className="weight-document-fields tracker-document-fields">
      <section className="weight-entry-list tracker-entry-list">
        <div className="weight-entry-list-header tracker-entry-list-header">
          <strong>Entries</strong>
        </div>
        {onEnterEdit ? (
          <WeightQuickAdd
            controlsDisabled={controlsDisabled}
            onAddEntry={onAddEntry}
            unit={unit}
          />
        ) : null}
        {entries.length === 0 ? (
          <div className="weight-empty-state tracker-empty-state">
            No entries
          </div>
        ) : (
          entries.map((entry, index) => (
            <WeightEntryReadRow
              key={entry.id}
              currentAuthorId={currentAuthorId}
              entry={entry}
              index={index}
              onEnterEdit={onEnterEdit}
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
  controlsDisabled: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  onAddEntry: () => void;
  onChangeUnit: (unit: WeightUnit) => void;
  onRemoveEntry: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onSave: () => void;
  onUpdateEntry: UpdateEntry;
  ready: boolean;
  trackerName: string;
  trackerNameInputId: string;
  unit: WeightUnit;
  unitInputId: string;
}) {
  const {
    controlsDisabled,
    entries,
    onAddEntry,
    onChangeUnit,
    onRemoveEntry,
    onRenameTracker,
    onSave,
    onUpdateEntry,
    ready,
    trackerName,
    trackerNameInputId,
    unit,
    unitInputId,
  } = params;

  return (
    <div className="weight-document-fields tracker-document-fields">
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
        <div className="weight-entry-list-header tracker-entry-list-header">
          <div className="weight-entry-list-title">
            <strong>Entries</strong>
          </div>
          <MiniAppButton
            className="weight-add-button tracker-add-button"
            withIcon
            disabled={controlsDisabled}
            onClick={() => onAddEntry()}
          >
            <PlusIcon aria-hidden size={14} />
            Add Entry
          </MiniAppButton>
        </div>
        {entries.length === 0 ? (
          <div className="weight-empty-state tracker-empty-state">
            No entries
          </div>
        ) : (
          entries.map((entry, index) => (
            <WeightEntryEditRow
              key={entry.id}
              controlsDisabled={controlsDisabled}
              entry={entry}
              index={index}
              onRemoveEntry={onRemoveEntry}
              onUpdateEntry={onUpdateEntry}
            />
          ))
        )}
        <div className="weight-entry-list-footer tracker-entry-list-footer">
          {entries.length} entries
        </div>
        <TrackerSaveAction disabled={controlsDisabled} onSave={onSave} />
      </section>
    </div>
  );
}

export function WeightFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  entries: ReadonlyArray<WeightEntryRow>;
  isEditing?: boolean | undefined;
  onAddEntry: (entry?: WeightQuickEntry) => void;
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
  useStructuredDocumentEditAction({
    disabled: controlsDisabled,
    id: "weight-toggle-edit",
    isEditing,
    onToggleEditing,
  });

  if (!isEditing) {
    return (
      <WeightReadFields
        currentAuthorId={currentAuthorId}
        controlsDisabled={controlsDisabled}
        entries={entries}
        onAddEntry={onAddEntry}
        onEnterEdit={onEnterEdit}
        resolveRowWriter={resolveRowWriter}
        unit={unit}
      />
    );
  }

  return (
    <WeightEditFields
      controlsDisabled={controlsDisabled}
      entries={entries}
      onAddEntry={onAddEntry}
      onChangeUnit={onChangeUnit}
      onRemoveEntry={onRemoveEntry}
      onRenameTracker={onRenameTracker}
      onSave={onToggleEditing}
      onUpdateEntry={onUpdateEntry}
      ready={ready}
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
  // Only resolve verified writers for the read view (attribution is not shown
  // while editing) of a non-empty tracker.
  const resolveRowWriter = useDocumentRowWriters(
    !(isEditing && canWrite) && rows.length > 0,
  );

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
              void addRow({
                [WEIGHT_MEASUREMENT_FIELD]: entry?.weight ?? "",
                [WEIGHT_UNIT_FIELD]: unit,
                [WEIGHT_MEASURED_AT_FIELD]: entry?.measuredAt ?? "",
                [WEIGHT_NOTES_FIELD]: entry?.notes ?? "",
              });
            }
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
