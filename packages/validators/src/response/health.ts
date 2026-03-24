import { isPlainObject } from "../isPlainObject";

export interface HealthResponse {
  message: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isPlainObject(value) && typeof value["message"] === "string";
}
