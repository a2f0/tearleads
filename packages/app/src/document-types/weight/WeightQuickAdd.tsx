import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type FormEvent, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
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
        className="weight-add-button"
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
    <form className="weight-entry-row weight-quick-add-row" onSubmit={submit}>
      <label className="weight-entry-field weight-entry-field-weight">
        {`Weight (${unit})`}
        <input
          aria-invalid={entry.weight.length > 0 && !valid ? "true" : undefined}
          aria-label="Quick add weight"
          value={entry.weight}
          onChange={(event) =>
            setEntry((current) => ({
              ...current,
              weight: event.target.value,
            }))
          }
          inputMode="decimal"
          pattern="\d*(\.\d{1,2})?"
          placeholder={unit === "kg" ? "82.5" : "180.5"}
          disabled={controlsDisabled}
          autoComplete="off"
        />
      </label>
      <label className="weight-entry-field weight-entry-field-measured">
        Measured At
        <input
          aria-label="Quick add measured at"
          type="datetime-local"
          value={entry.measuredAt}
          onChange={(event) =>
            setEntry((current) => ({
              ...current,
              measuredAt: event.target.value,
            }))
          }
          disabled={controlsDisabled}
        />
      </label>
      <label className="weight-entry-field weight-entry-notes-field">
        Notes
        <input
          aria-label="Quick add notes"
          value={entry.notes}
          onChange={(event) =>
            setEntry((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          placeholder="Before breakfast"
          disabled={controlsDisabled}
          autoComplete="off"
        />
      </label>
      <div className="weight-quick-add-actions">
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
