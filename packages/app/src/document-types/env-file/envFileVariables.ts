import type { DocumentRow } from "@tearleads/client-sdk";
import {
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";

type ReadRowCell = (id: string, field: string, storeValue: string) => string;

export interface EnvVariableRow {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  createdBy: string;
  createdByPeer: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedByPeer: string | null;
  // Per-cell last-editor peers, keyed by the row's field keys, for field-level
  // attribution in the variable detail.
  fieldEditors: Record<string, string | null>;
}

const ENV_FILE_EMPTY_VALUE = "None";
const ENV_FILE_MASKED_VALUE_PREFIX = "********";
const ENV_FILE_VISIBLE_VALUE_LENGTH = 4;

// Fold the store's generic rows into typed variable views, applying the caller's
// optimistic in-flight cell overlay so controlled inputs stay smooth.
export function toEnvVariableRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadRowCell,
): EnvVariableRow[] {
  return rows.map((row) => ({
    id: row.id,
    key: readCell(
      row.id,
      ENV_FILE_VARIABLE_KEY_FIELD,
      row.fields[ENV_FILE_VARIABLE_KEY_FIELD] ?? "",
    ),
    value: readCell(
      row.id,
      ENV_FILE_VARIABLE_VALUE_FIELD,
      row.fields[ENV_FILE_VARIABLE_VALUE_FIELD] ?? "",
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
