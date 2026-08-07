import type { DocumentRow } from "@tearleads/client-sdk";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "../shared/DocumentRowDetail";
import {
  type ReadTrackerRowCell,
  readStructuredTrackerField,
  type TrackerRow,
  trackerDetailFields,
  trackerRowMetadata,
} from "../shared/trackerRows";
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

export interface BloodPressureReadingRow extends TrackerRow {
  systolic: string;
  diastolic: string;
  pulse: string;
  measuredAt: string;
  notes: string;
}

export function readTrackerNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  return readStructuredTrackerField(
    structuredFields,
    BLOOD_PRESSURE_TRACKER_NAME_FIELD,
  );
}

// Fold the store's generic rows into typed reading views, applying the caller's
// optimistic in-flight cell overlay so controlled inputs stay smooth.
export function toBloodPressureReadingRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadTrackerRowCell,
): BloodPressureReadingRow[] {
  return rows.map((row) => ({
    ...trackerRowMetadata(row),
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
  return trackerDetailFields(
    reading,
    [
      {
        field: BLOOD_PRESSURE_SYSTOLIC_FIELD,
        label: "Systolic",
        value: (row) => row.systolic,
      },
      {
        field: BLOOD_PRESSURE_DIASTOLIC_FIELD,
        label: "Diastolic",
        value: (row) => row.diastolic,
      },
      {
        field: BLOOD_PRESSURE_PULSE_FIELD,
        label: "Pulse",
        value: (row) => row.pulse,
      },
      {
        field: BLOOD_PRESSURE_MEASURED_AT_FIELD,
        label: "Measured at",
        value: formatMeasuredAt,
      },
      {
        field: BLOOD_PRESSURE_NOTES_FIELD,
        label: "Notes",
        value: (row) => row.notes,
      },
    ],
    resolveRowWriter,
  );
}
