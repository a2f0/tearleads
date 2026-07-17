import type { DocumentRow } from "@tearleads/client-sdk";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
  BLOOD_PRESSURE_TRACKER_NAME_FIELD,
} from "./bloodPressureDocumentDefinition";

type ReadRowCell = (id: string, field: string, storeValue: string) => string;

export interface BloodPressureReadingRow {
  id: string;
  systolic: string;
  diastolic: string;
  pulse: string;
  measuredAt: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

const BLOOD_PRESSURE_EMPTY_VALUE = "None";

export function readTrackerNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[BLOOD_PRESSURE_TRACKER_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

// Fold the store's generic rows into typed reading views, applying the caller's
// optimistic in-flight cell overlay so controlled inputs stay smooth.
export function toBloodPressureReadingRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadRowCell,
): BloodPressureReadingRow[] {
  return rows.map((row) => ({
    id: row.id,
    systolic: readCell(
      row.id,
      BLOOD_PRESSURE_SYSTOLIC_FIELD,
      row.fields[BLOOD_PRESSURE_SYSTOLIC_FIELD] ?? "",
    ),
    diastolic: readCell(
      row.id,
      BLOOD_PRESSURE_DIASTOLIC_FIELD,
      row.fields[BLOOD_PRESSURE_DIASTOLIC_FIELD] ?? "",
    ),
    pulse: readCell(
      row.id,
      BLOOD_PRESSURE_PULSE_FIELD,
      row.fields[BLOOD_PRESSURE_PULSE_FIELD] ?? "",
    ),
    measuredAt: readCell(
      row.id,
      BLOOD_PRESSURE_MEASURED_AT_FIELD,
      row.fields[BLOOD_PRESSURE_MEASURED_AT_FIELD] ?? "",
    ),
    notes: readCell(
      row.id,
      BLOOD_PRESSURE_NOTES_FIELD,
      row.fields[BLOOD_PRESSURE_NOTES_FIELD] ?? "",
    ),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }));
}

export function formatMeasurementPair(
  reading: BloodPressureReadingRow,
): string {
  const systolic = reading.systolic.trim();
  const diastolic = reading.diastolic.trim();
  if (systolic.length === 0 && diastolic.length === 0) {
    return BLOOD_PRESSURE_EMPTY_VALUE;
  }

  return `${systolic || "—"}/${diastolic || "—"} mmHg`;
}

export function formatPulse(reading: BloodPressureReadingRow): string {
  const pulse = reading.pulse.trim();
  return pulse.length > 0 ? `${pulse} bpm` : BLOOD_PRESSURE_EMPTY_VALUE;
}

// datetime-local values look like "2026-07-16T08:30"; swap the "T" for a space
// so the read view is legible without pulling in locale-dependent Date parsing.
export function formatMeasuredAt(reading: BloodPressureReadingRow): string {
  const measuredAt = reading.measuredAt.trim();
  return measuredAt.length > 0
    ? measuredAt.replace("T", " ")
    : BLOOD_PRESSURE_EMPTY_VALUE;
}
