import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  type RowWriterResolver,
  useDocumentRowWriters,
} from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import { BloodPressureReadingReadRow } from "./BloodPressureReadRow";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_DOCUMENT_KIND,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
  isValidBloodPressureMeasurement,
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  readTrackerNameField,
  toBloodPressureReadingRows,
} from "./bloodPressureReadings";
import "./BloodPressure.css";

type BloodPressureField =
  | typeof BLOOD_PRESSURE_SYSTOLIC_FIELD
  | typeof BLOOD_PRESSURE_DIASTOLIC_FIELD
  | typeof BLOOD_PRESSURE_PULSE_FIELD
  | typeof BLOOD_PRESSURE_MEASURED_AT_FIELD
  | typeof BLOOD_PRESSURE_NOTES_FIELD;

type BloodPressureMeasurementField =
  | typeof BLOOD_PRESSURE_SYSTOLIC_FIELD
  | typeof BLOOD_PRESSURE_DIASTOLIC_FIELD
  | typeof BLOOD_PRESSURE_PULSE_FIELD;

type UpdateReading = (
  id: string,
  field: BloodPressureField,
  value: string,
) => void;

function BloodPressureReadFields(params: {
  currentAuthorId: string | null;
  onEnterEdit?: (() => void) | undefined;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
}) {
  const {
    currentAuthorId,
    onEnterEdit,
    readings,
    resolveRowWriter,
    trackerName,
  } = params;

  return (
    <div className="blood-pressure-document-fields">
      <StructuredDocumentReadFields
        fields={[
          {
            label: "Tracker Name",
            value: trackerName,
            // Fall back to the document type's name rather than the generic
            // "None" placeholder when the tracker was never named. Only override
            // the empty case — leaving displayValue undefined for a real name
            // keeps its hover-title tooltip when the name is truncated.
            displayValue:
              trackerName.trim().length > 0
                ? undefined
                : "Blood Pressure Tracker",
          },
        ]}
      />
      <section className="blood-pressure-reading-list">
        <div className="blood-pressure-reading-list-header">
          <div className="blood-pressure-reading-list-title">
            <strong>Readings</strong>
            <span>{readings.length} entries</span>
          </div>
        </div>
        {readings.length === 0 ? (
          <div className="blood-pressure-empty-state">No readings</div>
        ) : (
          readings.map((reading, index) => (
            <BloodPressureReadingReadRow
              key={reading.id}
              currentAuthorId={currentAuthorId}
              index={index}
              onEnterEdit={onEnterEdit}
              reading={reading}
              resolveRowWriter={resolveRowWriter}
            />
          ))
        )}
      </section>
    </div>
  );
}

function BloodPressureMeasurementInput(params: {
  className: string;
  controlsDisabled: boolean;
  index: number;
  label: string;
  onUpdateReading: UpdateReading;
  placeholder: string;
  property: BloodPressureMeasurementField;
  reading: BloodPressureReadingRow;
}) {
  const {
    className,
    controlsDisabled,
    index,
    label,
    onUpdateReading,
    placeholder,
    property,
    reading,
  } = params;
  const value = reading[property];
  const isInvalid = value.length > 0 && !isValidBloodPressureMeasurement(value);

  return (
    <label className={`blood-pressure-reading-field ${className}`}>
      {label}
      <input
        aria-invalid={isInvalid ? "true" : undefined}
        aria-label={`Reading ${index + 1} ${label.toLowerCase()}`}
        value={value}
        onChange={(event) =>
          onUpdateReading(reading.id, property, event.target.value)
        }
        inputMode="numeric"
        pattern="\d*"
        placeholder={placeholder}
        disabled={controlsDisabled}
        autoComplete="off"
      />
    </label>
  );
}

function BloodPressureReadingEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveReading: (id: string) => void;
  onUpdateReading: UpdateReading;
  reading: BloodPressureReadingRow;
}) {
  const { controlsDisabled, index, onRemoveReading, onUpdateReading, reading } =
    params;
  const measurementProps = {
    controlsDisabled,
    index,
    onUpdateReading,
    reading,
  };

  return (
    <div className="blood-pressure-reading-row">
      <BloodPressureMeasurementInput
        {...measurementProps}
        className="blood-pressure-reading-field-systolic"
        label="Systolic"
        placeholder="120"
        property={BLOOD_PRESSURE_SYSTOLIC_FIELD}
      />
      <BloodPressureMeasurementInput
        {...measurementProps}
        className="blood-pressure-reading-field-diastolic"
        label="Diastolic"
        placeholder="80"
        property={BLOOD_PRESSURE_DIASTOLIC_FIELD}
      />
      <BloodPressureMeasurementInput
        {...measurementProps}
        className="blood-pressure-reading-field-pulse"
        label="Pulse"
        placeholder="72"
        property={BLOOD_PRESSURE_PULSE_FIELD}
      />
      <label className="blood-pressure-reading-field blood-pressure-reading-field-measured">
        Measured At
        <input
          aria-label={`Reading ${index + 1} measured at`}
          type="datetime-local"
          value={reading.measuredAt}
          onChange={(event) =>
            onUpdateReading(
              reading.id,
              BLOOD_PRESSURE_MEASURED_AT_FIELD,
              event.target.value,
            )
          }
          disabled={controlsDisabled}
        />
      </label>
      <label className="blood-pressure-reading-field blood-pressure-reading-notes-field">
        Notes
        <input
          aria-label={`Reading ${index + 1} notes`}
          value={reading.notes}
          onChange={(event) =>
            onUpdateReading(
              reading.id,
              BLOOD_PRESSURE_NOTES_FIELD,
              event.target.value,
            )
          }
          placeholder="After walk"
          disabled={controlsDisabled}
          autoComplete="off"
        />
      </label>
      <button
        aria-label={`Remove reading ${index + 1}`}
        className="blood-pressure-remove-button"
        disabled={controlsDisabled}
        onClick={() => onRemoveReading(reading.id)}
        title={`Remove reading ${index + 1}`}
        type="button"
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </button>
    </div>
  );
}

function BloodPressureEditFields(params: {
  controlsDisabled: boolean;
  onAddReading: () => void;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  trackerName: string;
  trackerNameInputId: string;
}) {
  const {
    controlsDisabled,
    onAddReading,
    onRemoveReading,
    onRenameTracker,
    onUpdateReading,
    readings,
    ready,
    trackerName,
    trackerNameInputId,
  } = params;

  return (
    <div className="blood-pressure-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField
          inputId={trackerNameInputId}
          label="Tracker Name"
        >
          <input
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
      <section className="blood-pressure-reading-list">
        <div className="blood-pressure-reading-list-header">
          <div className="blood-pressure-reading-list-title">
            <strong>Readings</strong>
            <span>{readings.length} entries</span>
          </div>
          <button
            className="blood-pressure-add-button"
            disabled={controlsDisabled}
            onClick={onAddReading}
            type="button"
          >
            <PlusIcon aria-hidden size={14} />
            Add Reading
          </button>
        </div>
        {readings.length === 0 ? (
          <div className="blood-pressure-empty-state">No readings</div>
        ) : (
          readings.map((reading, index) => (
            <BloodPressureReadingEditRow
              key={reading.id}
              controlsDisabled={controlsDisabled}
              index={index}
              onRemoveReading={onRemoveReading}
              onUpdateReading={onUpdateReading}
              reading={reading}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function BloodPressureFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  isEditing?: boolean | undefined;
  onAddReading: () => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
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
    onUpdateReading,
    readings,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
  } = params;
  const controlsDisabled = disabled || !ready;

  if (!isEditing) {
    return (
      <BloodPressureReadFields
        currentAuthorId={currentAuthorId}
        onEnterEdit={onEnterEdit}
        readings={readings}
        resolveRowWriter={resolveRowWriter}
        trackerName={trackerName}
      />
    );
  }

  return (
    <BloodPressureEditFields
      controlsDisabled={controlsDisabled}
      onAddReading={onAddReading}
      onRemoveReading={onRemoveReading}
      onRenameTracker={onRenameTracker}
      onUpdateReading={onUpdateReading}
      readings={readings}
      ready={ready}
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
    syncing,
    updateRowFields,
  } = useDocument();
  const trackerNameInputId = useId();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const { clearRow, readCell, stageCell } = useDocumentRowEditing(rows);
  // Only resolve verified writers for the read view (attribution is not shown
  // while editing) of a non-empty tracker.
  const resolveRowWriter = useDocumentRowWriters(
    !(isEditing && canWrite) && rows.length > 0,
  );

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
        <>
          <StructuredDocumentEditActions
            disabled={!ready || !canWrite}
            isEditing={isEditing}
            onToggleEditing={() => setIsEditing(!isEditing)}
          />
          <BloodPressureFields
            currentAuthorId={currentAuthorId}
            disabled={!ready || !canWrite}
            isEditing={isEditing && canWrite}
            resolveRowWriter={resolveRowWriter}
            // The read-row "Edit" action switches the whole tracker into edit
            // mode; only offer it when the viewer can actually write.
            onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
            onAddReading={() => {
              if (canWrite) {
                void addRow({
                  [BLOOD_PRESSURE_SYSTOLIC_FIELD]: "",
                  [BLOOD_PRESSURE_DIASTOLIC_FIELD]: "",
                  [BLOOD_PRESSURE_PULSE_FIELD]: "",
                  [BLOOD_PRESSURE_MEASURED_AT_FIELD]: "",
                  [BLOOD_PRESSURE_NOTES_FIELD]: "",
                });
              }
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
            onUpdateReading={handleUpdateReading}
            readings={readings}
            ready={ready}
            trackerName={trackerName}
            trackerNameInputId={trackerNameInputId}
          />
        </>
      }
      ready={ready}
      syncing={syncing}
      title="Blood Pressure Tracker"
    />
  );
}
