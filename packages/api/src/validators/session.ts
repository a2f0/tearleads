import { isPlainObject } from "@tearleads/validators/isPlainObject";

export interface SessionData {
  fingerprint: string;
  createdAt: number;
}

export function isSessionData(value: unknown): value is SessionData {
  return (
    isPlainObject(value) &&
    typeof value["fingerprint"] === "string" &&
    typeof value["createdAt"] === "number"
  );
}
