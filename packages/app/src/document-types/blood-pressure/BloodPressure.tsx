import { useId } from "react";
import { MiniAppInput } from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { TrackerDocument } from "../shared/TrackerDocument";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import {
  type BloodPressureField,
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
  readTrackerNameField,
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

function BloodPressureEditFields(params: {
  controlsDisabled: boolean;
  onRenameTracker: (value: string) => void;
  ready: boolean;
  trackerName: string;
  trackerNameInputId: string;
}) {
  return (
    <StructuredDocumentFields>
      <StructuredDocumentField
        inputId={params.trackerNameInputId}
        label="Tracker Name"
      >
        <MiniAppInput
          id={params.trackerNameInputId}
          aria-label="Blood pressure tracker name"
          value={params.trackerName}
          onChange={(event) => params.onRenameTracker(event.target.value)}
          placeholder={params.ready ? "Morning readings" : "Loading..."}
          disabled={params.controlsDisabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
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
        <BloodPressureEditFields
          controlsDisabled={controlsDisabled}
          onRenameTracker={params.onRenameTracker}
          ready={params.ready}
          trackerName={params.trackerName}
          trackerNameInputId={params.trackerNameInputId}
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
  const trackerName = readTrackerNameField(tracker.structuredFields);
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
          onUpdateReading={(
            id: string,
            field: BloodPressureField,
            value: string,
          ) => tracker.updateRow(id, field, value)}
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
