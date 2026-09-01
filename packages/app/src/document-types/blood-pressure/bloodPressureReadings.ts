import type { DocumentRow } from "@tearleads/client-sdk";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "../shared/DocumentRowDetail";
import {
  type ReadTrackerRowCell,
  readTrackerRowCell,
  type TrackerRow,
  toTrackerRows,
  trackerDetailFields,
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
} from "./bloodPressureDocumentDefinition";

export interface BloodPressureReadingRow extends TrackerRow {
  systolic: string;
  diastolic: string;
  pulse: string;
  measuredAt: string;
  notes: string;
}

// Fold the store's generic rows into typed reading views.
export function toBloodPressureReadingRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadTrackerRowCell,
): BloodPressureReadingRow[] {
  return toTrackerRows(rows, (row) => ({
    diastolic: readTrackerRowCell(
      row,
      readCell,
      BLOOD_PRESSURE_DIASTOLIC_FIELD,
    ),
    measuredAt: readTrackerRowCell(
      row,
      readCell,
      BLOOD_PRESSURE_MEASURED_AT_FIELD,
    ),
    notes: readTrackerRowCell(row, readCell, BLOOD_PRESSURE_NOTES_FIELD),
    pulse: readTrackerRowCell(row, readCell, BLOOD_PRESSURE_PULSE_FIELD),
    systolic: readTrackerRowCell(row, readCell, BLOOD_PRESSURE_SYSTOLIC_FIELD),
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
        value: (row) => formatTrackerMeasuredAt(row.measuredAt),
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
