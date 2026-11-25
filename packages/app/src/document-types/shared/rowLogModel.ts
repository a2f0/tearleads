import type {
  DocumentFieldValidationIssue,
  DocumentRowSummary,
} from "@tearleads/client-sdk";
import type { DocumentFieldOption } from "./documentFieldOptions";
import { isValidDateOnly } from "./documentFieldUtils";

// Shared by a kind's projector and its editor, so it imports nothing from the
// React side of the document types.

/**
 * One cell of a row log: a dated history kept in a structured document's
 * repeated rows (a vehicle's services, a medication's doses). The input names
 * the control, and with it the validation a filled-in value gets.
 */
export interface RowLogField {
  readonly key: string;
  readonly label: string;
  readonly input: "date" | "datetime-local" | "decimal" | "select" | "text";
  /** The choices of a `select` field, stored by value. */
  readonly options?: ReadonlyArray<DocumentFieldOption>;
  readonly placeholder?: string;
  /** A row cannot be added while this is blank. */
  readonly required?: boolean;
  /** A filled-in value must pass this; blank values always do. */
  readonly format?: {
    readonly isValid: (value: string) => boolean;
    readonly message: string;
  };
}

/** One column of the log's read table. */
export interface RowLogColumn {
  readonly id: string;
  readonly header: string;
  readonly text: (cells: Readonly<Record<string, string>>) => string;
  /** How the column orders rows; omit for an unsortable column. */
  readonly sort?: {
    readonly by: "number" | "text";
    readonly value: (cells: Readonly<Record<string, string>>) => string;
  };
  readonly fold: "primary" | "secondary" | "none";
  readonly hideable?: boolean;
  readonly monospace?: boolean;
  readonly muted?: boolean;
  /**
   * Exactly one column leaves this unset, is not hideable, and absorbs the
   * table's slack (see TrackerReadColumn.hideable).
   */
  readonly width?: string;
}

export interface RowLogDefinition {
  readonly addLabel: string;
  readonly columns: ReadonlyArray<RowLogColumn>;
  /**
   * Seeds a new row from the existing rows' cells, e.g. with today's date and
   * the last row's unit.
   */
  readonly createEntry: (
    previous: ReadonlyArray<Readonly<Record<string, string>>>,
  ) => Readonly<Record<string, string>>;
  readonly emptyLabel: string;
  /** What one row is called: "Service" names "Service 2 actions". */
  readonly entryLabel: string;
  readonly fields: ReadonlyArray<RowLogField>;
  readonly listLabel: string;
  readonly saveLabel: string;
  /** Prefix for the read table's persisted column choices. */
  readonly storageKey: string;
}

const DATE_FORMAT_MESSAGE = "Expected a calendar date in YYYY-MM-DD format.";
const REQUIRED_MESSAGE = "Expected a value.";
// A datetime-local input's value: a local wall-clock minute, no zone.
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** What is wrong with a filled-in cell, or null when it is acceptable. */
export function getRowLogFieldIssue(
  field: RowLogField,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (field.input === "date" && !isValidDateOnly(trimmed)) {
    return DATE_FORMAT_MESSAGE;
  }
  if (
    field.input === "datetime-local" &&
    !(DATE_TIME_PATTERN.test(trimmed) && isValidDateOnly(trimmed.slice(0, 10)))
  ) {
    return "Expected a local date and time in YYYY-MM-DDTHH:MM format.";
  }
  if (
    field.input === "select" &&
    field.options &&
    !field.options.some((option) => option.value === trimmed)
  ) {
    return `Expected one of ${field.options.map((option) => option.value).join(", ")}.`;
  }
  if (field.format && !field.format.isValid(trimmed)) {
    return field.format.message;
  }
  return null;
}

/**
 * What is wrong with a stored cell: a blank required cell, or a filled-in one
 * the field rejects.
 */
export function getRowLogCellIssue(
  field: RowLogField,
  value: string,
): string | null {
  if (field.required === true && value.trim().length === 0) {
    return REQUIRED_MESSAGE;
  }
  return getRowLogFieldIssue(field, value);
}

/** Whether a row can be saved: required cells set, every cell valid. */
export function isRowLogEntryComplete(
  fields: ReadonlyArray<RowLogField>,
  cells: Readonly<Record<string, string>>,
): boolean {
  return fields.every(
    (field) => getRowLogCellIssue(field, rowLogCell(cells, field.key)) === null,
  );
}

/** Projector validation: report each stored cell the log would reject. */
export function addRowLogIssues(
  rows: ReadonlyArray<DocumentRowSummary> | undefined,
  fields: ReadonlyArray<RowLogField>,
  issues: DocumentFieldValidationIssue[],
): void {
  (rows ?? []).forEach((row, index) => {
    for (const field of fields) {
      const value = row.fields[field.key] ?? "";
      const message = getRowLogCellIssue(field, value);
      if (message !== null) {
        issues.push({ field: `rows[${index}].${field.key}`, message, value });
      }
    }
  });
}

/** One cell's value, blank when the row has none. */
export function rowLogCell(
  cells: Readonly<Record<string, string>>,
  key: string,
): string {
  return cells[key] ?? "";
}

export function emptyRowLogCells(
  fields: ReadonlyArray<RowLogField>,
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, ""]));
}

const pad = (value: number) => String(value).padStart(2, "0");

function localDateOnly(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A `date` input's value for today, in local time. */
export function currentDateOnly(): string {
  return localDateOnly(new Date());
}

/** Now as a datetime-local value: this device's wall clock, to the minute. */
export function currentDateTimeLocal(): string {
  const now = new Date();
  return `${localDateOnly(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
