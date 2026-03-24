import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { SessionData } from "../middleware/session";

export function isSessionData(value: unknown): value is SessionData {
  return (
    isPlainObject(value) &&
    typeof value["fingerprint"] === "string" &&
    typeof value["createdAt"] === "number"
  );
}
