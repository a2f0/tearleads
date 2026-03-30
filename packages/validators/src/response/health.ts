import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface HealthResponse {
  message: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isPlainObject(value) && hasStringProperty(value, "message");
}
