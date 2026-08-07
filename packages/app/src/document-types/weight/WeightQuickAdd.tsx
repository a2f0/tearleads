import { TrackerInputField } from "../shared/TrackerFormControls";
import { TrackerQuickAdd } from "../shared/TrackerQuickAdd";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
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
  onAddEntry: AddTrackerRow<WeightQuickEntry>;
  onPendingChange: (pending: boolean) => void;
  unit: WeightUnit;
}) {
  const { controlsDisabled, onAddEntry, onPendingChange, unit } = params;

  return (
    <TrackerQuickAdd
      actionsClassName="weight-quick-add-actions"
      addLabel="Add Entry"
      buttonClassName="weight-add-button"
      className="weight-entry-row"
      controlsDisabled={controlsDisabled}
      emptyEntry={EMPTY_ENTRY}
      isValid={(entry) => isValidWeightMeasurement(entry.weight)}
      onAddEntry={onAddEntry}
      onPendingChange={onPendingChange}
      renderFields={(entry, onChange) => (
        <>
          <TrackerInputField
            aria-invalid={
              entry.weight.length > 0 && !isValidWeightMeasurement(entry.weight)
                ? "true"
                : undefined
            }
            aria-label="Quick add weight"
            autoComplete="off"
            className="weight-entry-field-weight tracker-entry-field--measurement"
            disabled={controlsDisabled}
            inputMode="decimal"
            label={`Weight (${unit})`}
            onChange={(event) => onChange("weight", event.target.value)}
            placeholder={unit === "kg" ? "82.5" : "180.5"}
            value={entry.weight}
          />
          <TrackerInputField
            aria-label="Quick add measured at"
            className="weight-entry-field-measured tracker-entry-field--measured-at"
            disabled={controlsDisabled}
            label="Measured At"
            onChange={(event) => onChange("measuredAt", event.target.value)}
            type="datetime-local"
            value={entry.measuredAt}
          />
          <TrackerInputField
            aria-label="Quick add notes"
            autoComplete="off"
            className="weight-entry-notes-field"
            disabled={controlsDisabled}
            label="Notes"
            onChange={(event) => onChange("notes", event.target.value)}
            placeholder="Before breakfast"
            value={entry.notes}
          />
        </>
      )}
      saveLabel="Save Entry"
    />
  );
}
