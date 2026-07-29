import {
  TrackerInputField,
  TrackerRowActions,
} from "../shared/TrackerFormControls";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
  isValidBloodPressureMeasurement,
} from "./bloodPressureDocumentDefinition";
import type { BloodPressureReadingRow } from "./bloodPressureReadings";

export type BloodPressureField =
  | typeof BLOOD_PRESSURE_SYSTOLIC_FIELD
  | typeof BLOOD_PRESSURE_DIASTOLIC_FIELD
  | typeof BLOOD_PRESSURE_PULSE_FIELD
  | typeof BLOOD_PRESSURE_MEASURED_AT_FIELD
  | typeof BLOOD_PRESSURE_NOTES_FIELD;

type BloodPressureMeasurementField =
  | typeof BLOOD_PRESSURE_SYSTOLIC_FIELD
  | typeof BLOOD_PRESSURE_DIASTOLIC_FIELD
  | typeof BLOOD_PRESSURE_PULSE_FIELD;

export type UpdateReading = (
  id: string,
  field: BloodPressureField,
  value: string,
) => void;

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
    <TrackerInputField
      aria-invalid={isInvalid ? "true" : undefined}
      aria-label={`Reading ${index + 1} ${label.toLowerCase()}`}
      autoComplete="off"
      className={`${className} tracker-entry-field--measurement`}
      disabled={controlsDisabled}
      inputMode="numeric"
      label={label}
      onChange={(event) =>
        onUpdateReading(reading.id, property, event.target.value)
      }
      pattern="\d*"
      placeholder={placeholder}
      value={value}
    />
  );
}

// A single reading in edit mode: the measurement inputs, when it was taken, its
// notes, and the controls that finish editing or remove it.
export function BloodPressureReadingEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveReading: (id: string) => void;
  onSave: () => void;
  onUpdateReading: UpdateReading;
  reading: BloodPressureReadingRow;
}) {
  const {
    controlsDisabled,
    index,
    onRemoveReading,
    onSave,
    onUpdateReading,
    reading,
  } = params;
  const measurementProps = {
    controlsDisabled,
    index,
    onUpdateReading,
    reading,
  };

  return (
    <div className="blood-pressure-reading-row tracker-edit-row">
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
      <TrackerInputField
        aria-label={`Reading ${index + 1} measured at`}
        className="blood-pressure-reading-field-measured tracker-entry-field--measured-at"
        disabled={controlsDisabled}
        label="Measured At"
        onChange={(event) =>
          onUpdateReading(
            reading.id,
            BLOOD_PRESSURE_MEASURED_AT_FIELD,
            event.target.value,
          )
        }
        type="datetime-local"
        value={reading.measuredAt}
      />
      <TrackerInputField
        aria-label={`Reading ${index + 1} notes`}
        autoComplete="off"
        className="blood-pressure-reading-notes-field"
        disabled={controlsDisabled}
        label="Notes"
        onChange={(event) =>
          onUpdateReading(
            reading.id,
            BLOOD_PRESSURE_NOTES_FIELD,
            event.target.value,
          )
        }
        placeholder="After walk"
        value={reading.notes}
      />
      <TrackerRowActions
        disabled={controlsDisabled}
        onRemove={() => onRemoveReading(reading.id)}
        onSave={onSave}
        removeAriaLabel={`Remove reading ${index + 1}`}
        saveAriaLabel={`Save reading ${index + 1}`}
      />
    </div>
  );
}
