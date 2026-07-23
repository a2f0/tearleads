import type { DocumentRow } from "@tearleads/client-sdk";
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

const WEIGHT_EMPTY_VALUE = "None";

export function readTrackerNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[WEIGHT_TRACKER_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

export function readUnitField(
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
): WeightEntryRow[] {
  return rows.map((row) => ({
    id: row.id,
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

const POUNDS_PER_KILOGRAM = 2.2046226218;

// Restate a stored measurement in another unit, so switching a tracker's unit
// keeps its history meaning the same physical weight instead of silently
// reinterpreting 180 lb as 180 kg. Returns null — meaning "leave this cell
// alone" — when the units match or the cell is blank, half-typed, or otherwise
// not a valid measurement: a value the document would flag as invalid is the
// user's to fix, not this function's to rewrite into something else.
export function convertWeightValue(
  value: string,
  from: WeightUnit,
  to: WeightUnit,
): string | null {
  const trimmed = value.trim();
  if (from === to || !isValidWeightMeasurement(trimmed)) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  const converted =
    to === "kg" ? parsed / POUNDS_PER_KILOGRAM : parsed * POUNDS_PER_KILOGRAM;
  // Round to the two decimals the input itself accepts. Round-tripping a unit
  // twice can therefore land a hundredth off the original; that is preferable to
  // storing precision the editor cannot display or re-enter.
  return String(Math.round(converted * 100) / 100);
}

export function formatWeight(entry: WeightEntryRow, unit: WeightUnit): string {
  const weight = entry.weight.trim();
  return weight.length > 0 ? `${weight} ${unit}` : WEIGHT_EMPTY_VALUE;
}

// datetime-local values look like "2026-07-16T08:30"; swap the "T" for a space
// so the read view is legible without pulling in locale-dependent Date parsing.
export function formatMeasuredAt(entry: WeightEntryRow): string {
  const measuredAt = entry.measuredAt.trim();
  return measuredAt.length > 0
    ? measuredAt.replace("T", " ")
    : WEIGHT_EMPTY_VALUE;
}

// The signed difference from the previous entry in list order, formatted for the
// read row (e.g. "−1.5 lb"). Null when either side is missing or not a valid
// measurement, so the first entry — and a tracker holding a half-typed or
// out-of-range value — simply shows no delta rather than a misleading one.
// Validity is checked with the document's own rule, not Number.parseFloat, which
// would happily read "180abc" as 180.
export function formatWeightChange(
  entry: WeightEntryRow,
  previous: WeightEntryRow | undefined,
  unit: WeightUnit,
): string | null {
  if (!previous) {
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
  const rounded = Math.round(delta * 100) / 100;
  if (rounded === 0) {
    return `±0 ${unit}`;
  }

  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} ${unit}`;
}
