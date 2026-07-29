import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type FormEvent, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import { TrackerInputField } from "../shared/TrackerFormControls";
import {
  isValidWeightMeasurement,
  type WeightUnit,
} from "./weightDocumentDefinition";

export interface WeightQuickEntry {
  measuredAt: string;
  notes: string;
  weight: string;
}

const EMPTY_ENTRY: WeightQuickEntry = {
  measuredAt: "",
  notes: "",
  weight: "",
};

export function WeightQuickAdd(params: {
  controlsDisabled: boolean;
  onAddEntry: (entry?: WeightQuickEntry) => void;
  unit: WeightUnit;
}) {
  const { controlsDisabled, onAddEntry, unit } = params;
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [open, setOpen] = useState(false);
  const valid = isValidWeightMeasurement(entry.weight);

  function close() {
    setEntry(EMPTY_ENTRY);
    setOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled || !valid) {
      return;
    }

    onAddEntry(entry);
    close();
  }

  if (!open) {
    return (
      <MiniAppButton
        className="weight-add-button tracker-add-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden size={14} />
        Add Entry
      </MiniAppButton>
    );
  }

  return (
    <form
      className="weight-entry-row weight-quick-add-row tracker-edit-row"
      onSubmit={submit}
    >
      <TrackerInputField
        aria-invalid={entry.weight.length > 0 && !valid ? "true" : undefined}
        aria-label="Quick add weight"
        autoComplete="off"
        className="weight-entry-field-weight tracker-entry-field--measurement"
        disabled={controlsDisabled}
        inputMode="decimal"
        label={`Weight (${unit})`}
        onChange={(event) =>
          setEntry((current) => ({
            ...current,
            weight: event.target.value,
          }))
        }
        placeholder={unit === "kg" ? "82.5" : "180.5"}
        value={entry.weight}
      />
      <TrackerInputField
        aria-label="Quick add measured at"
        className="weight-entry-field-measured tracker-entry-field--measured-at"
        disabled={controlsDisabled}
        label="Measured At"
        onChange={(event) =>
          setEntry((current) => ({
            ...current,
            measuredAt: event.target.value,
          }))
        }
        type="datetime-local"
        value={entry.measuredAt}
      />
      <TrackerInputField
        aria-label="Quick add notes"
        autoComplete="off"
        className="weight-entry-notes-field"
        disabled={controlsDisabled}
        label="Notes"
        onChange={(event) =>
          setEntry((current) => ({
            ...current,
            notes: event.target.value,
          }))
        }
        placeholder="Before breakfast"
        value={entry.notes}
      />
      <div className="weight-quick-add-actions tracker-quick-add-actions">
        <MiniAppButton
          withIcon
          disabled={controlsDisabled || !valid}
          type="submit"
        >
          <CheckIcon aria-hidden size={14} />
          Save Entry
        </MiniAppButton>
        <MiniAppButton withIcon disabled={controlsDisabled} onClick={close}>
          <XIcon aria-hidden size={14} />
          Cancel
        </MiniAppButton>
      </div>
    </form>
  );
}
