import { useId } from "react";
import { MiniAppSelect } from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentField,
} from "../shared/StructuredDocument";
import { TrackerDocument } from "../shared/TrackerDocument";
import { TrackerNameEditFields } from "../shared/TrackerNameEditFields";
import { readStructuredTrackerField } from "../shared/trackerRows";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import { type UpdateEntry, WeightEntryEditRow } from "./WeightEditRow";
import { WeightQuickAdd, type WeightQuickEntry } from "./WeightQuickAdd";
import { WeightEntryReadRow } from "./WeightReadRow";
import { WeightReadTable } from "./WeightReadTable";
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
  readTrackerUnitField,
  toWeightEntryRows,
  type WeightEntryRow,
} from "./weightEntries";
import "./Weight.css";

interface WeightFieldsProps {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  editingEntryId?: string | null | undefined;
  entries: ReadonlyArray<WeightEntryRow>;
  isEditing?: boolean | undefined;
  onAddEntry: AddTrackerRow<WeightQuickEntry>;
  onChangeUnit: (unit: WeightUnit) => void;
  onEnterEdit?: ((id: string) => void) | undefined;
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
}

function WeightUnitEditField(params: {
  controlsDisabled: boolean;
  onChangeUnit: (unit: WeightUnit) => void;
  unit: WeightUnit;
  unitInputId: string;
}) {
  return (
    <StructuredDocumentField
      inputId={params.unitInputId}
      label="New Entry Unit"
    >
      <MiniAppSelect
        id={params.unitInputId}
        aria-label="New entry unit"
        value={params.unit}
        onChange={(event) =>
          params.onChangeUnit(toWeightUnit(event.target.value))
        }
        disabled={params.controlsDisabled}
      >
        {WEIGHT_UNITS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </MiniAppSelect>
    </StructuredDocumentField>
  );
}

export function WeightFields(params: WeightFieldsProps) {
  return (
    <TrackerDocument
      currentAuthorId={params.currentAuthorId ?? null}
      disabled={params.disabled ?? false}
      editingRowId={params.editingEntryId ?? null}
      editActionId="weight-toggle-edit"
      emptyLabel="No entries"
      isEditing={params.isEditing ?? true}
      listLabel="Entries"
      onAddRow={params.onAddEntry}
      onEnterEdit={params.onEnterEdit}
      onToggleEditing={params.onToggleEditing}
      ready={params.ready}
      renderEditFields={(controlsDisabled) => (
        <TrackerNameEditFields
          ariaLabel="Weight tracker name"
          controlsDisabled={controlsDisabled}
          inputId={params.trackerNameInputId}
          label="Tracker Name"
          onRename={params.onRenameTracker}
          placeholder="Morning weigh-ins"
          ready={params.ready}
          value={params.trackerName}
        >
          <WeightUnitEditField
            controlsDisabled={controlsDisabled}
            onChangeUnit={params.onChangeUnit}
            unit={params.unit}
            unitInputId={params.unitInputId}
          />
        </TrackerNameEditFields>
      )}
      renderEditRow={(entry, index, context) => (
        <WeightEntryEditRow
          controlsDisabled={context.controlsDisabled}
          entry={entry}
          index={index}
          onRemoveEntry={params.onRemoveEntry}
          onSaveEntry={context.onSave}
          onUpdateEntry={params.onUpdateEntry}
        />
      )}
      renderQuickAdd={(context) => (
        <WeightQuickAdd
          controlsDisabled={context.controlsDisabled}
          onAddEntry={context.onAddRow}
          onPendingChange={context.onPendingChange}
          unit={params.unit}
        />
      )}
      renderReadRow={(entry, index, rows, context) => (
        <WeightEntryReadRow
          currentAuthorId={context.currentAuthorId}
          entry={entry}
          index={index}
          onEnterEdit={context.onEnterEdit}
          previous={rows[index - 1]}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      renderReadTable={(context) => (
        <WeightReadTable
          currentAuthorId={context.currentAuthorId}
          entries={params.entries}
          onEnterEdit={context.onEnterEdit}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      resolveRowWriter={params.resolveRowWriter}
      rows={params.entries}
    />
  );
}

export function Weight(params: { initialEditing?: boolean | undefined }) {
  const tracker = useTrackerDocument(params.initialEditing);
  const trackerName = readStructuredTrackerField(
    tracker.structuredFields,
    WEIGHT_TRACKER_NAME_FIELD,
  );
  const unit = readTrackerUnitField(tracker.structuredFields);
  const entries = toWeightEntryRows(tracker.rows, tracker.readCell, unit);
  const trackerNameInputId = useId();
  const unitInputId = useId();

  return (
    <StructuredDocument
      fields={
        <WeightFields
          currentAuthorId={tracker.currentAuthorId}
          disabled={!tracker.ready || !tracker.canWrite}
          editingEntryId={tracker.editingRowId}
          entries={entries}
          isEditing={tracker.isEditing && tracker.canWrite}
          onAddEntry={(entry) =>
            tracker.addRow({
              [WEIGHT_MEASUREMENT_FIELD]: entry.weight,
              [WEIGHT_UNIT_FIELD]: unit,
              [WEIGHT_MEASURED_AT_FIELD]: entry.measuredAt,
              [WEIGHT_NOTES_FIELD]: entry.notes,
            })
          }
          onChangeUnit={(nextUnit) =>
            tracker.setFields(WEIGHT_DOCUMENT_KIND, {
              [WEIGHT_UNIT_FIELD]: nextUnit,
            })
          }
          onEnterEdit={tracker.enterRowEdit}
          onRemoveEntry={tracker.removeRow}
          onRenameTracker={(value) =>
            tracker.setFields(WEIGHT_DOCUMENT_KIND, {
              [WEIGHT_TRACKER_NAME_FIELD]: value,
            })
          }
          onToggleEditing={tracker.toggleEditing}
          onUpdateEntry={tracker.updateRow}
          ready={tracker.ready}
          resolveRowWriter={tracker.resolveRowWriter}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
          unit={unit}
          unitInputId={unitInputId}
        />
      }
    />
  );
}
