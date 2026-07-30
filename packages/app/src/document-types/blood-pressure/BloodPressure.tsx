import { useCallback, useId } from "react";
import { MiniAppInput } from "../../components/mini-app/MiniAppLayout";
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
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  readTrackerNameField,
  toBloodPressureReadingRows,
} from "./bloodPressureReadings";
import "./BloodPressure.css";

function BloodPressureReadFields(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entryPending: boolean;
  onAddReading: AddTrackerRow<BloodPressureQuickReading>;
  onEnterEdit?: (() => void) | undefined;
  onPendingChange: (pending: boolean) => void;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const {
    currentAuthorId,
    controlsDisabled,
    entryPending,
    onAddReading,
    onEnterEdit,
    onPendingChange,
    readings,
    resolveRowWriter,
  } = params;

  return (
    <div className="tracker-document-fields">
      <section className="blood-pressure-reading-list tracker-entry-list">
        <strong>Readings</strong>
        {onEnterEdit ? (
          <BloodPressureQuickAdd
            controlsDisabled={controlsDisabled}
            onAddReading={onAddReading}
            onPendingChange={onPendingChange}
          />
        ) : null}
        {/* A reading being typed into the expanded quick-add form is the whole
            of the list's business until it is saved, so the (empty) table stays
            out of the way rather than heading it with a "no readings" row. */}
        {readings.length === 0 && entryPending ? null : (
          <BloodPressureReadTable
            currentAuthorId={currentAuthorId}
            onEnterEdit={entryPending ? undefined : onEnterEdit}
            readings={readings}
            resolveRowWriter={resolveRowWriter}
          />
        )}
        <div className="blood-pressure-reading-list-footer tracker-entry-list-footer">
          {readings.length} entries
        </div>
      </section>
    </div>
  );
}

function BloodPressureEditFields(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entryPending: boolean;
  onAddReading: AddTrackerRow<BloodPressureQuickReading>;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
}) {
  const {
    currentAuthorId,
    controlsDisabled,
    entryPending,
    onAddReading,
    onRemoveReading,
    onRenameTracker,
    onPendingChange,
    onUpdateReading,
    readings,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
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
            aria-label="Blood pressure tracker name"
            value={trackerName}
            onChange={(event) => onRenameTracker(event.target.value)}
            placeholder={ready ? "Morning readings" : "Loading..."}
            disabled={controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <section className="blood-pressure-reading-list tracker-entry-list">
        <strong>Readings</strong>
        <BloodPressureQuickAdd
          controlsDisabled={controlsDisabled}
          onAddReading={(reading) => {
            const addedRow = onAddReading(reading);
            void saveAddedRow(addedRow);
            return addedRow;
          }}
          onPendingChange={onPendingChange}
        />
        {readings.length === 0 && !entryPending ? (
          <div className="tracker-empty-state">No readings</div>
        ) : null}
        <BloodPressureEditRows
          currentAuthorId={currentAuthorId}
          controlsDisabled={controlsDisabled}
          onRemoveReading={onRemoveReading}
          onUpdateReading={onUpdateReading}
          readings={readings}
          resolveRowWriter={resolveRowWriter}
          savedRowIds={savedRowIds}
          setRowSaved={setRowSaved}
        />
        <div className="blood-pressure-reading-list-footer tracker-entry-list-footer">
          {readings.length} entries
        </div>
      </section>
    </div>
  );
}

function BloodPressureEditRows(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  onRemoveReading: (id: string) => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
  savedRowIds: ReadonlySet<string>;
  setRowSaved: (id: string, saved: boolean) => void;
}) {
  return params.readings.map((reading, index) =>
    params.savedRowIds.has(reading.id) ? (
      <BloodPressureReadingReadRow
        key={reading.id}
        currentAuthorId={params.currentAuthorId}
        index={index}
        onEnterEdit={() => params.setRowSaved(reading.id, false)}
        reading={reading}
        resolveRowWriter={params.resolveRowWriter}
      />
    ) : (
      <BloodPressureReadingEditRow
        key={reading.id}
        controlsDisabled={params.controlsDisabled}
        index={index}
        onRemoveReading={params.onRemoveReading}
        onSaveReading={(id) => params.setRowSaved(id, true)}
        onUpdateReading={params.onUpdateReading}
        reading={reading}
      />
    ),
  );
}

export function BloodPressureFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  isEditing?: boolean | undefined;
  onAddReading: AddTrackerRow<BloodPressureQuickReading>;
  onEnterEdit?: (() => void) | undefined;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
}) {
  const {
    currentAuthorId = null,
    disabled = false,
    isEditing = true,
    onAddReading,
    onEnterEdit,
    onRemoveReading,
    onRenameTracker,
    onToggleEditing,
    onUpdateReading,
    readings,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
  } = params;
  const controlsDisabled = disabled || !ready;
  const {
    entryPending: newReadingPending,
    onPendingChange,
    toggleEditing,
  } = usePendingTrackerEntry(onToggleEditing);
  useStructuredDocumentEditAction({
    disabled: controlsDisabled || newReadingPending,
    editingLabel: "Save",
    id: "blood-pressure-toggle-edit",
    isEditing,
    onToggleEditing: toggleEditing,
  });

  if (!isEditing) {
    return (
      <BloodPressureReadFields
        currentAuthorId={currentAuthorId}
        controlsDisabled={controlsDisabled}
        entryPending={newReadingPending}
        onAddReading={onAddReading}
        onEnterEdit={onEnterEdit}
        onPendingChange={onPendingChange}
        readings={readings}
        resolveRowWriter={resolveRowWriter}
      />
    );
  }

  return (
    <BloodPressureEditFields
      currentAuthorId={currentAuthorId}
      controlsDisabled={controlsDisabled}
      entryPending={newReadingPending}
      onAddReading={onAddReading}
      onRemoveReading={onRemoveReading}
      onRenameTracker={onRenameTracker}
      onPendingChange={onPendingChange}
      onUpdateReading={onUpdateReading}
      readings={readings}
      ready={ready}
      resolveRowWriter={resolveRowWriter}
      trackerName={trackerName}
      trackerNameInputId={trackerNameInputId}
    />
  );
}

export function BloodPressure(params: {
  initialEditing?: boolean | undefined;
}) {
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
  const readings = toBloodPressureReadingRows(rows, readCell);

  function handleUpdateReading(
    id: string,
    field: BloodPressureField,
    value: string,
  ) {
    stageCell(id, field, value);
    if (canWrite) {
      void updateRowFields(id, { [field]: value });
    }
  }

  return (
    <StructuredDocument
      fields={
        <BloodPressureFields
          currentAuthorId={currentAuthorId}
          disabled={!ready || !canWrite}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          // The read-row "Edit" action switches the whole tracker into edit
          // mode; only offer it when the viewer can actually write.
          onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
          onAddReading={(reading) => {
            if (canWrite) {
              return addRow({
                [BLOOD_PRESSURE_SYSTOLIC_FIELD]: reading.systolic,
                [BLOOD_PRESSURE_DIASTOLIC_FIELD]: reading.diastolic,
                [BLOOD_PRESSURE_PULSE_FIELD]: reading.pulse,
                [BLOOD_PRESSURE_MEASURED_AT_FIELD]: reading.measuredAt,
                [BLOOD_PRESSURE_NOTES_FIELD]: reading.notes,
              });
            }
            return Promise.resolve(null);
          }}
          onRemoveReading={(id) => {
            if (canWrite) {
              void removeRow(id);
            }
            clearRow(id);
          }}
          onRenameTracker={(value) => {
            if (canWrite) {
              void setStructuredFields(BLOOD_PRESSURE_DOCUMENT_KIND, {
                trackerName: value,
              });
            }
          }}
          onToggleEditing={toggleEditing}
          onUpdateReading={handleUpdateReading}
          readings={readings}
          ready={ready}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
        />
      }
    />
  );
}
