import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import {
  isValidWeightMeasurement,
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
  type WeightUnit,
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
// and the control that removes it.
export function WeightEntryEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveEntry: (id: string) => void;
  onUpdateEntry: UpdateEntry;
  entry: WeightEntryRow;
  unit: WeightUnit;
}) {
  const { controlsDisabled, entry, index, onRemoveEntry, onUpdateEntry, unit } =
    params;
  const isInvalid =
    entry.weight.length > 0 && !isValidWeightMeasurement(entry.weight);

  return (
    <div className="weight-entry-row">
      <label className="weight-entry-field weight-entry-field-weight">
        {`Weight (${unit})`}
        <input
          aria-invalid={isInvalid ? "true" : undefined}
          aria-label={`Entry ${index + 1} weight`}
          value={entry.weight}
          onChange={(event) =>
            onUpdateEntry(
              entry.id,
              WEIGHT_MEASUREMENT_FIELD,
              event.target.value,
            )
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
          aria-label={`Entry ${index + 1} measured at`}
          type="datetime-local"
          value={entry.measuredAt}
          onChange={(event) =>
            onUpdateEntry(
              entry.id,
              WEIGHT_MEASURED_AT_FIELD,
              event.target.value,
            )
          }
          disabled={controlsDisabled}
        />
      </label>
      <label className="weight-entry-field weight-entry-notes-field">
        Notes
        <input
          aria-label={`Entry ${index + 1} notes`}
          value={entry.notes}
          onChange={(event) =>
            onUpdateEntry(entry.id, WEIGHT_NOTES_FIELD, event.target.value)
          }
          placeholder="Before breakfast"
          disabled={controlsDisabled}
          autoComplete="off"
        />
      </label>
      <MiniAppButton
        aria-label={`Remove entry ${index + 1}`}
        className="weight-remove-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => onRemoveEntry(entry.id)}
        title={`Remove entry ${index + 1}`}
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </MiniAppButton>
    </div>
  );
}
