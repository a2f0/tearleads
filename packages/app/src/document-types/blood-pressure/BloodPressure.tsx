import { useId } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { StructuredDocument } from "../shared/StructuredDocument";
import { TrackerDocument } from "../shared/TrackerDocument";
import { TrackerNameEditFields } from "../shared/TrackerNameEditFields";
import { readStructuredTrackerField } from "../shared/trackerRows";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import {
  BloodPressureReadingEditRow,
  type UpdateReading,
} from "./BloodPressureEditRow";
import {
  BloodPressureQuickAdd,
  type BloodPressureQuickReading,
} from "./BloodPressureQuickAdd";
import { BloodPressureReadingReadRow } from "./BloodPressureReadRow";
import { BloodPressureReadTable } from "./BloodPressureReadTable";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_DOCUMENT_KIND,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
  BLOOD_PRESSURE_TRACKER_NAME_FIELD,
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  toBloodPressureReadingRows,
} from "./bloodPressureReadings";
import "./BloodPressure.css";

interface BloodPressureFieldsProps {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  editingReadingId?: string | null | undefined;
  isEditing?: boolean | undefined;
  onAddReading: AddTrackerRow<BloodPressureQuickReading>;
  onEnterEdit?: ((id: string) => void) | undefined;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
}

export function BloodPressureFields(params: BloodPressureFieldsProps) {
  return (
    <TrackerDocument
      currentAuthorId={params.currentAuthorId ?? null}
      disabled={params.disabled ?? false}
      editingRowId={params.editingReadingId ?? null}
      editActionId="blood-pressure-toggle-edit"
      emptyLabel="No readings"
      isEditing={params.isEditing ?? true}
      listLabel="Readings"
      onAddRow={params.onAddReading}
      onEnterEdit={params.onEnterEdit}
      onToggleEditing={params.onToggleEditing}
      ready={params.ready}
      renderEditFields={(controlsDisabled) => (
        <TrackerNameEditFields
          ariaLabel="Blood pressure tracker name"
          controlsDisabled={controlsDisabled}
          inputId={params.trackerNameInputId}
          label="Tracker Name"
          onRename={params.onRenameTracker}
          placeholder="Morning readings"
          ready={params.ready}
          value={params.trackerName}
        />
      )}
      renderEditRow={(reading, index, context) => (
        <BloodPressureReadingEditRow
          controlsDisabled={context.controlsDisabled}
          index={index}
          onRemoveReading={params.onRemoveReading}
          onSaveReading={context.onSave}
          onUpdateReading={params.onUpdateReading}
          reading={reading}
        />
      )}
      renderQuickAdd={(context) => (
        <BloodPressureQuickAdd
          controlsDisabled={context.controlsDisabled}
          onAddReading={context.onAddRow}
          onPendingChange={context.onPendingChange}
        />
      )}
      renderReadRow={(reading, index, _rows, context) => (
        <BloodPressureReadingReadRow
          currentAuthorId={context.currentAuthorId}
          index={index}
          onEnterEdit={context.onEnterEdit}
          reading={reading}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      renderReadTable={(context) => (
        <BloodPressureReadTable
          currentAuthorId={context.currentAuthorId}
          onEnterEdit={context.onEnterEdit}
          readings={params.readings}
          resolveRowWriter={context.resolveRowWriter}
        />
      )}
      resolveRowWriter={params.resolveRowWriter}
      rows={params.readings}
    />
  );
}

export function BloodPressure(params: {
  initialEditing?: boolean | undefined;
}) {
  const tracker = useTrackerDocument(params.initialEditing);
  const trackerName = readStructuredTrackerField(
    tracker.structuredFields,
    BLOOD_PRESSURE_TRACKER_NAME_FIELD,
  );
  const readings = toBloodPressureReadingRows(tracker.rows, tracker.readCell);
  const trackerNameInputId = useId();

  return (
    <StructuredDocument
      fields={
        <BloodPressureFields
          currentAuthorId={tracker.currentAuthorId}
          disabled={!tracker.ready || !tracker.canWrite}
          editingReadingId={tracker.editingRowId}
          isEditing={tracker.isEditing && tracker.canWrite}
          onAddReading={(reading) =>
            tracker.addRow({
              [BLOOD_PRESSURE_SYSTOLIC_FIELD]: reading.systolic,
              [BLOOD_PRESSURE_DIASTOLIC_FIELD]: reading.diastolic,
              [BLOOD_PRESSURE_PULSE_FIELD]: reading.pulse,
              [BLOOD_PRESSURE_MEASURED_AT_FIELD]: reading.measuredAt,
              [BLOOD_PRESSURE_NOTES_FIELD]: reading.notes,
            })
          }
          onEnterEdit={tracker.enterRowEdit}
          onRemoveReading={tracker.removeRow}
          onRenameTracker={(value) =>
            tracker.setFields(BLOOD_PRESSURE_DOCUMENT_KIND, {
              [BLOOD_PRESSURE_TRACKER_NAME_FIELD]: value,
            })
          }
          onToggleEditing={tracker.toggleEditing}
          onUpdateReading={tracker.updateRow}
          readings={readings}
          ready={tracker.ready}
          resolveRowWriter={tracker.resolveRowWriter}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
        />
      }
    />
  );
}
