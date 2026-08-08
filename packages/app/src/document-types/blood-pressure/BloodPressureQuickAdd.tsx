import { TrackerInputField } from "../shared/TrackerFormControls";
import { TrackerQuickAdd } from "../shared/TrackerQuickAdd";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { isValidBloodPressureMeasurement } from "./bloodPressureDocumentDefinition";

export interface BloodPressureQuickReading {
  diastolic: string;
  measuredAt: string;
  notes: string;
  pulse: string;
  systolic: string;
}

const EMPTY_READING: BloodPressureQuickReading = {
  diastolic: "",
  measuredAt: "",
  notes: "",
  pulse: "",
  systolic: "",
};

function MeasurementInput(params: {
  controlsDisabled: boolean;
  field: "diastolic" | "pulse" | "systolic";
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { controlsDisabled, field, label, onChange, placeholder, value } =
    params;
  const valid = value.length === 0 || isValidBloodPressureMeasurement(value);
  return (
    <TrackerInputField
      aria-invalid={!valid ? "true" : undefined}
      aria-label={`Quick add ${field}`}
      autoComplete="off"
      className={`blood-pressure-reading-field-${field} tracker-entry-field--measurement`}
      disabled={controlsDisabled}
      inputMode="numeric"
      label={label}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={value}
    />
  );
}

export function BloodPressureQuickAdd(params: {
  controlsDisabled: boolean;
  onAddReading: AddTrackerRow<BloodPressureQuickReading>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { controlsDisabled, onAddReading, onPendingChange } = params;

  return (
    <TrackerQuickAdd
      addLabel="Add Reading"
      className="blood-pressure-reading-row"
      controlsDisabled={controlsDisabled}
      emptyEntry={EMPTY_READING}
      isValid={(reading) =>
        isValidBloodPressureMeasurement(reading.systolic) &&
        isValidBloodPressureMeasurement(reading.diastolic) &&
        (reading.pulse.length === 0 ||
          isValidBloodPressureMeasurement(reading.pulse))
      }
      onAddEntry={onAddReading}
      onPendingChange={onPendingChange}
      renderFields={(reading, onChange) => (
        <>
          <MeasurementInput
            controlsDisabled={controlsDisabled}
            field="systolic"
            label="Systolic"
            onChange={(value) => onChange("systolic", value)}
            placeholder="120"
            value={reading.systolic}
          />
          <MeasurementInput
            controlsDisabled={controlsDisabled}
            field="diastolic"
            label="Diastolic"
            onChange={(value) => onChange("diastolic", value)}
            placeholder="80"
            value={reading.diastolic}
          />
          <MeasurementInput
            controlsDisabled={controlsDisabled}
            field="pulse"
            label="Pulse"
            onChange={(value) => onChange("pulse", value)}
            placeholder="72"
            value={reading.pulse}
          />
          <TrackerInputField
            aria-label="Quick add measured at"
            className="blood-pressure-reading-field-measured tracker-entry-field--measured-at"
            disabled={controlsDisabled}
            label="Measured At"
            onChange={(event) => onChange("measuredAt", event.target.value)}
            type="datetime-local"
            value={reading.measuredAt}
          />
          <TrackerInputField
            aria-label="Quick add notes"
            autoComplete="off"
            className="blood-pressure-reading-notes-field"
            disabled={controlsDisabled}
            label="Notes"
            onChange={(event) => onChange("notes", event.target.value)}
            placeholder="After walk"
            value={reading.notes}
          />
        </>
      )}
      saveLabel="Save Reading"
    />
  );
}
