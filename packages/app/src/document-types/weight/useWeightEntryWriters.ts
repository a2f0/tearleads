import type { useDocument } from "../../stores/documents/DocumentsProvider";
import type { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import type { UpdateEntry } from "./WeightEditRow";
import {
  WEIGHT_DOCUMENT_KIND,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_UNIT_FIELD,
  type WeightUnit,
} from "./weightDocumentDefinition";
import { convertWeightValue, type WeightEntryRow } from "./weightEntries";

type DocumentApi = ReturnType<typeof useDocument>;
type RowEditingApi = ReturnType<typeof useDocumentRowEditing>;

// The tracker's write paths: a cell edit, and a unit change that has to restate
// every entry already recorded. Kept beside the component rather than inside it
// so the document body stays a rendering concern.
export function useWeightEntryWriters(params: {
  canWrite: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  setStructuredFields: DocumentApi["setStructuredFields"];
  stageCell: RowEditingApi["stageCell"];
  unit: WeightUnit;
  updateRowFields: DocumentApi["updateRowFields"];
}): { changeUnit: (nextUnit: WeightUnit) => void; updateEntry: UpdateEntry } {
  const {
    canWrite,
    entries,
    setStructuredFields,
    stageCell,
    unit,
    updateRowFields,
  } = params;

  // Stage the cell locally either way so a controlled input stays smooth even
  // when the viewer cannot persist the edit.
  const updateEntry: UpdateEntry = (id, field, value) => {
    stageCell(id, field, value);
    if (canWrite) {
      void updateRowFields(id, { [field]: value });
    }
  };

  // Switching the unit restates the entries already recorded, so the history
  // keeps describing the same physical weights — without this, a 180 lb entry
  // would simply start reading as 180 kg. Cells the document would flag as
  // invalid (blank, half-typed, out of range) are left untouched for the user to
  // fix rather than silently rewritten.
  const changeUnit = (nextUnit: WeightUnit) => {
    if (!canWrite || nextUnit === unit) {
      return;
    }

    void setStructuredFields(WEIGHT_DOCUMENT_KIND, {
      [WEIGHT_UNIT_FIELD]: nextUnit,
    });
    for (const entry of entries) {
      const converted = convertWeightValue(entry.weight, unit, nextUnit);
      if (converted !== null) {
        updateEntry(entry.id, WEIGHT_MEASUREMENT_FIELD, converted);
      }
    }
  };

  return { changeUnit, updateEntry };
}
