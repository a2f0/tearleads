import { HeartbeatIcon } from "@phosphor-icons/react/dist/csr/Heartbeat";
import {
  type DocumentFieldValidationIssue,
  type DocumentRowSummary,
  readStringDocumentField,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

export const BLOOD_PRESSURE_DOCUMENT_KIND = "blood_pressure";
// The tracker name lives in a flat structured field (not the row list).
export const BLOOD_PRESSURE_TRACKER_NAME_FIELD = "trackerName";
// Row-field keys for a reading row in the document's first-class row list.
export const BLOOD_PRESSURE_SYSTOLIC_FIELD = "systolic";
export const BLOOD_PRESSURE_DIASTOLIC_FIELD = "diastolic";
export const BLOOD_PRESSURE_PULSE_FIELD = "pulse";
export const BLOOD_PRESSURE_MEASURED_AT_FIELD = "measuredAt";
export const BLOOD_PRESSURE_NOTES_FIELD = "notes";
// Shown for a tracker that was never named — the document type's own name rather
// than a generic "Untitled …" placeholder.
const BLOOD_PRESSURE_DEFAULT_TITLE = "Blood Pressure Tracker";

// Plausible mmHg / bpm bounds — wide enough to accept any real measurement but
// tight enough to flag obvious typos like a systolic of 1200.
const BLOOD_PRESSURE_MEASUREMENT_MIN = 1;
const BLOOD_PRESSURE_MEASUREMENT_MAX = 400;
const BLOOD_PRESSURE_MEASUREMENT_REGEXP = /^\d+$/u;

export function isValidBloodPressureMeasurement(value: string): boolean {
  const trimmed = value.trim();
  if (!BLOOD_PRESSURE_MEASUREMENT_REGEXP.test(trimmed)) {
    return false;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return (
    parsed >= BLOOD_PRESSURE_MEASUREMENT_MIN &&
    parsed <= BLOOD_PRESSURE_MEASUREMENT_MAX
  );
}

function deriveBloodPressureTitle(trackerName: string): string {
  const trimmedName = trackerName.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }

  return BLOOD_PRESSURE_DEFAULT_TITLE;
}

function validateMeasurementField(
  row: DocumentRowSummary,
  field: string,
  label: string,
  index: number,
  issues: DocumentFieldValidationIssue[],
): void {
  const value = row.fields[field] ?? "";
  if (value.trim().length === 0) {
    return;
  }

  if (!isValidBloodPressureMeasurement(value)) {
    issues.push({
      field: `rows[${index}].${field}`,
      message: `Expected ${label} between ${BLOOD_PRESSURE_MEASUREMENT_MIN} and ${BLOOD_PRESSURE_MEASUREMENT_MAX}.`,
      value,
    });
  }
}

function validateBloodPressureRows(
  rows: ReadonlyArray<DocumentRowSummary> | undefined,
  issues: DocumentFieldValidationIssue[],
): void {
  (rows ?? []).forEach((row, index) => {
    validateMeasurementField(
      row,
      BLOOD_PRESSURE_SYSTOLIC_FIELD,
      "a systolic",
      index,
      issues,
    );
    validateMeasurementField(
      row,
      BLOOD_PRESSURE_DIASTOLIC_FIELD,
      "a diastolic",
      index,
      issues,
    );
    validateMeasurementField(
      row,
      BLOOD_PRESSURE_PULSE_FIELD,
      "a pulse",
      index,
      issues,
    );
  });
}

export const bloodPressureDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: HeartbeatIcon,
    createLabel: "Blood Pressure",
    kind: BLOOD_PRESSURE_DOCUMENT_KIND,
    label: "blood pressure tracker",
    project: ({ rows, structuredFields }) => {
      const issues: DocumentFieldValidationIssue[] = [];
      const trackerName = readStringDocumentField(
        structuredFields,
        BLOOD_PRESSURE_TRACKER_NAME_FIELD,
        issues,
      );
      validateBloodPressureRows(rows, issues);
      return {
        fieldValidationIssues: issues,
        structuredFields: { trackerName },
        title: deriveBloodPressureTitle(trackerName),
      };
    },
    untitledTitle: BLOOD_PRESSURE_DEFAULT_TITLE,
  };
