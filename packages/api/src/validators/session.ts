import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";

export interface SessionData {
  fingerprint: string;
  createdAt: number;
}

export function isSessionData(value: unknown): value is SessionData {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "fingerprint") &&
    hasNumberProperty(value, "createdAt")
  );
}
