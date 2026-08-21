import type {
  DocumentFieldValidationIssue,
  DocumentProjection,
  DocumentProjectorInput,
  ValidatedDocumentFields,
} from "@symcrypt/client-sdk";

/**
 * The projector every string-structured document kind shares: validate the
 * stored fields, echo them back, and derive the title from the typed view.
 */
export function structuredFieldsProjector<
  Fields extends Record<string, string>,
>(
  readFields: (
    source: Readonly<Record<string, unknown>>,
  ) => ValidatedDocumentFields<Fields>,
  deriveTitle: (fields: Fields) => string,
): (input: DocumentProjectorInput) => DocumentProjection {
  return ({ structuredFields }) => {
    const validated = readFields(structuredFields);
    return {
      fieldValidationIssues: validated.issues,
      structuredFields: { ...validated.fields },
      title: deriveTitle(validated.fields),
    };
  };
}

export function addFormatIssue(
  issues: DocumentFieldValidationIssue[],
  field: string,
  value: string,
  message: string,
): void {
  if (value.length === 0) {
    return;
  }

  issues.push({
    field,
    message,
    value,
  });
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// Strict YYYY-MM-DD calendar-date check — rejects impossible dates like
// 2024-02-30 rather than letting Date() roll them over.
function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  return day <= getDaysInMonth(year, month);
}

export function addDateOnlyFormatIssue(
  issues: DocumentFieldValidationIssue[],
  field: string,
  value: string,
): void {
  if (isValidDateOnly(value)) {
    return;
  }

  addFormatIssue(
    issues,
    field,
    value,
    "Expected a calendar date in YYYY-MM-DD format.",
  );
}

export function nullableField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTruthyStructuredField(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
