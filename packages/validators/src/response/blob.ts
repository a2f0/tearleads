import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface StageBlobResponse {
  stageId: string;
  expiresAt: string;
}

export function isStageBlobResponse(
  value: unknown,
): value is StageBlobResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "expiresAt")
  );
}
