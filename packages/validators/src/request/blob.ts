import { isPlainObject } from "../isPlainObject";
import { hasNumberProperty, hasStringProperty } from "../util";

export interface StageBlobRequest {
  encryptedBytes: string;
  byteLength: number;
  sha256: string;
}

export function isStageBlobRequest(value: unknown): value is StageBlobRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "encryptedBytes") &&
    hasNumberProperty(value, "byteLength") &&
    Number.isInteger(value.byteLength) &&
    value.byteLength > 0 &&
    hasStringProperty(value, "sha256") &&
    value.sha256.length > 0
  );
}
