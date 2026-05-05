import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface SyncWatermark {
  id: string;
  updatedAt: string;
}

export function isSyncWatermark(value: unknown): value is SyncWatermark {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "updatedAt")
  );
}
