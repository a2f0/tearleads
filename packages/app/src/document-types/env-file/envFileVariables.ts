import type { DocumentRow } from "@symcrypt/client-sdk";
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
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";

export interface EnvVariableRow extends TrackerRow {
  key: string;
  value: string;
}

const ENV_FILE_EMPTY_VALUE = "None";
const ENV_FILE_MASKED_VALUE_PREFIX = "********";
const ENV_FILE_VISIBLE_VALUE_LENGTH = 4;

// Fold the store's generic rows into typed variable views.
export function toEnvVariableRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadTrackerRowCell,
): EnvVariableRow[] {
  return toTrackerRows(rows, (row) => ({
    key: readTrackerRowCell(row, readCell, ENV_FILE_VARIABLE_KEY_FIELD),
    value: readTrackerRowCell(row, readCell, ENV_FILE_VARIABLE_VALUE_FIELD),
  }));
}

export function getEnvFileReadValue(value: string): string {
  return value.trim().length > 0 ? value : ENV_FILE_EMPTY_VALUE;
}

// Environment files routinely contain credentials under arbitrary names, so
// read mode masks every non-empty value. The suffix makes similar variables
// distinguishable without putting the complete value on screen.
export function getEnvFileVariableReadValue(
  variable: EnvVariableRow,
  isRevealed = false,
): string {
  if (variable.value.trim().length === 0) {
    return ENV_FILE_EMPTY_VALUE;
  }

  if (isRevealed) {
    return variable.value;
  }

  return `${ENV_FILE_MASKED_VALUE_PREFIX}${variable.value.slice(-ENV_FILE_VISIBLE_VALUE_LENGTH)}`;
}

// The per-field rows for a variable's drill-down, each with the verified writer
// of its current value (null when the cell's editor is unknown, e.g. attribution
// not yet synced). The detail stays masked: revealing a value is an explicit,
// local action.
export function toEnvVariableDetailFields(
  variable: EnvVariableRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  return trackerDetailFields(
    variable,
    [
      {
        field: ENV_FILE_VARIABLE_KEY_FIELD,
        label: "Key",
        value: (row) => row.key,
      },
      {
        field: ENV_FILE_VARIABLE_VALUE_FIELD,
        label: "Value",
        value: getEnvFileVariableReadValue,
      },
    ],
    resolveRowWriter,
  );
}
