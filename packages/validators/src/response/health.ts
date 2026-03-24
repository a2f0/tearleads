import { isRecord } from "../isRecord";

export interface HealthResponse {
  message: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && typeof value["message"] === "string";
}
