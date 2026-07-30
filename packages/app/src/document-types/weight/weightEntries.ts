import type { DocumentRow } from "@tearleads/client-sdk";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "../shared/DocumentRowDetail";
import {
  formatTrackerMeasuredAt,
  TRACKER_EMPTY_VALUE,
} from "../shared/trackerValues";
import {
  isValidWeightMeasurement,
  toWeightUnit,
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
  WEIGHT_TRACKER_NAME_FIELD,
  WEIGHT_UNIT_FIELD,
  type WeightUnit,
} from "./weightDocumentDefinition";

type ReadRowCell = (id: string, field: string, storeValue: string) => string;

export interface WeightEntryRow {
  id: string;
  weight: string;
  // The unit this entry was recorded in, kept on the entry itself so a merge
  // between peers that chose different units can never restate a weight.
  unit: WeightUnit;
  measuredAt: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  createdByPeer: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedByPeer: string | null;
  // Per-cell last-editor peers, keyed by the row's field keys, for field-level
  // attribution in the row detail.
  fieldEditors: Record<string, string | null>;
}

export function readTrackerNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[WEIGHT_TRACKER_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

// The unit new entries are seeded with. Unlike an entry's own unit, this is only
// a default: a peer overwriting it never changes what an existing entry means.
export function readTrackerUnitField(
  structuredFields: Readonly<Record<string, string>>,
): WeightUnit {
  const value = structuredFields[WEIGHT_UNIT_FIELD];
  return toWeightUnit(typeof value === "string" ? value : undefined);
}

// Fold the store's generic rows into typed entry views, applying the caller's
// optimistic in-flight cell overlay so controlled inputs stay smooth.
export function toWeightEntryRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadRowCell,
  trackerUnit: WeightUnit,
): WeightEntryRow[] {
  return rows.map((row) => ({
    id: row.id,
    // A row written before this document type carried per-entry units, or by a
    // client that omitted it, reads as the tracker's unit.
    unit: toWeightUnit(row.fields[WEIGHT_UNIT_FIELD] ?? trackerUnit),
    weight: readCell(
      row.id,
      WEIGHT_MEASUREMENT_FIELD,
      row.fields[WEIGHT_MEASUREMENT_FIELD] ?? "",
    ),
    measuredAt: readCell(
      row.id,
      WEIGHT_MEASURED_AT_FIELD,
      row.fields[WEIGHT_MEASURED_AT_FIELD] ?? "",
    ),
    notes: readCell(
      row.id,
      WEIGHT_NOTES_FIELD,
      row.fields[WEIGHT_NOTES_FIELD] ?? "",
    ),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    createdByPeer: row.createdByPeer,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    updatedByPeer: row.updatedByPeer,
    fieldEditors: row.fieldEditors,
  }));
}

export function formatWeight(entry: WeightEntryRow): string {
  const weight = entry.weight.trim();
  return weight.length > 0 ? `${weight} ${entry.unit}` : TRACKER_EMPTY_VALUE;
}

export function formatMeasuredAt(entry: WeightEntryRow): string {
  return formatTrackerMeasuredAt(entry.measuredAt);
}

// The per-field attribution rows for an entry's drill-down. Each cell's verified
// writer is resolved from its last-editor peer; null when unknown (attribution
// not synced) so the overlay can omit it.
export function toWeightEntryDetailFields(
  entry: WeightEntryRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(entry.fieldEditors[field] ?? null) ?? null;
  return [
    {
      label: "Weight",
      value: formatWeight(entry),
      writerUserId: fieldWriter(WEIGHT_MEASUREMENT_FIELD),
    },
    {
      label: "Measured at",
      value: formatMeasuredAt(entry),
      writerUserId: fieldWriter(WEIGHT_MEASURED_AT_FIELD),
    },
    {
      label: "Notes",
      value: entry.notes,
      writerUserId: fieldWriter(WEIGHT_NOTES_FIELD),
    },
  ];
}

// One kilogram in pounds. Used only to *order* entries against each other —
// never to restate a weight on screen, which is the rule the rest of this
// document type keeps (an entry always reads in the unit it was recorded in, and
// a change across units is not reported at all).
const WEIGHT_POUNDS_PER_KILOGRAM = 2.2046226218;

// A weight (or a change in weight) as a single comparable magnitude, so a
// tracker holding both units orders by what was actually weighed rather than by
// the bare figure. Ordering 90 kg below 180 lb — as a raw numeric compare does —
// files the heavier entry first, which is simply the wrong answer to "sort by
// weight". NaN for a value the document would reject, so a half-typed cell has
// no magnitude to be ordered by.
export function toComparableWeight(value: string, unit: WeightUnit): number {
  const trimmed = value.trim();
  if (!isValidWeightMeasurement(trimmed)) {
    return Number.NaN;
  }

  return toComparableMagnitude(Number(trimmed), unit);
}

// The delta {@link getWeightChange} reports, in the same comparable magnitude —
// it is expressed in its entry's own unit, so +2 kg and +2 lb are no more
// comparable as raw numbers than the weights they came from.
export function toComparableWeightChange(
  change: number | null,
  unit: WeightUnit,
): number {
  return change === null ? Number.NaN : toComparableMagnitude(change, unit);
}

function toComparableMagnitude(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value * WEIGHT_POUNDS_PER_KILOGRAM : value;
}

// The signed difference from the previous entry in list order, as a number. Null
// when either side is missing or not a valid measurement, so the first entry —
// and a tracker holding a half-typed or out-of-range value — has no delta rather
// than a misleading one. Validity is checked with the document's own rule, not
// Number.parseFloat, which would happily read "180abc" as 180.
//
// Separate from its label so the index table can also order by the change.
export function getWeightChange(
  entry: WeightEntryRow,
  previous: WeightEntryRow | undefined,
): number | null {
  // Entries recorded in different units are not comparable without converting
  // one of them, which would put a number on screen that nobody weighed.
  if (!previous || previous.unit !== entry.unit) {
    return null;
  }

  const currentValue = entry.weight.trim();
  const priorValue = previous.weight.trim();
  if (
    !isValidWeightMeasurement(currentValue) ||
    !isValidWeightMeasurement(priorValue)
  ) {
    return null;
  }

  const delta = Number.parseFloat(currentValue) - Number.parseFloat(priorValue);
  // Round to the two decimals the input itself accepts, so floating-point noise
  // never leaks into the label.
  return Math.round(delta * 100) / 100;
}

// {@link getWeightChange} formatted for a read row, e.g. "−1.5 lb".
export function formatWeightChange(
  entry: WeightEntryRow,
  previous: WeightEntryRow | undefined,
): string | null {
  const rounded = getWeightChange(entry, previous);
  if (rounded === null) {
    return null;
  }

  if (rounded === 0) {
    return `±0 ${entry.unit}`;
  }

  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} ${entry.unit}`;
}
