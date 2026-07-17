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
const ENV_FILE_MASKED_VALUE = "********";
const ENV_FILE_SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:PASSWORD|PASS|PWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)(?:_|$)/u;

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

export function shouldMaskEnvFileVariable(variable: EnvVariableRow): boolean {
  return ENV_FILE_SENSITIVE_KEY_PATTERN.test(variable.key.trim().toUpperCase());
}

export function getEnvFileReadValue(value: string): string {
  return value.trim().length > 0 ? value : ENV_FILE_EMPTY_VALUE;
}

// The read/detail value for a variable: its stored value, "None" when empty, or
// a fixed mask when the key looks sensitive so a secret never renders.
export function getEnvFileVariableReadValue(variable: EnvVariableRow): string {
  if (variable.value.trim().length === 0) {
    return ENV_FILE_EMPTY_VALUE;
  }

  return shouldMaskEnvFileVariable(variable)
    ? ENV_FILE_MASKED_VALUE
    : variable.value;
}
