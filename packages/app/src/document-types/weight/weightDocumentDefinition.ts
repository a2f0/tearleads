import { CarrotIcon } from "@phosphor-icons/react/dist/csr/Carrot";
import {
  type DocumentFieldValidationIssue,
  type DocumentRowSummary,
  readStringDocumentField,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

export const WEIGHT_DOCUMENT_KIND = "weight";
// The tracker name lives in a flat structured field (not the row list).
export const WEIGHT_TRACKER_NAME_FIELD = "trackerName";
// Row-field keys for a weight entry in the document's first-class row list.
export const WEIGHT_MEASUREMENT_FIELD = "weight";
export const WEIGHT_MEASURED_AT_FIELD = "measuredAt";
export const WEIGHT_NOTES_FIELD = "notes";
// Each entry records the unit it was captured in, and the tracker carries the
// unit new entries are seeded with. They share a key because they are separate
// namespaces (structured fields vs. row fields) holding the same kind of value.
//
// The unit belongs on the entry, not only on the tracker: a tracker-wide unit is
// an invariant no client can hold. Two peers editing offline can each pick a
// unit and log entries; the merge keeps both rows but only one winning unit
// field, and the losing peer's weights would silently change meaning. An entry
// that carries its own unit always reads as what was recorded.
export const WEIGHT_UNIT_FIELD = "unit";
// Shown for a tracker that was never named — the document type's own name rather
// than a generic "Untitled …" placeholder.
const WEIGHT_DEFAULT_TITLE = "Weight Tracker";

export const WEIGHT_UNITS = ["lb", "kg"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];
// A tracker that predates a unit choice, or arrives from a peer without one,
// reads as pounds rather than as an error.
const WEIGHT_DEFAULT_UNIT: WeightUnit = "lb";

// A single plausible range covering both units — wide enough for any real body
// weight in pounds or kilograms, tight enough to flag an obvious typo like 8000.
// Deliberately not unit-specific: a tracker switched from lb to kg would
// otherwise retroactively invalidate its own history.
const WEIGHT_MEASUREMENT_MIN = 1;
const WEIGHT_MEASUREMENT_MAX = 1500;
// Up to two decimals, so a scale reading like 180.25 is kept verbatim.
const WEIGHT_MEASUREMENT_REGEXP = /^\d+(?:\.\d{1,2})?$/u;

export function isValidWeightMeasurement(value: string): boolean {
  const trimmed = value.trim();
  if (!WEIGHT_MEASUREMENT_REGEXP.test(trimmed)) {
    return false;
  }

  const parsed = Number.parseFloat(trimmed);
  return parsed >= WEIGHT_MEASUREMENT_MIN && parsed <= WEIGHT_MEASUREMENT_MAX;
}

function isWeightUnit(value: string): value is WeightUnit {
  return WEIGHT_UNITS.some((unit) => unit === value);
}

// Falls back rather than raising: an unrecognized unit is a display concern, and
// the projector reports it as a validation issue separately.
export function toWeightUnit(value: string | undefined): WeightUnit {
  const trimmed = (value ?? "").trim();
  return isWeightUnit(trimmed) ? trimmed : WEIGHT_DEFAULT_UNIT;
}

function deriveWeightTitle(trackerName: string): string {
  const trimmedName = trackerName.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }

  return WEIGHT_DEFAULT_TITLE;
}

function validateUnitField(
  unit: string,
  field: string,
  issues: DocumentFieldValidationIssue[],
): void {
  if (unit.trim().length === 0 || isWeightUnit(unit.trim())) {
    return;
  }

  issues.push({
    field,
    message: `Expected one of ${WEIGHT_UNITS.join(", ")}.`,
    value: unit,
  });
}

function validateWeightRows(
  rows: ReadonlyArray<DocumentRowSummary> | undefined,
  issues: DocumentFieldValidationIssue[],
): void {
  (rows ?? []).forEach((row, index) => {
    const value = row.fields[WEIGHT_MEASUREMENT_FIELD] ?? "";
    if (value.trim().length > 0 && !isValidWeightMeasurement(value)) {
      issues.push({
        field: `rows[${index}].${WEIGHT_MEASUREMENT_FIELD}`,
        message: `Expected a weight between ${WEIGHT_MEASUREMENT_MIN} and ${WEIGHT_MEASUREMENT_MAX}.`,
        value,
      });
    }

    validateUnitField(
      row.fields[WEIGHT_UNIT_FIELD] ?? "",
      `rows[${index}].${WEIGHT_UNIT_FIELD}`,
      issues,
    );
  });
}

export const weightDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: CarrotIcon,
    createLabel: "Weight",
    kind: WEIGHT_DOCUMENT_KIND,
    label: "weight tracker",
    project: ({ rows, structuredFields }) => {
      const issues: DocumentFieldValidationIssue[] = [];
      const trackerName = readStringDocumentField(
        structuredFields,
        WEIGHT_TRACKER_NAME_FIELD,
        issues,
      );
      const unit = readStringDocumentField(
        structuredFields,
        WEIGHT_UNIT_FIELD,
        issues,
      );
      validateUnitField(unit, WEIGHT_UNIT_FIELD, issues);
      validateWeightRows(rows, issues);
      return {
        fieldValidationIssues: issues,
        structuredFields: { trackerName, unit },
        title: deriveWeightTitle(trackerName),
      };
    },
    untitledTitle: WEIGHT_DEFAULT_TITLE,
  };
