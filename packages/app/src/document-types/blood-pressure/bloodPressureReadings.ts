import type { DocumentRow } from "@tearleads/client-sdk";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "../shared/DocumentRowDetail";
import {
  formatTrackerMeasuredAt,
  TRACKER_EMPTY_VALUE,
} from "../shared/trackerValues";
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
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    createdByPeer: row.createdByPeer,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    updatedByPeer: row.updatedByPeer,
    fieldEditors: row.fieldEditors,
  }));
}

export function formatMeasurementPair(
  reading: BloodPressureReadingRow,
): string {
  const systolic = reading.systolic.trim();
  const diastolic = reading.diastolic.trim();
  if (systolic.length === 0 && diastolic.length === 0) {
    return TRACKER_EMPTY_VALUE;
  }

  return `${systolic || "—"}/${diastolic || "—"} mmHg`;
}

export function formatPulse(reading: BloodPressureReadingRow): string {
  const pulse = reading.pulse.trim();
  return pulse.length > 0 ? `${pulse} bpm` : TRACKER_EMPTY_VALUE;
}

export function formatMeasuredAt(reading: BloodPressureReadingRow): string {
  return formatTrackerMeasuredAt(reading.measuredAt);
}

// The per-field attribution rows for a reading's drill-down. Each cell's
// verified writer is resolved from its last-editor peer; null when unknown
// (attribution not synced) so the overlay can omit it.
export function toBloodPressureReadingDetailFields(
  reading: BloodPressureReadingRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(reading.fieldEditors[field] ?? null) ?? null;
  return [
    {
      label: "Systolic",
      value: reading.systolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_SYSTOLIC_FIELD),
    },
    {
      label: "Diastolic",
      value: reading.diastolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_DIASTOLIC_FIELD),
    },
    {
      label: "Pulse",
      value: reading.pulse,
      writerUserId: fieldWriter(BLOOD_PRESSURE_PULSE_FIELD),
    },
    {
      label: "Measured at",
      value: formatMeasuredAt(reading),
      writerUserId: fieldWriter(BLOOD_PRESSURE_MEASURED_AT_FIELD),
    },
    {
      label: "Notes",
      value: reading.notes,
      writerUserId: fieldWriter(BLOOD_PRESSURE_NOTES_FIELD),
    },
  ];
}
