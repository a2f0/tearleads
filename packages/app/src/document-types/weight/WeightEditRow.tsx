import {
  TrackerInputField,
  TrackerRowActions,
} from "../shared/TrackerFormControls";
import {
  isValidWeightMeasurement,
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
} from "./weightDocumentDefinition";
import type { WeightEntryRow } from "./weightEntries";

export type WeightField =
  | typeof WEIGHT_MEASUREMENT_FIELD
  | typeof WEIGHT_MEASURED_AT_FIELD
  | typeof WEIGHT_NOTES_FIELD;

export type UpdateEntry = (
  id: string,
  field: WeightField,
  value: string,
) => void;

// A single entry in edit mode: the weight itself, when it was taken, its notes,
// and the controls that finish editing or remove it.
export function WeightEntryEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveEntry: (id: string) => void;
  onSave: () => void;
  onUpdateEntry: UpdateEntry;
  entry: WeightEntryRow;
}) {
  const {
    controlsDisabled,
    entry,
    index,
    onRemoveEntry,
    onSave,
    onUpdateEntry,
  } = params;
  const isInvalid =
    entry.weight.length > 0 && !isValidWeightMeasurement(entry.weight);

  return (
    <div className="weight-entry-row tracker-edit-row">
      <TrackerInputField
        aria-invalid={isInvalid ? "true" : undefined}
        aria-label={`Entry ${index + 1} weight`}
        autoComplete="off"
        className="weight-entry-field-weight tracker-entry-field--measurement"
        disabled={controlsDisabled}
        inputMode="decimal"
        label={`Weight (${entry.unit})`}
        onChange={(event) =>
          onUpdateEntry(entry.id, WEIGHT_MEASUREMENT_FIELD, event.target.value)
        }
        pattern="\d*(\.\d{1,2})?"
        placeholder={entry.unit === "kg" ? "82.5" : "180.5"}
        value={entry.weight}
      />
      <TrackerInputField
        aria-label={`Entry ${index + 1} measured at`}
        className="weight-entry-field-measured tracker-entry-field--measured-at"
        disabled={controlsDisabled}
        label="Measured At"
        onChange={(event) =>
          onUpdateEntry(entry.id, WEIGHT_MEASURED_AT_FIELD, event.target.value)
        }
        type="datetime-local"
        value={entry.measuredAt}
      />
      <TrackerInputField
        aria-label={`Entry ${index + 1} notes`}
        autoComplete="off"
        className="weight-entry-notes-field"
        disabled={controlsDisabled}
        label="Notes"
        onChange={(event) =>
          onUpdateEntry(entry.id, WEIGHT_NOTES_FIELD, event.target.value)
        }
        placeholder="Before breakfast"
        value={entry.notes}
      />
      <TrackerRowActions
        disabled={controlsDisabled}
        onRemove={() => onRemoveEntry(entry.id)}
        onSave={onSave}
        removeAriaLabel={`Remove entry ${index + 1}`}
        saveAriaLabel={`Save entry ${index + 1}`}
      />
    </div>
  );
}
