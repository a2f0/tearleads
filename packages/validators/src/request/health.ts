import { isRecord } from "../isRecord";

export type HealthRequest = {};

export function isHealthRequest(value: unknown): value is HealthRequest {
  return isRecord(value);
}
