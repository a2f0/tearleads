import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type FormEvent, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
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
    <label
      className={`blood-pressure-reading-field blood-pressure-reading-field-${field}`}
    >
      {label}
      <input
        aria-invalid={!valid ? "true" : undefined}
        aria-label={`Quick add ${field}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        placeholder={placeholder}
        disabled={controlsDisabled}
        autoComplete="off"
      />
    </label>
  );
}

function QuickReadingFields(params: {
  controlsDisabled: boolean;
  onChange: (field: keyof BloodPressureQuickReading, value: string) => void;
  reading: BloodPressureQuickReading;
}) {
  const { controlsDisabled, onChange, reading } = params;
  return (
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
      <label className="blood-pressure-reading-field blood-pressure-reading-field-measured">
        Measured At
        <input
          aria-label="Quick add measured at"
          type="datetime-local"
          value={reading.measuredAt}
          onChange={(event) => onChange("measuredAt", event.target.value)}
          disabled={controlsDisabled}
        />
      </label>
      <label className="blood-pressure-reading-field blood-pressure-reading-notes-field">
        Notes
        <input
          aria-label="Quick add notes"
          value={reading.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          placeholder="After walk"
          disabled={controlsDisabled}
          autoComplete="off"
        />
      </label>
    </>
  );
}

export function BloodPressureQuickAdd(params: {
  controlsDisabled: boolean;
  onAddReading: (reading?: BloodPressureQuickReading) => void;
}) {
  const { controlsDisabled, onAddReading } = params;
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(EMPTY_READING);
  const valid =
    isValidBloodPressureMeasurement(reading.systolic) &&
    isValidBloodPressureMeasurement(reading.diastolic) &&
    (reading.pulse.length === 0 ||
      isValidBloodPressureMeasurement(reading.pulse));

  function close() {
    setReading(EMPTY_READING);
    setOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled || !valid) {
      return;
    }

    onAddReading(reading);
    close();
  }

  if (!open) {
    return (
      <MiniAppButton
        className="blood-pressure-add-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden size={14} />
        Add Reading
      </MiniAppButton>
    );
  }

  return (
    <form
      className="blood-pressure-reading-row blood-pressure-quick-add-row"
      onSubmit={submit}
    >
      <QuickReadingFields
        controlsDisabled={controlsDisabled}
        onChange={(field, value) =>
          setReading((current) => ({ ...current, [field]: value }))
        }
        reading={reading}
      />
      <div className="blood-pressure-quick-add-actions">
        <MiniAppButton
          withIcon
          disabled={controlsDisabled || !valid}
          type="submit"
        >
          <CheckIcon aria-hidden size={14} />
          Save Reading
        </MiniAppButton>
        <MiniAppButton withIcon disabled={controlsDisabled} onClick={close}>
          <XIcon aria-hidden size={14} />
          Cancel
        </MiniAppButton>
      </div>
    </form>
  );
}
