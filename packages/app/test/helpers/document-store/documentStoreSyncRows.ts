import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import type {
  PendingUpdateLengthRow,
  ProjectionLengthRow,
} from "./documentStoreSyncFixtures";

interface PendingUpdateDetailRow extends PendingUpdateLengthRow {
  partial_start_version_vector: string | null;
  partial_end_version_vector: string | null;
}

export function readRowValue(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

export function isPendingUpdateLengthRow(
  value: unknown,
): value is PendingUpdateLengthRow {
  const updateDataLength = readRowValue(value, "update_data_length");
  return (
    typeof updateDataLength === "number" ||
    typeof updateDataLength === "string" ||
    updateDataLength === null
  );
}

export function isProjectionLengthRow(
  value: unknown,
): value is ProjectionLengthRow {
  const textLength = readRowValue(value, "text_length");
  return (
    typeof textLength === "number" ||
    typeof textLength === "string" ||
    textLength === null
  );
}

export function isPendingUpdateDetailRow(
  value: unknown,
): value is PendingUpdateDetailRow {
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return (
    isPendingUpdateLengthRow(value) &&
    (typeof partialStartVersionVector === "string" ||
      partialStartVersionVector === null) &&
    (typeof partialEndVersionVector === "string" ||
      partialEndVersionVector === null)
  );
}
