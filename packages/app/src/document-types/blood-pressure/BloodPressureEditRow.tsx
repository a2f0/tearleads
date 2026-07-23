import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
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

// A single reading in edit mode: the measurement inputs, when it was taken, its
// notes, and the control that removes it.
export function BloodPressureReadingEditRow(params: {
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
      <MiniAppButton
        aria-label={`Remove reading ${index + 1}`}
        className="blood-pressure-remove-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => onRemoveReading(reading.id)}
        title={`Remove reading ${index + 1}`}
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </MiniAppButton>
    </div>
  );
}
