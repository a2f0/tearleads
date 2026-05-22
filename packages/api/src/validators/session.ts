import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";

export interface SessionData {
  id: string;
  userId: string;
  fingerprint: string;
  createdAt: number;
}

export type SessionCreateInput = Omit<SessionData, "id">;

export function isSessionData(value: unknown): value is SessionData {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "fingerprint") &&
    hasNumberProperty(value, "createdAt") &&
    Number.isSafeInteger(value.createdAt) &&
    value.createdAt >= 0
  );
}
