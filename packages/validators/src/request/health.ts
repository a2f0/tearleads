import { isPlainObject } from "../isPlainObject";

export type HealthRequest = Record<string, never>;

export function isHealthRequest(value: unknown): value is HealthRequest {
  return isPlainObject(value);
}
